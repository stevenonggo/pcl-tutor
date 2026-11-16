"""AES-256-GCM authenticated encryption for user-supplied AI provider keys.

Built on the well-established ``cryptography`` library (Rust-backed, audited
primitives) instead of a hand-rolled construction:

  key     = PBKDF2-HMAC-SHA256(master_key, random salt, 200_000 iterations)
  cipher  = AES-256-GCM(key, random 96-bit nonce, plaintext)
  blob    = base64url( "ai2" | salt(16) | nonce(12) | ciphertext+tag )

The master key comes from the ``AI_CREDENTIAL_ENCRYPTION_KEY`` environment
variable (backend/.env). A fresh random salt (new GCM key) and nonce per
blob keep two encryptions of the same key from ever looking alike, and the
GCM authentication tag makes any tampering detectable.

Properties relied on by the API layer:
- Confidentiality: without the master key the ciphertext is unusable.
- Integrity: any modification of the blob makes AES-GCM tag verification
  fail and raises ``CredentialEncryptionError`` instead of silently
  decrypting garbage.
- The plaintext key is never written to disk, logs, or API responses.

Blobs written by the earlier stdlib-only format ("ai1") can no longer be
decrypted; rotate any stored credentials by re-validating the key. No
production credential data existed before this change.
"""
import base64
import os

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

FORMAT_VERSION = b"ai2"
_LEGACY_FORMAT_VERSION = b"ai1"
_SALT_SIZE = 16
_NONCE_SIZE = 12
_PBKDF2_ITERATIONS = 200_000


class CredentialEncryptionError(Exception):
    """Raised when a credential blob cannot be created or decrypted."""


def _derive_key(master_key, salt):
    """Derive a 256-bit AES-GCM key from the master key and a per-blob salt."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt,
        iterations=_PBKDF2_ITERATIONS,
    )
    return kdf.derive(master_key.encode("utf-8"))


def encrypt_key(plaintext, master_key):
    """Encrypt an API key string. Returns a base64url blob (str)."""
    if not master_key:
        raise CredentialEncryptionError(
            "AI_CREDENTIAL_ENCRYPTION_KEY is not configured; "
            "add it to backend/.env before storing AI credentials."
        )
    if not isinstance(plaintext, str) or not plaintext:
        raise CredentialEncryptionError("There is no key to encrypt.")

    salt = os.urandom(_SALT_SIZE)
    nonce = os.urandom(_NONCE_SIZE)
    key = _derive_key(master_key, salt)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext.encode("utf-8"), None)

    blob = FORMAT_VERSION + salt + nonce + ciphertext
    return base64.urlsafe_b64encode(blob).decode("ascii")


def decrypt_key(blob, master_key):
    """Decrypt a blob produced by :func:`encrypt_key`. Raises on tampering."""
    if not master_key:
        raise CredentialEncryptionError("AI_CREDENTIAL_ENCRYPTION_KEY is not configured.")
    if not isinstance(blob, str):
        raise CredentialEncryptionError("Stored credential is missing or unreadable.")

    try:
        raw = base64.urlsafe_b64decode(blob.encode("ascii"))
    except Exception:
        raise CredentialEncryptionError("Stored credential is corrupted.") from None

    if raw[:len(_LEGACY_FORMAT_VERSION)] == _LEGACY_FORMAT_VERSION:
        raise CredentialEncryptionError(
            "Stored credential was written with the retired stdlib format "
            "and must be re-validated."
        )

    vlen = len(FORMAT_VERSION)
    salt_start = vlen
    nonce_start = salt_start + _SALT_SIZE
    header = nonce_start + _NONCE_SIZE
    if len(raw) < header or raw[:vlen] != FORMAT_VERSION:
        raise CredentialEncryptionError("Stored credential is corrupted.")

    salt = raw[salt_start:nonce_start]
    nonce = raw[nonce_start:header]
    ciphertext = raw[header:]
    key = _derive_key(master_key, salt)
    try:
        plaintext = AESGCM(key).decrypt(nonce, ciphertext, None)
    except InvalidTag:
        raise CredentialEncryptionError(
            "Stored credential failed integrity check."
        ) from None
    return plaintext.decode("utf-8")
