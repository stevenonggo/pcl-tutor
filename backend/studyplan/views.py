"""OpenRouter proxy for the PCL Tutor AI Study Plan feature.

The React frontend calls this endpoint instead of talking to OpenRouter
directly, so the API key stays server-side (in ``.env``) and is never exposed
to the browser. When the key is missing or the upstream call fails, the
response carries ``fallback: True`` so the client can fall back to its local,
deterministic generator.

No new runtime dependency is added: the upstream call uses the standard-library
``urllib``.
"""

import json
import os
import urllib.error
import urllib.request

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView

OPENROUTER_ENDPOINT = os.getenv(
    "OPENROUTER_ENDPOINT", "https://openrouter.ai/api/v1/chat/completions"
)
DEFAULT_MODEL = os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini")

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
