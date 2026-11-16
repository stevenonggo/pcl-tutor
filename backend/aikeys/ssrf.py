"""SSRF-safe outbound probing for user-supplied AI endpoints.

User-supplied URLs (the "Custom endpoint" flow, or any explicit endpoint
override sent in a validate request) are untrusted input. Probing them
blindly lets an attacker point the backend at internal services (metadata
endpoints, loopback admin panels, private-network hosts) or force
redirects to such hosts. This module therefore:

1. Only allows ``http`` / ``https`` URLs with a resolvable host.
2. Resolves the host and rejects the probe when ANY resolved address is
   loopback, private (RFC 1918), link-local (incl. the 169.254.169.254
   cloud metadata range), reserved, multicast, or unspecified.
3. Blocks non-DNS tricks: decimal/octal IP forms, ``localhost``, and IPv6
   literals.
4. Pins the connection to a validated public IP (DNS-rebinding window is
   closed: the address we connect to is the one we checked), while SNI /
   Host headers keep the original hostname so TLS verification still
   applies.
5. Follows at most ``MAX_REDIRECTS`` redirects and re-runs the full check
   on every hop, so a public host that 302s to an internal one is blocked.

Operator-configured provider endpoints (the four ``MODEL_*_ENDPOINT``
values in settings) are trusted and never pass through this module.
"""

import http.client
import ipaddress
import socket
import ssl
import urllib.parse

MAX_REDIRECTS = 3
_ALLOWED_SCHEMES = ("http", "https")
_REDIS = {301, 302, 303, 307, 308}


class SsrfError(Exception):
    """Raised when a URL is refused for outbound probing."""


def _blocked_reason(ip_string):
    """Return a short reason if the IP must not be probed, else None."""
    ip = ipaddress.ip_address(ip_string)
    if ip.is_unspecified:
        return "an unspecified address"
    if ip.is_loopback:
        return "the loopback address range"
    if ip.is_link_local:
        return "a link-local address (e.g. the cloud metadata range)"
    if ip.is_private:
        return "a private address range"
    if ip.is_reserved:
        return "a reserved address range"
    if ip.is_multicast:
        return "the multicast range"
    return None


def parse_probe_url(url):
    """Validate URL shape; return (host, port, path) or raise SsrfError."""
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in _ALLOWED_SCHEMES:
        raise SsrfError(
            f"Only http/https endpoints are supported (got '{parsed.scheme or 'empty'}')."
        )
    host = (parsed.hostname or "").strip()
    if not host:
        raise SsrfError("The endpoint has no host name.")
    port = parsed.port
    if port is None:
        port = 443 if parsed.scheme == "https" else 80
    path = parsed.path or "/"
    if parsed.query:
        path = f"{path}?{parsed.query}"
    return host, port, path


def resolve_public_ip(host, port):
    """Resolve ``host`` and return a public IP to connect to.

    Raises :class:`SsrfError` when the host is a loopback name, a literal
    internal address, or resolves to ANY internal address (every answer is
    checked, not just the first).
    """
    lowered = host.lower()
    if lowered == "localhost":
        raise SsrfError("Endpoints on localhost are not allowed.")
    # Decimal / octal / hex IP tricks ("2130706433" == 127.0.0.1, "0x7f...").
    if host.isdigit() or lowered.startswith("0x"):
        try:
            if lowered.startswith("0x"):
                candidate = ipaddress.ip_address(int(lowered, 16))
            else:
                candidate = ipaddress.ip_address(int(lowered))
        except ValueError:
            raise SsrfError("The endpoint host is not a valid address.") from None
        reason = _blocked_reason(str(candidate))
        if reason:
            raise SsrfError(f"The endpoint host resolves to {reason}; internal endpoints are not allowed.")

    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except socket.gaierror:
        raise SsrfError(f"The endpoint host could not be resolved ('{host}').") from None

    answers = [item[4][0] for item in infos]
    for answer in answers:
        reason = _blocked_reason(answer)
        if reason:
            raise SsrfError(f"The endpoint host resolves to {reason}; internal endpoints are not allowed.")
    return answers[0]


def _connect(scheme, host, port, ip, path, headers, timeout, method="GET", payload=None):
    """Open a connection to the pinned ``ip`` speaking TLS/HTTP for ``host``.

    The TCP socket is created to the validated IP ourselves (closing the
    DNS-rebinding window), TLS is wrapped with SNI = original hostname so
    certificate verification still applies, and the pre-connected socket
    is handed to ``http.client`` (which skips its own connect() when
    ``sock`` is already set — stable across Python 3.12 → 3.14).

    ``method`` and ``payload`` default to the historical GET behavior; the
    POST path (``aikeys.ssrf.post_endpoint``) reuses this same pinned
    connection without touching the GET callers.
    """
    context = None
    raw = socket.create_connection((ip, port), timeout=timeout)
    if scheme == "https":
        context = ssl.create_default_context()
        raw = context.wrap_socket(raw, server_hostname=host)
    if scheme == "https":
        connection = http.client.HTTPSConnection(
            host, port, timeout=timeout, context=context
        )
    else:
        connection = http.client.HTTPConnection(host, port, timeout=timeout)
    connection.sock = raw
    connection.putrequest(method, path, skip_host=True)
    for name, value in headers.items():
        connection.putheader(name, value)
    if payload is not None:
        connection.putheader("Content-Length", str(len(payload)))
    connection.endheaders(payload)
    return connection


def fetch_endpoint(url, headers, timeout, transport=None):
    """GET ``url`` with SSRF guards; return ``(status, body, error)``.

    - ``status``: final HTTP status, or ``None`` when no response was
      received (SSRF block or redirect loop).
    - ``body``: the decoded response text on a 2xx, else ``None``.
    - ``error``: ``''`` while ``status`` is not ``None``; otherwise a short
      user-safe reason (it never contains the key).

    ``transport`` is an optional test hook
    ``(host, port, ip, path, headers) -> (status, location, body)``; when
    given, no real connection is opened but every SSRF check (including
    redirect re-validation) still runs.
    """
    current = url
    for _hop in range(MAX_REDIRECTS + 1):
        parsed = urllib.parse.urlsplit(current)
        scheme = parsed.scheme
        try:
            host, port, path = parse_probe_url(current)
            headers = dict(headers)
            headers.setdefault("Host", host)
            ip = resolve_public_ip(host, port)
        except SsrfError as exc:
            # First hop: the URL itself failed the gate; later hops: a
            # redirect landed somewhere internal. Either way, stop here.
            return None, None, str(exc)

        if transport is None:
            connection = _connect(scheme, host, port, ip, path, headers, timeout)
            try:
                response = connection.getresponse()
                status = response.status
                location = response.getheader("Location")
                if 200 <= status < 300:
                    body = response.read().decode("utf-8", "replace")
                else:
                    body = None
                    response.read(65536)  # drain a bounded amount, discard
            finally:
                connection.close()
        else:
            status, location, body = transport(host, port, ip, path, headers)

        if 200 <= status < 300:
            return status, body, ""
        if status in _REDIS:
            if not location:
                return status, None, ""
            current = urllib.parse.urljoin(current, location)
            continue
        return status, None, ""

    return None, None, "The provider endpoint redirected too many times."


def probe_endpoint(url, headers, timeout, transport=None):
    """GET ``url`` with SSRF guards; return ``(ok, detail)``.

    ``detail`` is a short user-safe reason — it never contains the key.
    Thin compatibility wrapper over :func:`fetch_endpoint` kept for the
    key-validation flow (which only needs success/failure, not the body).
    """
    status, _body, error = fetch_endpoint(url, headers, timeout, transport=transport)
    if status is None:
        return False, error
    if 200 <= status < 300:
        return True, ""
    if status in (401, 403):
        return False, f"The provider rejected this key (HTTP {status})."
    return False, f"The provider could not be verified (HTTP {status})."


def post_endpoint(url, headers, payload, timeout, transport=None):
    """POST ``url`` with the same SSRF guards as :func:`fetch_endpoint`.

    The full gate stack runs identically for every hop: URL shape,
    public-IP resolution of every DNS answer, pinned connections, and
    redirect re-validation. The only differences from the GET helper:

    - The request is a POST carrying ``payload`` (``str`` or ``bytes``).
    - Only 307/308 redirects are followed (they preserve method and
      body); a 301/302/303 answer is returned as-is — converting a POST
      into a body-less GET is not something this client should guess.

    Returns ``(status, body, error)`` with the same semantics as
    :func:`fetch_endpoint`. ``transport`` is an optional test hook
    ``(host, port, ip, path, headers, body) -> (status, location, body)``;
    when given, no real connection is opened but every SSRF check
    (including redirect re-validation) still runs.
    """
    body = payload.encode("utf-8") if isinstance(payload, str) else (payload or b"")
    current = url
    for _hop in range(MAX_REDIRECTS + 1):
        parsed = urllib.parse.urlsplit(current)
        scheme = parsed.scheme
        try:
            host, port, path = parse_probe_url(current)
            headers = dict(headers)
            headers.setdefault("Host", host)
            ip = resolve_public_ip(host, port)
        except SsrfError as exc:
            # First hop: the URL itself failed the gate; later hops: a
            # redirect landed somewhere internal. Either way, stop here.
            return None, None, str(exc)

        if transport is None:
            connection = _connect(
                scheme, host, port, ip, path, headers, timeout,
                method="POST", payload=body,
            )
            try:
                response = connection.getresponse()
                status = response.status
                location = response.getheader("Location")
                if 200 <= status < 300:
                    response_body = response.read().decode("utf-8", "replace")
                else:
                    response_body = None
                    response.read(65536)  # drain a bounded amount, discard
            finally:
                connection.close()
        else:
            status, location, response_body = transport(host, port, ip, path, headers, body)

        if 200 <= status < 300:
            return status, response_body, ""
        if status in (307, 308):
            if not location:
                return status, None, ""
            current = urllib.parse.urljoin(current, location)
            continue
        return status, None, ""

    return None, None, "The provider endpoint redirected too many times."


def check_url(url):
    """Public helper: does ``url`` pass the SSRF gate at all?

    Returns ``(True, '')`` or ``(False, reason)`` — no connection is made.
    """
    try:
        host, port, _path = parse_probe_url(url)
        resolve_public_ip(host, port)
    except SsrfError as exc:
        return False, str(exc)
    return True, ""
