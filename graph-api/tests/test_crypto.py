"""Sprint 06 Day 1: token encryption at rest + OAuth state hashing."""
import pytest

from core.config import settings
from core.crypto import EncryptionError, decrypt_token, encrypt_token, hash_state

VALID_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="  # base64 of 32 bytes


def test_encrypt_then_decrypt_round_trips(monkeypatch):
    monkeypatch.setattr(settings, "token_encryption_key_1", VALID_KEY)
    monkeypatch.setattr(settings, "token_encryption_key_current_version", 1)

    blob, version = encrypt_token("super-secret-meta-token")

    assert version == 1
    assert decrypt_token(blob, version) == "super-secret-meta-token"


def test_ciphertext_never_contains_the_plaintext(monkeypatch):
    monkeypatch.setattr(settings, "token_encryption_key_1", VALID_KEY)

    blob, _ = encrypt_token("super-secret-meta-token")

    assert b"super-secret-meta-token" not in blob


def test_two_encryptions_of_the_same_plaintext_differ(monkeypatch):
    """A fresh random nonce each time — required for AES-GCM safety."""
    monkeypatch.setattr(settings, "token_encryption_key_1", VALID_KEY)

    first, _ = encrypt_token("same-value")
    second, _ = encrypt_token("same-value")

    assert first != second


def test_decrypt_with_wrong_key_version_fails(monkeypatch):
    monkeypatch.setattr(settings, "token_encryption_key_1", VALID_KEY)
    blob, _ = encrypt_token("secret")

    with pytest.raises(EncryptionError):
        decrypt_token(blob, key_version=2)  # version 2 has no configured key


def test_missing_key_raises_encryption_error(monkeypatch):
    monkeypatch.setattr(settings, "token_encryption_key_1", None)

    with pytest.raises(EncryptionError):
        encrypt_token("secret")


def test_key_with_wrong_length_raises_encryption_error(monkeypatch):
    monkeypatch.setattr(settings, "token_encryption_key_1", "dG9vLXNob3J0")  # "too-short"

    with pytest.raises(EncryptionError):
        encrypt_token("secret")


def test_hash_state_is_deterministic_and_one_way():
    first = hash_state("raw-state-value")
    second = hash_state("raw-state-value")

    assert first == second
    assert "raw-state-value" not in first
    assert len(first) == 64  # sha256 hex digest
