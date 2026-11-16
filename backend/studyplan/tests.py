"""Focused tests for the BYOK branch of POST /api/study-plan/generate/.

Conventions follow ``aikeys/test_models.py``: unique ``pctest_`` users,
provider transports stubbed (no real network), the SSRF *gate*
(``aikeys.ssrf.check_url``) runs for real so internal-endpoint tests are
deterministic and offline, and the provider catalog / master key are
overridden with fixtures so the tests never depend on the server's
``.env`` values.

Coverage:
- ``aikeys.ssrf.post_endpoint``: gate behavior, 307/308 semantics,
  redirect re-validation, and the untouched GET path.
- BYOK generation: device identity, JWT ownership, JWT priority,
  isolation, missing credentials/identity, SSRF blocking, upstream
  errors, exact selected-model usage, response-format handling, and
  the critical no-silent-fallback rule (BYOK never touches the legacy
  OpenRouter env key).
- Legacy regression: requests without a ``model`` field run the
  OpenRouter flow exactly as before.
"""

import json
import os
import uuid
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from aikeys import ssrf as aikeys_ssrf
from aikeys.crypto import encrypt_key
from aikeys.models import AiCredential
from users.models import User

MASTER = "test-master-key-for-aikeys"
STORED_KEY = "stored-demo-key-5150"   # device-identity owner
USER_KEY = "user-account-key-7371"    # JWT account owner
DEVICE_KEY = "device-uuid-key-0424"   # second device identity (isolation)

# Deterministic catalog: bases use the unresolvable .local TLD; the tests
# stub every transport, so these hosts are never contacted.
FIXTURE_PROVIDERS = {
    "deepseek": {"label": "DeepSeek", "endpoint": "https://fixture.deepseek.local/v1"},
    "openai": {"label": "OpenAI", "endpoint": "https://fixture.openai.local/v1"},
    "modelscope": {"label": "ModelScope (DashScope)", "endpoint": "https://fixture.dashscope.local/v1"},
    "custom": {"label": "Custom endpoint", "endpoint": ""},
}

CHAT_PLAN = {
    "firstSteps": ["Read chapters 1-2", "Solve five problems"],
    "phases": [
        {
            "title": "Week 1",
            "topics": ["Basics"],
            "activities": ["Lecture notes"],
            "milestone": "Quiz ready",
        },
        {
            "title": "Week 2",
            "topics": ["Applied problems"],
            "activities": ["Lab session"],
            "milestone": "Midterm ready",
        },
    ],
    "tip": "Review daily for fifteen minutes.",
}


def uid():
    return uuid.uuid4().hex[:12]


def _chat_body(content, model="fixture-model"):
    return json.dumps({"choices": [{"message": {"content": content}}], "model": model})


class _PlainRecorder:
    """Stub for ``studyplan.views._post_plain`` (trusted operator bases)."""

    def __init__(self, result):
        self.result = result
        self.calls = []

    def __call__(self, url, headers, payload, timeout):
        self.calls.append((url, dict(headers), payload))
        return self.result


class _GuardedPostRecorder:
    """Stub for ``aikeys.ssrf.post_endpoint`` (user-supplied endpoints)."""

    def __init__(self, result):
        self.result = result
        self.calls = []

    def __call__(self, url, headers, payload, timeout, transport=None):
        self.calls.append((url, dict(headers), payload))
        return self.result


class PostEndpointSsrfTests(TestCase):
    """The new guarded POST transport reuses every guard from the GET path."""

    def _transport(self, *results):
        """Build a hook returning one (status, location, body) tuple each hop."""
        state = {"results": list(results), "calls": []}

        def hook(host, port, ip, path, headers, body):
            state["calls"].append((host, port, ip, path, headers, body))
            return state["results"].pop(0)

        return hook, state

    def test_loopback_url_rejected_before_any_connection(self):
        hook, state = self._transport()
        status, body, error = aikeys_ssrf.post_endpoint(
            "http://127.0.0.1:59999/v1/chat/completions",
            {"Authorization": "Bearer test"},
            "{}",
            5,
            transport=hook,
        )
        self.assertIsNone(status)
        self.assertIsNone(body)
        self.assertIn("loopback", error)
        self.assertEqual(state["calls"], [])

    def test_metadata_endpoint_rejected(self):
        hook, _state = self._transport()
        _status, _body, error = aikeys_ssrf.post_endpoint(
            "http://169.254.169.254/latest/meta-data", {}, "{}", 5, transport=hook
        )
        self.assertIn("link-local", error)

    def test_private_lan_rejected(self):
        hook, _state = self._transport()
        _status, _body, error = aikeys_ssrf.post_endpoint(
            "http://192.168.0.102:3000/v1/chat/completions", {}, "{}", 5, transport=hook
        )
        self.assertIn("private", error)

    def test_public_literal_two_xx_returns_body(self):
        payload = json.dumps({"model": "m"})
        hook, state = self._transport((200, None, _chat_body("x")))
        status, body, error = aikeys_ssrf.post_endpoint(
            "https://8.8.8.8:8443/gw/v1/chat/completions",
            {"Authorization": "Bearer test"},
            payload,
            5,
            transport=hook,
        )
        self.assertEqual(status, 200)
        self.assertEqual(error, "")
        self.assertEqual(body, _chat_body("x"))
        # Exactly one hop; the string payload was re-sent as UTF-8 bytes.
        self.assertEqual(len(state["calls"]), 1)
        self.assertEqual(state["calls"][0][5], payload.encode("utf-8"))

    def test_307_reposts_body_and_revalidates_redirect(self):
        payload = json.dumps({"model": "m"})
        hook, state = self._transport(
            (307, "http://127.0.0.1:9999/internal/v1", None),
            (200, None, _chat_body("x")),  # unreachable: hop 2 is blocked first
        )
        status, _body, error = aikeys_ssrf.post_endpoint(
            "https://8.8.8.8:8443/gw/v1/chat/completions",
            {"Authorization": "Bearer test"},
            payload,
            5,
            transport=hook,
        )
        self.assertIsNone(status)
        self.assertIn("loopback", error)
        # Exactly one real hop happened; the body was re-sent verbatim and
        # the redirect target was re-gated (not fetched).
        self.assertEqual(len(state["calls"]), 1)
        self.assertEqual(state["calls"][0][5], payload.encode("utf-8"))

    def test_301_is_returned_not_followed(self):
        hook, state = self._transport((301, "http://8.8.8.8/elsewhere", None))
        status, body, error = aikeys_ssrf.post_endpoint(
            "https://8.8.8.8:8443/gw/v1/chat/completions", {}, "{}", 5, transport=hook
        )
        self.assertEqual(status, 301)
        self.assertIsNone(body)
        self.assertEqual(error, "")
        self.assertEqual(len(state["calls"]), 1)

    def test_redirect_loop_rejected(self):
        hook, state = self._transport(
            (308, "https://8.8.8.8:8443/gw/v1/chat/completions", None),
            (308, "https://8.8.8.8:8443/gw/v1/chat/completions", None),
            (308, "https://8.8.8.8:8443/gw/v1/chat/completions", None),
            (308, "https://8.8.8.8:8443/gw/v1/chat/completions", None),
        )
        status, _body, error = aikeys_ssrf.post_endpoint(
            "https://8.8.8.8:8443/gw/v1/chat/completions", {}, "{}", 5, transport=hook
        )
        self.assertIsNone(status)
        self.assertIn("redirected too many times", error)
        self.assertEqual(len(state["calls"]), 4)  # initial hop + MAX_REDIRECTS

    def test_get_fetch_endpoint_unchanged(self):
        # Regression guard for the _connect refactor: the historical GET
        # gate still blocks internal targets and reports the same reason.
        status, body, error = aikeys_ssrf.fetch_endpoint(
            "http://127.0.0.1:59999/v1", {}, 5
        )
        self.assertIsNone(status)
        self.assertIsNone(body)
        self.assertIn("loopback", error)


@override_settings(AI_PROVIDERS=FIXTURE_PROVIDERS, AI_CREDENTIAL_ENCRYPTION_KEY=MASTER)
class ByokGenerateTests(TestCase):
    """BYOK generation: identity, ownership, SSRF, upstream handling."""

    def setUp(self):
        self.suffix = uid()
        self.user = User.objects.create_user(
            username=f"pctest_splan_{self.suffix}",
            email=f"pctest-splan-{self.suffix}@example.com",
            password="pctest-pass-123",
            role="student",
        )
        self.user_credential = AiCredential.objects.create(
            user=self.user,
            provider="openai",
            encrypted_key=encrypt_key(USER_KEY, MASTER),
            key_hint=USER_KEY[-4:],
        )
        self.device_token = str(uuid.uuid4())
        self.device_credential = AiCredential.objects.create(
            user=None,
            identity_token=self.device_token,
            provider="deepseek",
            encrypted_key=encrypt_key(STORED_KEY, MASTER),
            key_hint=STORED_KEY[-4:],
        )
        self.anon = APIClient()

    def tearDown(self):
        self.user.delete()
        super().tearDown()

    def _post_plain(self, result):
        import studyplan.views as views

        recorder = _PlainRecorder(result)
        original = views._post_plain
        views._post_plain = recorder
        self.addCleanup(lambda: setattr(views, "_post_plain", original))
        return recorder

    def _patch_guarded(self, result):
        recorder = _GuardedPostRecorder(result)
        original = aikeys_ssrf.post_endpoint
        aikeys_ssrf.post_endpoint = recorder
        self.addCleanup(lambda: setattr(aikeys_ssrf, "post_endpoint", original))
        return recorder

    def _byok_success(self, provider=None):
        content = json.dumps(CHAT_PLAN)
        result = (200, _chat_body(content, model="selected-model-id"), "")
        if provider == "custom":
            recorder = self._patch_guarded(result)
            payload = {
                "subject": "Databases",
                "model": "selected-model-id",
                "endpoint": "https://8.8.8.8:8443/gw/v1",
            }
        else:
            recorder = self._post_plain(result)
            payload = {"subject": "Databases", "model": "selected-model-id"}
        return self.anon.post(
            "/api/study-plan/generate/", payload, format="json",
            HTTP_X_PCL_AI_IDENTITY=self.device_token,
        ), recorder

    # --- identity & ownership -------------------------------------------------

    def test_device_identity_generates_plan(self):
        resp, recorder = self._byok_success()
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["plan"], CHAT_PLAN)
        self.assertEqual(body["source"], "byok-deepseek")
        self.assertEqual(body["model"], "selected-model-id")
        # The operator-configured base was used, with /chat/completions appended.
        self.assertEqual(recorder.calls[0][0], "https://fixture.deepseek.local/v1/chat/completions")
        # The decrypted stored key was sent upstream in the Authorization
        # header (expected — it is the provider's auth); but the key must
        # never appear in the API response.
        self.assertEqual(recorder.calls[0][1]["Authorization"], f"Bearer {STORED_KEY}")
        self.assertNotIn(STORED_KEY, str(body))

    def test_jwt_account_credential_is_used(self):
        recorder = self._post_plain((200, _chat_body(json.dumps(CHAT_PLAN)), ""))
        client = APIClient()
        client.force_authenticate(user=self.user)
        resp = client.post(
            "/api/study-plan/generate/",
            {"subject": "Databases", "model": "gpt-4o-mini"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["source"], "byok-openai")
        self.assertEqual(recorder.calls[0][1]["Authorization"], f"Bearer {USER_KEY}")
        # The provider is taken from the stored credential, not the request.
        self.assertNotIn("provider", json.loads(recorder.calls[0][2]))

    def test_jwt_takes_priority_over_device_header(self):
        recorder = self._post_plain((200, _chat_body(json.dumps(CHAT_PLAN)), ""))
        client = APIClient()
        client.force_authenticate(user=self.user)
        resp = client.post(
            "/api/study-plan/generate/",
            {"subject": "Databases", "model": "gpt-4o-mini"},
            format="json",
            HTTP_X_PCL_AI_IDENTITY=self.device_token,
        )
        self.assertEqual(resp.status_code, 200)
        # JWT-first: the account's own credential wins over the device header.
        self.assertEqual(recorder.calls[0][1]["Authorization"], f"Bearer {USER_KEY}")
        self.assertEqual(resp.json()["source"], "byok-openai")

    def test_device_isolation_second_device_gets_400(self):
        other_token = str(uuid.uuid4())
        self._post_plain((200, _chat_body(json.dumps(CHAT_PLAN)), ""))
        resp = self.anon.post(
            "/api/study-plan/generate/",
            {"subject": "Databases", "model": "selected-model-id"},
            format="json",
            HTTP_X_PCL_AI_IDENTITY=other_token,
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("No API key is stored", resp.json()["error"])
        self.assertTrue(resp.json()["fallback"])

    def test_no_identity_is_401_without_fallback(self):
        recorder = self._post_plain((200, _chat_body(json.dumps(CHAT_PLAN)), ""))
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "env-key-must-not-be-used"}):
            resp = self.anon.post(
                "/api/study-plan/generate/",
                {"subject": "Databases", "model": "selected-model-id"},
                format="json",
            )
        self.assertEqual(resp.status_code, 401)
        self.assertTrue(resp.json()["fallback"])
        self.assertEqual(recorder.calls, [])  # legacy path never engaged

    def test_subject_still_required_for_byok(self):
        self._post_plain((200, _chat_body(json.dumps(CHAT_PLAN)), ""))
        resp = self.anon.post(
            "/api/study-plan/generate/",
            {"model": "selected-model-id"},
            format="json",
            HTTP_X_PCL_AI_IDENTITY=self.device_token,
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("subject", resp.json()["error"])

    def test_unsupported_provider_400(self):
        self.device_credential.provider = "skynet"
        self.device_credential.save()
        self._post_plain((200, _chat_body(json.dumps(CHAT_PLAN)), ""))
        resp = self.anon.post(
            "/api/study-plan/generate/",
            {"subject": "Databases", "model": "selected-model-id"},
            format="json",
            HTTP_X_PCL_AI_IDENTITY=self.device_token,
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Unsupported provider", resp.json()["error"])

    def test_custom_provider_without_endpoint_400(self):
        self.device_credential.provider = "custom"
        self.device_credential.save()
        self._post_plain((200, _chat_body(json.dumps(CHAT_PLAN)), ""))
        resp = self.anon.post(
            "/api/study-plan/generate/",
            {"subject": "Databases", "model": "selected-model-id"},
            format="json",
            HTTP_X_PCL_AI_IDENTITY=self.device_token,
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("No endpoint is configured", resp.json()["error"])

    # --- SSRF gate on user-supplied endpoints --------------------------------

    def test_loopback_endpoint_blocked_pre_fetch(self):
        self.device_credential.provider = "custom"
        self.device_credential.save()
        guarded = self._patch_guarded((200, _chat_body(json.dumps(CHAT_PLAN)), ""))
        resp = self.anon.post(
            "/api/study-plan/generate/",
            {"subject": "Databases", "model": "selected-model-id", "endpoint": "http://127.0.0.1:59999/v1"},
            format="json",
            HTTP_X_PCL_AI_IDENTITY=self.device_token,
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("loopback", resp.json()["error"])
        self.assertEqual(guarded.calls, [])  # the gate stopped it pre-fetch

    def test_private_endpoint_blocked(self):
        self.device_credential.provider = "custom"
        self.device_credential.save()
        self._patch_guarded((200, _chat_body(json.dumps(CHAT_PLAN)), ""))
        resp = self.anon.post(
            "/api/study-plan/generate/",
            {"subject": "Databases", "model": "selected-model-id", "endpoint": "http://192.168.0.102:3000/v1"},
            format="json",
            HTTP_X_PCL_AI_IDENTITY=self.device_token,
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("private", resp.json()["error"])

    def test_public_custom_endpoint_uses_guarded_post(self):
        self.device_credential.provider = "custom"
        self.device_credential.save()
        recorder = self._patch_guarded((200, _chat_body(json.dumps(CHAT_PLAN), "gw-model"), ""))
        resp = self.anon.post(
            "/api/study-plan/generate/",
            {"subject": "Databases", "model": "selected-model-id", "endpoint": "https://8.8.8.8:8443/gw/v1"},
            format="json",
            HTTP_X_PCL_AI_IDENTITY=self.device_token,
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["plan"], CHAT_PLAN)
        self.assertEqual(
            recorder.calls[0][0], "https://8.8.8.8:8443/gw/v1/chat/completions"
        )
        # The exact selected model was sent upstream, not a default.
        sent = json.loads(recorder.calls[0][2])
        self.assertEqual(sent["model"], "selected-model-id")

    # --- upstream outcomes ----------------------------------------------------

    def test_upstream_401_reports_rejected_key(self):
        self._post_plain((401, None, ""))
        resp = self.anon.post(
            "/api/study-plan/generate/",
            {"subject": "Databases", "model": "selected-model-id"},
            format="json",
            HTTP_X_PCL_AI_IDENTITY=self.device_token,
        )
        self.assertEqual(resp.status_code, 502)
        self.assertIn("rejected this key", resp.json()["error"])
        self.assertTrue(resp.json()["fallback"])

    def test_upstream_500_reports_provider_error(self):
        self._post_plain((500, None, ""))
        resp = self.anon.post(
            "/api/study-plan/generate/",
            {"subject": "Databases", "model": "selected-model-id"},
            format="json",
            HTTP_X_PCL_AI_IDENTITY=self.device_token,
        )
        self.assertEqual(resp.status_code, 502)
        self.assertIn("HTTP 500", resp.json()["error"])

    def test_upstream_404_reports_model_not_found(self):
        # A model the provider does not know is identified as a model
        # problem, not a key or network problem.
        self._post_plain((404, None, ""))
        resp = self.anon.post(
            "/api/study-plan/generate/",
            {"subject": "Databases", "model": "selected-model-id"},
            format="json",
            HTTP_X_PCL_AI_IDENTITY=self.device_token,
        )
        self.assertEqual(resp.status_code, 502)
        self.assertIn("could not find the selected model", resp.json()["error"])
        self.assertIn("HTTP 404", resp.json()["error"])
        self.assertTrue(resp.json()["fallback"])

    def test_upstream_400_reports_rejected_request(self):
        # Other 4xx (e.g. an unknown model reported as 400) is framed as
        # a model/key check, distinct from key rejection and provider 5xx.
        self._post_plain((400, None, ""))
        resp = self.anon.post(
            "/api/study-plan/generate/",
            {"subject": "Databases", "model": "selected-model-id"},
            format="json",
            HTTP_X_PCL_AI_IDENTITY=self.device_token,
        )
        self.assertEqual(resp.status_code, 502)
        self.assertIn("rejected the request for the selected model", resp.json()["error"])
        self.assertIn("HTTP 400", resp.json()["error"])
        self.assertTrue(resp.json()["fallback"])

    def test_upstream_429_reports_rate_limit(self):
        self._post_plain((429, None, ""))
        resp = self.anon.post(
            "/api/study-plan/generate/",
            {"subject": "Databases", "model": "selected-model-id"},
            format="json",
            HTTP_X_PCL_AI_IDENTITY=self.device_token,
        )
        self.assertEqual(resp.status_code, 502)
        self.assertIn("rate-limited", resp.json()["error"])
        self.assertIn("HTTP 429", resp.json()["error"])
        self.assertTrue(resp.json()["fallback"])

    def test_unreachable_endpoint_falls_back_signal(self):
        self._post_plain((None, None, "The provider endpoint could not be reached."))
        resp = self.anon.post(
            "/api/study-plan/generate/",
            {"subject": "Databases", "model": "selected-model-id"},
            format="json",
            HTTP_X_PCL_AI_IDENTITY=self.device_token,
        )
        self.assertEqual(resp.status_code, 502)
        self.assertIn("could not be reached", resp.json()["error"])
        self.assertTrue(resp.json()["fallback"])

    def test_junk_upstream_body_502(self):
        for junk in ("not-json", "{}", "null"):
            with self.subTest(junk):
                self._post_plain((200, junk, ""))
                resp = self.anon.post(
                    "/api/study-plan/generate/",
                    {"subject": "Databases", "model": "selected-model-id"},
                    format="json",
                    HTTP_X_PCL_AI_IDENTITY=self.device_token,
                )
                self.assertEqual(resp.status_code, 502)
                self.assertIn("Could not parse", resp.json()["error"])

    def test_fenced_and_prose_wrapped_plan_parse(self):
        # Providers without response_format support may wrap the JSON.
        self._post_plain((200, _chat_body(f"```json\n{json.dumps(CHAT_PLAN)}\n```"), ""))
        resp = self.anon.post(
            "/api/study-plan/generate/",
            {"subject": "Databases", "model": "selected-model-id"},
            format="json",
            HTTP_X_PCL_AI_IDENTITY=self.device_token,
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["plan"], CHAT_PLAN)

        self._post_plain((200, _chat_body(f"Sure, here is your plan: {json.dumps(CHAT_PLAN)} done."), ""))
        resp = self.anon.post(
            "/api/study-plan/generate/",
            {"subject": "Databases", "model": "selected-model-id"},
            format="json",
            HTTP_X_PCL_AI_IDENTITY=self.device_token,
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["plan"], CHAT_PLAN)

    def test_response_format_sent_only_for_openai(self):
        recorder = self._post_plain((200, _chat_body(json.dumps(CHAT_PLAN)), ""))
        self.anon.post(
            "/api/study-plan/generate/",
            {"subject": "Databases", "model": "selected-model-id"},
            format="json",
            HTTP_X_PCL_AI_IDENTITY=self.device_token,  # deepseek credential
        )
        self.assertNotIn("response_format", json.loads(recorder.calls[0][2]))

        recorder = self._post_plain((200, _chat_body(json.dumps(CHAT_PLAN)), ""))
        client = APIClient()
        client.force_authenticate(user=self.user)  # openai credential
        client.post(
            "/api/study-plan/generate/",
            {"subject": "Databases", "model": "gpt-4o-mini"},
            format="json",
        )
        self.assertEqual(
            json.loads(recorder.calls[0][2])["response_format"], {"type": "json_object"}
        )

    # --- critical rule: no silent fallback to the server key -----------------

    def test_byok_never_touches_env_openrouter_key(self):
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "env-key-must-not-be-used"}):
            recorder = self._post_plain((200, _chat_body(json.dumps(CHAT_PLAN)), ""))
            resp = self.anon.post(
                "/api/study-plan/generate/",
                {"subject": "Databases", "model": "selected-model-id"},
                format="json",
                HTTP_X_PCL_AI_IDENTITY=self.device_token,
            )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["source"], "byok-deepseek")
        self.assertEqual(recorder.calls[0][1]["Authorization"], f"Bearer {STORED_KEY}")
        self.assertNotIn("env-key-must-not-be-used", json.dumps(recorder.calls[0][1]))


@override_settings(AI_PROVIDERS=FIXTURE_PROVIDERS, AI_CREDENTIAL_ENCRYPTION_KEY="")
class ByokMasterMissingTests(TestCase):
    """Without the master key nothing is decrypted and no fetch happens (503)."""

    def setUp(self):
        self.device_token = str(uuid.uuid4())
        self.credential = AiCredential.objects.create(
            user=None,
            identity_token=self.device_token,
            provider="deepseek",
            encrypted_key="not-a-real-blob",
            key_hint="9999",
        )
        self.anon = APIClient()

    def test_503_and_no_fetch(self):
        import studyplan.views as views

        plain = _PlainRecorder((200, "{}", ""))
        original = views._post_plain
        views._post_plain = plain
        self.addCleanup(lambda: setattr(views, "_post_plain", original))

        resp = self.anon.post(
            "/api/study-plan/generate/",
            {"subject": "Databases", "model": "selected-model-id"},
            format="json",
            HTTP_X_PCL_AI_IDENTITY=self.device_token,
        )
        self.assertEqual(resp.status_code, 503)
        self.assertIn("AI_CREDENTIAL_ENCRYPTION_KEY", resp.json()["error"])
        self.assertEqual(plain.calls, [])


@override_settings(AI_PROVIDERS=FIXTURE_PROVIDERS, AI_CREDENTIAL_ENCRYPTION_KEY=MASTER)
class ByokCorruptCredentialTests(TestCase):
    """A stored blob that fails the integrity check -> clean 500, no fetch."""

    def setUp(self):
        self.device_token = str(uuid.uuid4())
        self.credential = AiCredential.objects.create(
            user=None,
            identity_token=self.device_token,
            provider="deepseek",
            encrypted_key="tampered-garbage-blob",
            key_hint="9999",
        )
        self.anon = APIClient()

    def test_500_and_no_fetch(self):
        import studyplan.views as views

        plain = _PlainRecorder((200, "{}", ""))
        original = views._post_plain
        views._post_plain = plain
        self.addCleanup(lambda: setattr(views, "_post_plain", original))

        resp = self.anon.post(
            "/api/study-plan/generate/",
            {"subject": "Databases", "model": "selected-model-id"},
            format="json",
            HTTP_X_PCL_AI_IDENTITY=self.device_token,
        )
        self.assertEqual(resp.status_code, 500)
        self.assertIn("could not be read", resp.json()["error"])
        self.assertEqual(plain.calls, [])


@override_settings(AI_PROVIDERS=FIXTURE_PROVIDERS, AI_CREDENTIAL_ENCRYPTION_KEY=MASTER)
class LegacyOpenRouterRegressionTests(TestCase):
    """Requests without a ``model`` field keep the OpenRouter flow intact."""

    def setUp(self):
        self.anon = APIClient()

    def _payload(self):
        return {
            "subject": "Databases",
            "topic": "Indexing",
            "weeks": 2,
            "level": "Beginner",
            "goal": "Pass the midterm",
            "cadence": "Light",
        }

    def test_503_when_env_key_missing(self):
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": ""}):
            resp = self.anon.post(
                "/api/study-plan/generate/", self._payload(), format="json"
            )
        self.assertEqual(resp.status_code, 503)
        self.assertIn("OPENROUTER_API_KEY", resp.json()["error"])
        self.assertTrue(resp.json()["fallback"])

    def test_env_key_request_uses_openrouter_path(self):
        body = _chat_body(json.dumps(CHAT_PLAN), model="openai/gpt-4o-mini")
        fake_response = mock.MagicMock()
        fake_response.read.return_value = body.encode("utf-8")
        fake_response.__enter__.return_value = fake_response

        with mock.patch.dict(
            os.environ, {"OPENROUTER_API_KEY": "env-openrouter-key"}
        ), mock.patch("urllib.request.urlopen", return_value=fake_response) as patched:
            resp = self.anon.post(
                "/api/study-plan/generate/", self._payload(), format="json"
            )
        self.assertEqual(resp.status_code, 200)
        data = resp.json()
        self.assertEqual(data["source"], "openrouter")
        self.assertEqual(data["plan"], CHAT_PLAN)
        # The request went to the configured OpenRouter endpoint with the env key.
        import studyplan.views as views

        sent_request = patched.call_args[0][0]
        self.assertEqual(sent_request.full_url, views.OPENROUTER_ENDPOINT)
        self.assertEqual(sent_request.headers["Authorization"], "Bearer env-openrouter-key")

    def test_byok_identity_cannot_reach_legacy_path(self):
        # A BYOK request whose identity resolves but has no credential must
        # fail in the BYOK branch — never silently take the env key instead.
        device_token = str(uuid.uuid4())
        with mock.patch.dict(os.environ, {"OPENROUTER_API_KEY": "env-openrouter-key"}):
            resp = self.anon.post(
                "/api/study-plan/generate/",
                {**self._payload(), "model": "selected-model-id"},
                format="json",
                HTTP_X_PCL_AI_IDENTITY=device_token,
            )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("No API key is stored", resp.json()["error"])
