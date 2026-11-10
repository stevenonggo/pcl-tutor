# Study Plan endpoint — security risk register (Phase 1, documented)

Status: **accepted risk for local development only. Not production-ready.**

## The endpoint

`POST /api/study-plan/generate/` in `backend/studyplan/views.py` proxies
OpenRouter. The backend holds `OPENROUTER_API_KEY` server-side so clients
never see it — good. But the view has:

- **no authentication** (`permissions` unset, anyone with network access
  can call it),
- **no rate limiting** (no Throttling classes on the DRF default settings),
- **no per-user accounting** (consumption is not tied to an account).

## Concrete risks

1. **Cost/quota exposure.** Any client that can reach the server can spend
   the owner's OpenRouter credits. A single scripted loop can exhaust the
   quota or the budget.
2. **Abuse vector.** If the backend is ever deployed on a public host
   (it is currently dev-only: `DEBUG=True`, `ALLOWED_HOSTS=[]`), the open
   endpoint becomes free LLM infrastructure for strangers.
3. **Information leakage in errors.** Upstream error bodies are echoed back
   truncated (300 chars), which can reveal provider-side detail to callers.

## Why it is acceptable in Phase 1

- The decision (2026-11-09) was to keep the endpoint unchanged for local
  development so the mobile app can be scaffolded without backend edits.
- The Django dev server is not public; exposure is limited to the local
  machine / LAN while developing.
- The mobile app does not add new exposure: it calls the same endpoint the
  web app already calls.

## Required before any public release

1. Add `permission_classes = [permissions.IsAuthenticated]` to
   `GenerateStudyPlanView` and send the JWT from the app (the mobile client
   already carries a working access token; one header change on the view).
2. Add DRF throttling (e.g. `AnonRateThrottle` off + user-scoped
   throttle scope) to cap generations per user.
3. Sanitize upstream error propagation (log details server-side, return
   generic messages to clients).
4. Remove `DEBUG=True` / harden `ALLOWED_HOSTS` and `SECRET_KEY` for the
   deployed environment.

## Related backend hardening (out of scope, noted in the audit)

- `SECRET_KEY` is an insecure placeholder in `settings.py`.
- `DEBUG=True`, `ALLOWED_HOSTS=[]` are dev-only settings.
- `.env` (Mongo URI, OpenRouter key) is gitignored and must stay that way.
