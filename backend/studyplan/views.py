"""OpenRouter proxy for the PCL Tutor AI Study Plan feature.

The React frontend calls this endpoint instead of talking to OpenRouter
directly, so the API key stays server-side (in ``.env``) and is never exposed
to the browser. When the key is missing or the upstream call fails, the
response carries ``fallback: True`` so the client can fall back to its local,
deterministic generator.

No new runtime dependency is added: the upstream call uses the standard-library
``urllib``.

BYOK branch: when the payload carries a ``model`` field, the plan is generated
through the owner's stored, server-side-encrypted API key (the provider is
taken from the stored credential, never from the request) using that exact
selected model. BYOK requests have no server-key fallback — they resolve an
identity (JWT or device) via :func:`aikeys.identity.owner_lookup` and any
failure is returned as an error so the client can surface it. Requests without
a ``model`` field run the legacy OpenRouter flow unchanged.
"""

import json
import os
import urllib.error
import urllib.request

from django.conf import settings
from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

from aikeys import ssrf
from aikeys.crypto import CredentialEncryptionError, decrypt_key
from aikeys.identity import owner_lookup
from aikeys.models import AiCredential
from aikeys.views import _normalize_endpoint, _provider_catalog

OPENROUTER_ENDPOINT = os.getenv(
    "OPENROUTER_ENDPOINT", "https://openrouter.ai/api/v1/chat/completions"
)
DEFAULT_MODEL = os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini")
BYOK_TIMEOUT_SECONDS = 90

# Ask the model for exactly the shape the local generator already produces, so
# the client can merge the AI result over its local skeleton without UI changes.
_SYSTEM_PROMPT = (
    "You are an expert study planner. Respond with a JSON object ONLY, matching "
    "this exact schema: "
    '{"firstSteps": ["..."], "phases": [{"title": "...", "topics": ["..."], '
    '"activities": ["..."], "milestone": "..."}], "tip": "..."}. '
    "Keep topics to 3-6 items and activities to 3-5 items. Output no text "
    "outside the JSON object."
)


def _user_prompt(payload):
    subject = str(payload.get("subject", "General")).strip() or "General"
    topic = str(payload.get("topic", "")).strip()
    try:
        weeks = int(payload.get("weeks", 2))
    except (TypeError, ValueError):
        weeks = 2
    weeks = max(1, min(4, weeks))
    level = str(payload.get("level", "Intermediate")).strip() or "Intermediate"
    goal = str(payload.get("goal", "Understand the concepts")).strip() or "Understand the concepts"
    cadence = str(payload.get("cadence", "Moderate (~5 h/week)")).strip() or "Moderate (~5 h/week)"

    lines = [
        f"Subject: {subject}",
        f"Timeframe: {weeks} week{'s' if weeks > 1 else ''}",
        f"Current level: {level}",
        f"Goal: {goal}",
        f"Weekly time: {cadence}",
    ]
    if topic:
        lines.insert(1, f"Topic focus: {topic}")
    lines.append(f"Produce exactly {weeks} phased study week(s) (phases array length = {weeks}).")
    return "\n".join(lines)


class GenerateStudyPlanView(APIView):
    """POST a study-plan request; returns an OpenRouter plan or a fallback signal."""

    def post(self, request):
        payload = request.data or {}
        if not str(payload.get("subject", "")).strip():
            return Response(
                {"error": "subject is required."}, status=status.HTTP_400_BAD_REQUEST
            )

        selected_model = str(payload.get("model", "")).strip()
        if selected_model:
            return self._generate_byok(request, payload, selected_model)

        api_key = os.getenv("OPENROUTER_API_KEY", "").strip()
        if not api_key:
            return Response(
                {"error": "OPENROUTER_API_KEY is not configured.", "fallback": True},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        model = os.getenv("OPENROUTER_MODEL", DEFAULT_MODEL)
        body = json.dumps(
            {
                "model": model,
                "messages": [
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": _user_prompt(payload)},
                ],
                "response_format": {"type": "json_object"},
                "temperature": 0.4,
            }
        ).encode("utf-8")

        req = urllib.request.Request(
            OPENROUTER_ENDPOINT,
            data=body,
            method="POST",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "X-Title": "PCL Tutor",
            },
        )

        try:
            with urllib.request.urlopen(req, timeout=90) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:300]
            return Response(
                {"error": f"OpenRouter returned {exc.code}: {detail}", "fallback": True},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, OSError) as exc:
            return Response(
                {"error": f"OpenRouter request failed: {exc}", "fallback": True},
                status=status.HTTP_502_BAD_GATEWAY,
            )

        try:
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")
            plan = json.loads(content) if isinstance(content, str) else content
            if not isinstance(plan, dict):
                raise ValueError("OpenRouter did not return a JSON object")
        except (ValueError, KeyError, IndexError, json.JSONDecodeError) as exc:
            return Response(
                {"error": f"Could not parse OpenRouter response: {exc}", "fallback": True},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response(
            {"plan": plan, "model": data.get("model", model), "source": "openrouter"}
        )

    def _generate_byok(self, request, payload, model):
        """Generate the plan through the owner's stored BYOK credential.

        The provider is taken from the stored credential (never from the
        request); only the selected model ID and an optional custom endpoint
        are client-supplied. There is no server-key fallback: every failure
        mode returns an error with ``fallback: True`` so the client can
        surface it, and the legacy OpenRouter path is never engaged.
        """
        lookup, _kind = owner_lookup(request)
        if lookup is None:
            return Response(
                {
                    "error": "No PCL Tutor identity is present (sign-in or device identity).",
                    "fallback": True,
                },
                status=status.HTTP_401_UNAUTHORIZED,
            )

        credential = AiCredential.objects.filter(**lookup).first()
        if credential is None:
            return Response(
                {
                    "error": "No API key is stored for this account yet. Validate a key in Settings first.",
                    "fallback": True,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        provider = credential.provider
        catalog = _provider_catalog()
        known = {item["id"] for item in catalog}
        if provider not in known:
            return Response(
                {
                    "error": f'Unsupported provider "{provider}". Supported: {", ".join(sorted(known))}.',
                    "fallback": True,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        user_supplied_endpoint = bool(_normalize_endpoint(payload.get("endpoint")))
        endpoint = _normalize_endpoint(payload.get("endpoint"))
        if not endpoint:
            endpoint = next(
                (item["endpoint"] for item in catalog if item["id"] == provider), ""
            )
        if not endpoint:
            return Response(
                {
                    "error": "No endpoint is configured for the selected provider.",
                    "fallback": True,
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        master_key = getattr(settings, "AI_CREDENTIAL_ENCRYPTION_KEY", "")
        if not master_key:
            return Response(
                {
                    "error": "AI credential storage is not configured (AI_CREDENTIAL_ENCRYPTION_KEY is missing on the server). Ask the operator to configure it.",
                    "fallback": True,
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        try:
            api_key = decrypt_key(credential.encrypted_key, master_key)
        except CredentialEncryptionError:
            return Response(
                {
                    "error": "The stored credential could not be read. Please validate your key again.",
                    "fallback": True,
                },
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )

        request_body = json.dumps(
            {
                "model": model,
                "messages": [
                    {"role": "system", "content": _SYSTEM_PROMPT},
                    {"role": "user", "content": _user_prompt(payload)},
                ],
                "temperature": 0.4,
                # ``response_format`` is only sent for providers that
                # document OpenAI-compatible support; for others the plan is
                # parsed leniently instead.
                **({"response_format": {"type": "json_object"}} if provider == "openai" else {}),
            }
        ).encode("utf-8")
        url = endpoint.rstrip("/") + "/chat/completions"
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }

        if user_supplied_endpoint:
            allowed, reason = ssrf.check_url(url)
            if not allowed:
                return Response(
                    {"error": reason, "fallback": True},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            http_status, body_text, error = ssrf.post_endpoint(
                url, headers, request_body, BYOK_TIMEOUT_SECONDS
            )
        else:
            http_status, body_text, error = _post_plain(
                url, headers, request_body, BYOK_TIMEOUT_SECONDS
            )

        if http_status is None:
            return Response(
                {"error": error or "The provider endpoint could not be reached.", "fallback": True},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        if 200 <= http_status < 300:
            try:
                data = json.loads(body_text)
                if not isinstance(data, dict):
                    raise ValueError("The provider response was not a JSON object")
                content = (data.get("choices") or [{}])[0].get("message", {}).get("content", "")
                plan = _extract_plan_json(content)
                if plan is None:
                    raise ValueError("The provider response did not contain a JSON study plan")
            except (ValueError, KeyError, IndexError, TypeError, json.JSONDecodeError) as exc:
                return Response(
                    {"error": f"Could not parse the provider response: {exc}", "fallback": True},
                    status=status.HTTP_502_BAD_GATEWAY,
                )
            return Response(
                {
                    "plan": plan,
                    "model": data.get("model") or model,
                    "source": f"byok-{provider}",
                }
            )
        if http_status in (401, 403):
            error = "The provider rejected this key. Validate the key again in Settings."
        elif http_status == 404:
            error = (
                "The provider could not find the selected model (HTTP 404). "
                "Check the model ID in Settings, or pick one from the provider's model list."
            )
        elif http_status == 429:
            error = "The provider rate-limited this request (HTTP 429). Try again in a moment."
        elif 400 <= http_status < 500:
            error = (
                f"The provider rejected the request for the selected model (HTTP {http_status}). "
                "Check the model ID, or validate a key for this provider in Settings."
            )
        else:
            error = f"The provider could not generate a plan (HTTP {http_status})."
        return Response(
            {"error": error, "fallback": True},
            status=status.HTTP_502_BAD_GATEWAY,
        )


def _extract_plan_json(content):
    """Parse provider assistant text into the JSON plan object, leniently.

    Providers supporting ``response_format: json_object`` answer with a raw
    JSON string; others may wrap the object in prose or markdown fences.
    All three shapes are accepted so model quirks don't break plan parsing.
    """
    if not isinstance(content, str):
        return None
    try:
        parsed = json.loads(content.strip())
        if isinstance(parsed, dict):
            return parsed
    except json.JSONDecodeError:
        pass
    start, end = content.find("{"), content.rfind("}")
    if start == -1 or end <= start:
        return None
    try:
        parsed = json.loads(content[start : end + 1])
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _post_plain(url, headers, payload, timeout):
    """POST to a trusted, operator-configured provider base (never SSRF-gated).

    Mirrors ``aikeys.views._fetch_models_plain`` for POST. Returns
    ``(status, body, error)`` with the same semantics as the ssrf helpers.
    """
    req = urllib.request.Request(url, data=payload, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            if 200 <= resp.status < 300:
                return resp.status, resp.read().decode("utf-8", "replace"), ""
            return resp.status, None, ""
    except urllib.error.HTTPError as exc:
        return exc.code, None, ""
    except (urllib.error.URLError, TimeoutError, OSError):
        return None, None, "The provider endpoint could not be reached."
