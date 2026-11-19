"""API key validation for user-supplied AI providers (Step 1 of the AI work).

Endpoints (all under /api/ai/, see ``aikeys/urls.py``):

- ``GET  /providers/``  provider catalogue (labels + configured endpoints).
- ``POST /validate/``    test a user-supplied key against the selected
  provider and store it **encrypted** for that user when valid.
- ``GET  /status/``      what is currently stored for the signed-in user
  (provider + last-4 hint + validation time — never the key itself).
- ``POST /models/``      list available models through the user's stored
  key (Step 2.1 discovery; returns normalized ``{id, name}`` entries).
- ``POST /validate-model/`` verify a model ID against the user's stored key
  (Step 2.2): the key is decrypted server-side and a one-token ping is
  sent to the provider's OpenAI-compatible ``/chat/completions`` route.

Security rules this module enforces:

- Identity: the protected endpoints accept a valid PCL Tutor JWT
  (JWT-first, unchanged) or a login-independent device identity — the
  ``X-PCL-AI-Identity`` header, validated in ``aikeys.identity``. A
  credential row belongs to exactly one owner (account or device), so
  owners stay isolated from each other.
- The plaintext key arrives in the request body and is used exactly once:
  for the provider probe. It is never written to the database in cleartext,
  never included in any response, and never logged.
- A valid key is stored via ``aikeys.crypto.encrypt_key`` (AES-256-GCM)
  using ``AI_CREDENTIAL_ENCRYPTION_KEY`` from the environment.
- The provider probe is a cheap, token-free authentication check against
  the OpenAI-compatible ``GET {endpoint}/models`` route, so validating a
  key never consumes model usage. Model validation (Step 2.2) is a
  one-token ping against ``POST {endpoint}/chat/completions``.
- Any endpoint the user supplies (the Custom endpoint flow or an explicit
  override) is probed through the SSRF guard in ``aikeys.ssrf``: only
  http/https, public resolvable hosts, every resolved address checked,
  IP-pinned connections, and re-validation on every redirect hop.
  Operator-configured provider bases never pass through the guard.
"""

import json
import urllib.error
import urllib.request

from django.conf import settings
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from .crypto import CredentialEncryptionError, decrypt_key, encrypt_key
from .identity import JwtOrDeviceIdentity, owner_lookup
from .models import AiCredential
from .ssrf import SsrfError, check_url as ssrf_check, fetch_endpoint as ssrf_fetch, post_endpoint as ssrf_post, probe_endpoint as ssrf_probe

# A short timeout keeps a bad endpoint from hanging the request, and the
# probe hits the models route so no tokens are ever consumed.
PROBE_TIMEOUT_SECONDS = 10
PROBE_HINT_SIZE = 4
MODEL_LIST_CAP = 500


def _probe_with_ssrf_guard(base_url, api_key):
    """Probe a user-supplied endpoint through the SSRF guard (``ssrf``).

    Returns the same ``(ok, detail)`` shape as :func:`_probe_endpoint` so
    the view layer does not need to know which probe ran.
    """
    url = base_url + '/models'
    headers = {'Authorization': f'Bearer {api_key}', 'Accept': 'application/json'}
    try:
        return ssrf_probe(url, headers, PROBE_TIMEOUT_SECONDS)
    except SsrfError as exc:
        return False, str(exc)


def _normalize_endpoint(value):
    """Trim a provider base URL; return '' when it is unusable."""
    if not isinstance(value, str):
        return ''
    value = value.strip().rstrip('/')
    if not value.startswith(('http://', 'https://')):
        return ''
    return value


def _provider_catalog():
    """The provider map from settings, always with a stable key order."""
    catalog = getattr(settings, 'AI_PROVIDERS', {}) or {}
    return [
        {
            'id': provider_id,
            'label': config.get('label', provider_id),
            'endpoint': _normalize_endpoint(config.get('endpoint', '')),
        }
        for provider_id, config in catalog.items()
    ]


def _probe_endpoint(base_url, api_key):
    """Test authentication against an OpenAI-compatible provider.

    Returns ``(ok, detail)``: ``ok`` is True on a 2xx response from the
    provider's ``/models`` route, False otherwise. ``detail`` is a short,
    user-safe reason — it never contains the key or the full upstream body.
    """
    url = base_url + '/models'
    request = urllib.request.Request(
        url,
        headers={'Authorization': f'Bearer {api_key}', 'Accept': 'application/json'},
        method='GET',
    )
    try:
        with urllib.request.urlopen(request, timeout=PROBE_TIMEOUT_SECONDS) as response:
            if 200 <= response.status < 300:
                return True, ''
            return False, f'The provider answered with HTTP {response.status}.'
    except urllib.error.HTTPError as exc:
        # 401/403 means the key is known to be bad; anything else (404, 429,
        # 5xx, wrong route) means we cannot verify it, which is not the same
        # as "invalid".
        if exc.code in (401, 403):
            return False, f'The provider rejected this key (HTTP {exc.code}).'
        return False, f'The provider could not be verified (HTTP {exc.code}).'
    except (urllib.error.URLError, TimeoutError, OSError):
        return False, 'The provider endpoint could not be reached.'


def _fetch_models_plain(url, api_key):
    """GET a trusted operator-configured ``/models`` route and return its body.

    Returns ``(status, body, error)`` in the same shape as
    ``ssrf.fetch_endpoint``: ``status`` is ``None`` when nothing was
    received, ``body`` is the decoded text on 2xx, and ``error`` carries a
    short user-safe reason otherwise. The key only ever appears in the
    Authorization header — never in a response, log line, or error string.
    """
    request = urllib.request.Request(
        url,
        headers={'Authorization': f'Bearer {api_key}', 'Accept': 'application/json'},
        method='GET',
    )
    try:
        with urllib.request.urlopen(request, timeout=PROBE_TIMEOUT_SECONDS) as response:
            if 200 <= response.status < 300:
                return response.status, response.read().decode('utf-8', 'replace'), ''
            return response.status, None, ''
    except urllib.error.HTTPError as exc:
        return exc.code, None, ''
    except (urllib.error.URLError, TimeoutError, OSError):
        return None, None, 'The provider endpoint could not be reached.'


def _ping_chat_plain(url, api_key, payload):
    """POST a one-token ping to a trusted operator-configured chat route.

    Returns ``(status, error)``: ``status`` is the provider's HTTP code,
    ``None`` when no response was received; ``error`` carries a short
    user-safe reason in that case. The key only ever appears in the
    Authorization header — never in a response, log line, or error string.
    """
    request = urllib.request.Request(
        url,
        data=payload.encode('utf-8'),
        headers={
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        },
        method='POST',
    )
    try:
        with urllib.request.urlopen(request, timeout=PROBE_TIMEOUT_SECONDS) as response:
            return response.status, ''
    except urllib.error.HTTPError as exc:
        return exc.code, ''
    except (urllib.error.URLError, TimeoutError, OSError):
        return None, 'The provider endpoint could not be reached.'


class AiProviderListView(APIView):
    """GET /api/ai/providers/ — the supported providers for the settings UI."""

    def get(self, request):
        return Response({'providers': _provider_catalog()})


class AiKeyValidateView(APIView):
    """POST /api/ai/validate/ — validate and store a user-supplied AI key."""

    permission_classes = [JwtOrDeviceIdentity]

    def post(self, request):
        lookup, _kind = owner_lookup(request)
        if lookup is None:  # Unreachable: JwtOrDeviceIdentity already answered 401.
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        provider = str(request.data.get('provider', '')).strip().lower()
        api_key = str(request.data.get('api_key', '')).strip()
        catalog = _provider_catalog()
        known = {item['id'] for item in catalog}
        if provider not in known:
            return Response(
                {'error': f'Unknown provider "{provider}". Supported: {", ".join(sorted(known))}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        if not api_key:
            return Response(
                {'error': 'api_key is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Endpoint resolution: an explicit request value (the "Custom
        # endpoint" flow) wins, otherwise the configured provider base.
        user_supplied_endpoint = bool(_normalize_endpoint(request.data.get('endpoint')))
        endpoint = _normalize_endpoint(request.data.get('endpoint'))
        if not endpoint:
            endpoint = next(item['endpoint'] for item in catalog if item['id'] == provider)
        if not endpoint:
            return Response(
                {'error': 'No endpoint is configured for the selected provider.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        master_key = getattr(settings, 'AI_CREDENTIAL_ENCRYPTION_KEY', '')
        if not master_key:
            # Do not probe or store anything: without the master key a valid
            # key would have nowhere safe to live.
            return Response(
                {
                    'error': (
                        'AI credential storage is not configured '
                        '(AI_CREDENTIAL_ENCRYPTION_KEY is missing on the server).'
                    ),
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        # The single point where the plaintext key meets the provider. It is
        # never logged here or anywhere else in this module.
        #
        # Anything the USER types in (an endpoint override) goes through the
        # SSRF guard; the operator-configured provider bases are trusted and
        # keep the plain probe so custom self-hosted gateways keep working.
        probe = _probe_with_ssrf_guard if user_supplied_endpoint else _probe_endpoint
        ok, detail = probe(endpoint, api_key)
        if not ok:
            return Response({'valid': False, 'stored': False, 'message': detail})

        try:
            blob = encrypt_key(api_key, master_key)
        except CredentialEncryptionError as exc:
            return Response({'error': str(exc)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)

        label = next(item['label'] for item in catalog if item['id'] == provider)
        credential, _created = AiCredential.objects.update_or_create(
            **lookup,
            defaults={
                'provider': provider,
                'encrypted_key': blob,
                'key_hint': api_key[-PROBE_HINT_SIZE:],
            },
        )
        return Response(
            {
                'valid': True,
                'stored': True,
                'provider': provider,
                'key_hint': credential.key_hint,
                'message': f'Key verified and stored encrypted for {label}.',
            }
        )


class AiCredentialStatusView(APIView):
    """GET /api/ai/status/ — what (if anything) is stored for this owner."""

    permission_classes = [JwtOrDeviceIdentity]

    def get(self, request):
        lookup, _kind = owner_lookup(request)
        if lookup is None:  # Unreachable: JwtOrDeviceIdentity already answered 401.
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        credential = AiCredential.objects.filter(**lookup).first()
        if credential is None:
            return Response({'configured': False})
        master_key = getattr(settings, 'AI_CREDENTIAL_ENCRYPTION_KEY', '')
        stored = False
        hint = ''
        if master_key:
            try:
                # Proves the blob still decrypts; the plaintext is used
                # only to confirm and never leaves this request.
                decrypt_key(credential.encrypted_key, master_key)
                stored = True
                hint = credential.key_hint
            except CredentialEncryptionError:
                stored = False
        return Response(
            {
                'configured': True,
                'provider': credential.provider,
                'key_hint': hint if stored else '',
                'verified': stored,
                'validated_at': credential.validated_at.isoformat(),
            }
        )


def _normalize_model_list(body):
    """Normalize an OpenAI-compatible ``/models`` payload into ``[{id, name}]``.

    Returns ``(models, error)`` — ``models`` is empty and ``error`` set when
    the payload is not the expected shape. Entries without an ``id`` (or
    that are not objects) are skipped, ``name`` falls back to the id, and
    duplicate ids are kept once, in order.
    """
    try:
        payload = json.loads(body) if body else None
    except ValueError:
        return [], 'The provider returned an unexpected response.'
    entries = payload.get('data') if isinstance(payload, dict) else None
    if not isinstance(entries, list):
        return [], 'The provider returned an unexpected response.'

    seen = set()
    models = []
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        model_id = str(entry.get('id') or '').strip()
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        models.append({'id': model_id, 'name': str(entry.get('name') or model_id).strip()})
        if len(models) >= MODEL_LIST_CAP:
            break
    return models, ''


class AiModelsView(APIView):
    """POST /api/ai/models/ — list models through the user's stored key.

    Step 2.1 of the AI work: discovery only. The signed-in user's stored,
    encrypted credential is decrypted for the duration of this request,
    used to call the provider's OpenAI-compatible ``GET {endpoint}/models``
    route, and never returned, logged, or written back anywhere.

    - The provider is the one the credential was validated against
      (OpenAI / DeepSeek / ModelScope / Custom).
    - A user-supplied ``endpoint`` override (the Custom flow) passes the
      SSRF gate first and is fetched through the guarded transport;
      operator-configured provider bases are trusted and fetched plainly.
    """

    permission_classes = [JwtOrDeviceIdentity]

    def post(self, request):
        lookup, _kind = owner_lookup(request)
        if lookup is None:  # Unreachable: JwtOrDeviceIdentity already answered 401.
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        credential = AiCredential.objects.filter(**lookup).first()
        if credential is None:
            return Response(
                {'error': 'No API key is stored yet. Validate a key first.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        provider = credential.provider
        catalog = _provider_catalog()
        known = {item['id'] for item in catalog}
        if provider not in known:
            return Response(
                {'error': f'Unsupported provider "{provider}". Supported: {", ".join(sorted(known))}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Endpoint resolution mirrors the validate flow: an explicit request
        # value wins, otherwise the configured provider base.
        user_supplied_endpoint = bool(_normalize_endpoint(request.data.get('endpoint')))
        endpoint = _normalize_endpoint(request.data.get('endpoint'))
        if not endpoint:
            endpoint = next(item['endpoint'] for item in catalog if item['id'] == provider)
        if not endpoint:
            return Response(
                {'error': 'No endpoint is configured for the selected provider.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        master_key = getattr(settings, 'AI_CREDENTIAL_ENCRYPTION_KEY', '')
        if not master_key:
            return Response(
                {'error': 'AI credential storage is not configured (AI_CREDENTIAL_ENCRYPTION_KEY is missing on the server).'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        try:
            api_key = decrypt_key(credential.encrypted_key, master_key)
        except CredentialEncryptionError:
            return Response(
                {'error': 'The stored credential could not be read. Please validate your key again.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        url = endpoint + '/models'
        headers = {'Authorization': f'Bearer {api_key}', 'Accept': 'application/json'}

        if user_supplied_endpoint:
            allowed, reason = ssrf_check(url)
            if not allowed:
                return Response({'error': reason}, status=status.HTTP_400_BAD_REQUEST)
            http_status, body, error = ssrf_fetch(url, headers, PROBE_TIMEOUT_SECONDS)
        else:
            http_status, body, error = _fetch_models_plain(url, api_key)

        if http_status is None:
            detail = error or 'The provider endpoint could not be reached.'
            return Response({'provider': provider, 'models': [], 'error': detail})
        if 200 <= http_status < 300:
            models, shape_error = _normalize_model_list(body)
            if shape_error:
                return Response({'provider': provider, 'models': [], 'error': shape_error})
            return Response({'provider': provider, 'models': models, 'error': ''})
        if http_status in (401, 403):
            return Response(
                {'provider': provider, 'models': [], 'error': f'The provider rejected this key (HTTP {http_status}).'}
            )
        return Response(
            {'provider': provider, 'models': [], 'error': f'The provider could not be verified (HTTP {http_status}).'}
        )


class AiModelValidateView(APIView):
    """POST /api/ai/validate-model/ — verify a model ID against the stored key.

    Step 2.2 of the AI work. The API key is never re-sent by the client: the
    user's encrypted credential is decrypted for the duration of this request
    and a single one-token ping is sent to the provider's OpenAI-compatible
    ``POST {endpoint}/chat/completions`` route. A 2xx means the model exists
    and is usable with that key; provider error codes are mapped onto the
    same user-safe messages the study-plan flow classifies on.

    - The provider is the one the credential was validated against; a user-
      supplied ``endpoint`` override (the Custom flow) passes the SSRF gate
      first and is POSTed through the guarded transport. Operator-configured
      provider bases are trusted and POSTed plainly.
    - The decrypted key only ever appears in the Authorization header — never
      in a response, log line, or error string.
    """

    permission_classes = [JwtOrDeviceIdentity]

    def post(self, request):
        lookup, _kind = owner_lookup(request)
        if lookup is None:  # Unreachable: JwtOrDeviceIdentity already answered 401.
            return Response(status=status.HTTP_401_UNAUTHORIZED)
        credential = AiCredential.objects.filter(**lookup).first()
        if credential is None:
            return Response(
                {'error': 'No API key is stored yet. Validate a key first.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        provider = credential.provider
        catalog = _provider_catalog()
        known = {item['id'] for item in catalog}
        if provider not in known:
            return Response(
                {'error': f'Unsupported provider "{provider}". Supported: {", ".join(sorted(known))}.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        label = next(item['label'] for item in catalog if item['id'] == provider)

        model = str(request.data.get('model', '')).strip()
        if not model:
            return Response(
                {'error': 'model is required.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Endpoint resolution mirrors the validate / models flows: an explicit
        # request value (the Custom flow) wins, otherwise the configured base.
        user_supplied_endpoint = bool(_normalize_endpoint(request.data.get('endpoint')))
        endpoint = _normalize_endpoint(request.data.get('endpoint'))
        if not endpoint:
            endpoint = next(item['endpoint'] for item in catalog if item['id'] == provider)
        if not endpoint:
            return Response(
                {'error': 'No endpoint is configured for the selected provider.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        master_key = getattr(settings, 'AI_CREDENTIAL_ENCRYPTION_KEY', '')
        if not master_key:
            return Response(
                {'error': 'AI credential storage is not configured (AI_CREDENTIAL_ENCRYPTION_KEY is missing on the server).'},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        try:
            api_key = decrypt_key(credential.encrypted_key, master_key)
        except CredentialEncryptionError:
            return Response(
                {'error': 'The stored credential could not be read. Please validate your key again.'},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        url = endpoint + '/chat/completions'
        payload = json.dumps({
            'model': model,
            'messages': [{'role': 'user', 'content': 'ping'}],
            'max_tokens': 1,
        })
        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json',
            'Accept': 'application/json',
        }

        if user_supplied_endpoint:
            allowed, reason = ssrf_check(url)
            if not allowed:
                return Response(
                    {'valid': False, 'model': model, 'message': reason},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            http_status, _body, error = ssrf_post(url, headers, payload, PROBE_TIMEOUT_SECONDS)
        else:
            http_status, error = _ping_chat_plain(url, api_key, payload)

        if http_status is None:
            detail = error or 'The provider endpoint could not be reached.'
            return Response({'valid': False, 'model': model, 'message': detail})
        if 200 <= http_status < 300:
            return Response({
                'valid': True,
                'model': model,
                'message': f'Model "{model}" is available and responds on {label}.',
            })
        if http_status in (401, 403):
            message = f'The provider rejected this key (HTTP {http_status}). Validate the key again in Settings.'
        elif http_status == 404:
            message = ('The provider could not find the selected model (HTTP 404). '
                      "Check the model ID in Settings, or pick one from the provider's model list.")
        elif http_status == 400:
            message = ('The provider rejected the request for the selected model (HTTP 400). '
                      'Check the model ID, or validate a key for this provider in Settings.')
        elif http_status == 429:
            message = 'The provider rate-limited this request (HTTP 429). Try again in a moment.'
        else:
            message = f'The provider could not verify the selected model (HTTP {http_status}).'
        return Response({'valid': False, 'model': model, 'message': message})
