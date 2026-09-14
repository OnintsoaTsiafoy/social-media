"""Small response-language heuristic, separate from the French NLP gate."""
import re

from modules.nlp.language import ENGLISH_MARKERS, FRENCH_MARKERS, TOKEN_RE
from modules.nlp.preprocessing import strip_accents


def response_language(text: str, fallback: str = 'fr') -> str:
    if len(re.findall(r'[\u0620-\u064a\u066e-\u06d3]', text)) >= 3:
        return 'ar'
    tokens = TOKEN_RE.findall(strip_accents(text.lower()))
    english = sum(token in ENGLISH_MARKERS - {'service'} for token in tokens)
    french = sum(token in FRENCH_MARKERS for token in tokens)
    if english > french and (english >= 2 or len(tokens) <= 3):
        return 'en'
    if french:
        return 'fr'
    return fallback
