import io
import math
import re
import threading
import unicodedata
import zipfile
from functools import lru_cache

MODEL_NAME = "intfloat/multilingual-e5-small"
DIMENSIONS = 384
MAX_BYTES = 10 * 1024 * 1024
MAX_CHARACTERS = 250_000
CHUNK_TOKENS = 480
OVERLAP_TOKENS = 64
_model_lock = threading.RLock()
_loaded_model = None


def clean_text(text: str) -> str:
    text = unicodedata.normalize("NFC", text).replace("\r\n", "\n")
    text = "".join(c for c in text if c in "\n\t" or not unicodedata.category(c).startswith("C"))
    text = re.sub(r"[^\S\n]+", " ", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def extract_text(data: bytes, filename: str, mime_type: str) -> str:
    if not data or len(data) > MAX_BYTES:
        raise ValueError("Fichier vide ou supérieur à 10 Mo.")
    suffix = filename.rsplit(".", 1)[-1].lower()
    allowed = {
        "pdf": {"application/pdf"},
        "docx": {"application/vnd.openxmlformats-officedocument.wordprocessingml.document"},
        "txt": {"text/plain"},
        "csv": {"text/csv", "application/csv", "text/plain"},
    }
    if suffix not in allowed or mime_type not in allowed[suffix]:
        raise ValueError("Format ou type MIME non pris en charge (PDF, DOCX, TXT, CSV).")
    try:
        if suffix == "pdf":
            from pypdf import PdfReader

            if not data.startswith(b"%PDF-"):
                raise ValueError("Signature PDF invalide.")
            reader = PdfReader(io.BytesIO(data))
            if reader.is_encrypted or len(reader.pages) > 200:
                raise ValueError("PDF chiffré ou supérieur à 200 pages.")
            parts = []
            for page in reader.pages:
                # Bound decompression before extract_text on each page.
                stream = page.get_contents()
                if stream and len(stream.get_data()) > MAX_BYTES:
                    raise ValueError("Page PDF trop volumineuse.")
                parts.append(page.extract_text() or "")
                if sum(map(len, parts)) > MAX_CHARACTERS:
                    raise ValueError("Document supérieur à 250 000 caractères.")
            text = "\n\n".join(parts)
        elif suffix == "docx":
            from docx import Document

            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                entries = archive.infolist()
                if len(entries) > 1000 or sum(e.file_size for e in entries) > 30 * MAX_BYTES:
                    raise ValueError("Archive DOCX trop volumineuse.")
                if "word/document.xml" not in archive.namelist():
                    raise ValueError("Contenu DOCX invalide.")
            document = Document(io.BytesIO(data))
            # Preserve paragraph and table order, including heading text.
            from docx.table import Table
            from docx.text.paragraph import Paragraph

            parts = []
            for block in document.iter_inner_content():
                if isinstance(block, Paragraph):
                    parts.append(block.text)
                elif isinstance(block, Table):
                    parts.extend(" | ".join(c.text for c in row.cells) for row in block.rows)
            text = "\n\n".join(parts)
        else:
            text = data.decode("utf-8-sig")
            if "\x00" in text:
                raise ValueError("Le fichier doit être du texte UTF-8.")
    except ValueError:
        raise
    except Exception as exc:
        raise ValueError("Extraction impossible : fichier endommagé ou illisible.") from exc
    text = clean_text(text)
    if not text:
        raise ValueError("Aucun texte extractible. Les PDF numérisés nécessitent un OCR préalable.")
    if len(text) > MAX_CHARACTERS:
        raise ValueError("Document supérieur à 250 000 caractères.")
    return text


def embedding_model():
    global _loaded_model
    from fastembed import TextEmbedding
    from fastembed.common.model_description import ModelSource, PoolingType

    with _model_lock:
        if _loaded_model is None:
            if MODEL_NAME not in {model['model'] for model in TextEmbedding.list_supported_models()}:
                TextEmbedding.add_custom_model(
                    model=MODEL_NAME, pooling=PoolingType.MEAN, normalization=True,
                    sources=ModelSource(hf=MODEL_NAME), dim=DIMENSIONS, model_file='onnx/model.onnx',
                )
            _loaded_model = TextEmbedding(model_name=MODEL_NAME, threads=2)
        return _loaded_model


@lru_cache(maxsize=1)
def tokenizer():
    from tokenizers import Tokenizer

    # Independent tokenizer: never change the shared encoder's truncation.
    result = Tokenizer.from_str(embedding_model().model.tokenizer.to_str())
    result.no_truncation()
    result.no_padding()
    return result


def chunk_text(text: str, encoder=None, size=CHUNK_TOKENS, overlap=OVERLAP_TOKENS) -> list[dict]:
    if not 0 <= overlap < size:
        raise ValueError("L'overlap doit être inférieur à la taille du chunk.")
    text = clean_text(text)
    if not text:
        raise ValueError("Le texte est vide.")
    offsets = (encoder or tokenizer()).encode(text, add_special_tokens=False).offsets
    chunks = []
    start = 0
    while start < len(offsets):
        end = min(start + size, len(offsets))
        if end < len(offsets):
            # Prefer a sentence/paragraph end in the last quarter of the window.
            for candidate in range(end, max(start + overlap + 1, end - size // 4), -1):
                tail = text[offsets[candidate - 1][1] - 1:offsets[candidate][0]]
                if re.search(r"[.!?؟。]\s|\n", tail):
                    end = candidate
                    break
        first, last = offsets[start][0], offsets[end - 1][1]
        chunks.append({"content": text[first:last], "metadata": {"start": first, "end": last, "tokens": end - start}})
        if len(chunks) > 256:
            raise ValueError("Document trop long : maximum 256 passages.")
        if end == len(offsets):
            break
        start = max(start + 1, end - overlap)
    return chunks


def embed(texts: list[str], kind: str = "passage") -> list[list[float]]:
    # Queries/comments can exceed E5's 512-token input window.
    clipped = []
    with _model_lock:
        model = embedding_model()
        encoder = tokenizer()
        for text in texts:
            offsets = encoder.encode(text, add_special_tokens=False).offsets
            clipped.append(text[:offsets[CHUNK_TOKENS - 1][1]] if len(offsets) > CHUNK_TOKENS else text)
        # Custom E5 registration does not add task prefixes automatically.
        prefix = 'query: ' if kind == 'query' else 'passage: '
        vectors = model.embed([prefix + text for text in clipped], batch_size=16)
        result = [[float(value) for value in vector] for vector in vectors]
    if any(len(v) != DIMENSIONS or not all(math.isfinite(x) for x in v) or not any(v) for v in result):
        raise RuntimeError("Embedding invalide.")
    return result


def prepare(text: str) -> dict:
    chunks = chunk_text(text)
    vectors = embed([chunk["content"] for chunk in chunks])
    return {"model": MODEL_NAME, "chunks": [{**chunk, "embedding": vector} for chunk, vector in zip(chunks, vectors)]}
