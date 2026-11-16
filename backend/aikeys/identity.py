"""Login-independent device identity for the protected AI endpoints.

``/validate/``, ``/status/`` and ``/models/`` accept two identities:

- a valid PCL Tutor SimpleJWT (JWT-first — the existing behavior is
  preserved byte-for-byte for signed-in users), or
- an ``X-PCL-AI-Identity`` header carrying the client's locally generated
  UUID-4 device token (the login-independent path).

The device token is unguessable (client-side cryptographic randomness) and
is the *owner* of the credential row it creates — possession is the access
model, exactly like a session token. Tokens travel only in request headers
and are never stored in cleartext in logs or responses.
"""

import re
from typing import Any

from rest_framework.permissions import BasePermission

# Strict UUID-4 shape (case-insensitive, optional surrounding whitespace).
# Anything that does not match is rejected outright, so a malformed header
# can never reach the credential store.
_UUID4_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

IDENTITY_HEADER = "X-PCL-AI-Identity"


def normalize_identity_header(raw: object) -> str:
    """Return the lowercased UUID-4 token, or '' when the header is unusable.

    Accepts upper-case tokens and stray surrounding whitespace; rejects
    empty values, non-strings, and UUIDs of any other version/shape.
    """
    if not isinstance(raw, str):
        return ""
    value = raw.strip().lower()
    return value if _UUID4_RE.fullmatch(value) else ""


def owner_lookup(request: Any) -> tuple[dict[str, Any] | None, str]:
    """Resolve the ``AiCredential`` ownership lookup for this request.

    Returns ``(lookup, kind)``:

    - ``({"user": <User>}, "user")`` when a valid JWT authenticated the
      request. JWT-first: an authenticated account always resolves to its
      own row, even if a device header is also present.
    - ``({"identity_token": <uuid>}, "device")`` for a well-formed
      device-identity request without a JWT.
    - ``(None, "")`` when neither identity is present; the
      ``JwtOrDeviceIdentity`` permission has already answered 401, so
      views never see ``None`` (each view keeps a defensive guard that
      mirrors the permission check).
    """
    user = getattr(request, "user", None)
    if user is not None and user.is_authenticated:
        return {"user": user}, "user"
    token = normalize_identity_header(request.headers.get(IDENTITY_HEADER))
    if token:
        return {"identity_token": token}, "device"
    return None, ""


class JwtOrDeviceIdentity(BasePermission):
    """Allow a request that carries a valid PCL Tutor JWT or a well-formed
    device-identity header; answer 401 (the DRF default when an
    authenticator is configured) when neither is present."""

    def has_permission(self, request, view):
        lookup, _kind = owner_lookup(request)
        return lookup is not None
