"""Token-at-rest encryption and OAuth state hashing (Sprint 06 Day 1).

Only graph-api ever sees a plaintext Meta token: Express stores the
ciphertext produced here (as opaque bytes) and never has the key to read it.
"""
import base64
import hashlib
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_NONCE_SIZE = 12
_KEY_SIZE = 32


class EncryptionError(Exception):
    pass


def _key_for_version(version: int) -> bytes:
    from core.config import settings  # local import: keeps settings mockable in tests

    raw = getattr(settings, f"token_encryption_key_{version}", None)
    if not raw:
        raise EncryptionError(f"Aucune clé de chiffrement configurée pour la version {version}.")
    try:
        key = base64.b64decode(raw, validate=True)
    except Exception as exc:
        raise EncryptionError(
            f"Clé de chiffrement version {version} invalide (base64 attendu)."
        ) from exc
    if len(key) != _KEY_SIZE:
        raise EncryptionError(
            f"Clé de chiffrement version {version} doit faire {_KEY_SIZE} octets une fois décodée."
        )
    return key


def encrypt_token(plaintext: str) -> tuple[bytes, int]:
    """Encrypt with the CURRENT key version. Returns (nonce||ciphertext||tag, key_version)."""
    from core.config import settings

    version = settings.token_encryption_key_current_version
    key = _key_for_version(version)
    nonce = os.urandom(_NONCE_SIZE)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext.encode("utf-8"), None)
    return nonce + ciphertext, version


def decrypt_token(blob: bytes, key_version: int) -> str:
    key = _key_for_version(key_version)
    nonce, ciphertext = bytes(blob[:_NONCE_SIZE]), bytes(blob[_NONCE_SIZE:])
    plaintext = AESGCM(key).decrypt(nonce, ciphertext, None)
    return plaintext.decode("utf-8")


def hash_state(raw_state: str) -> str:
    """One-way hash for oauth_states.state_hash — the raw state is never stored."""
    return hashlib.sha256(raw_state.encode("utf-8")).hexdigest()
