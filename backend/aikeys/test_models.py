"""Focused tests for POST /api/ai/models/ (Step 2.1 — AI model discovery).

Isolation follows the project's dmb convention (unique ``pctest_`` users,
deleted in tearDown). The provider transports (``_fetch_models_plain`` and
the SSRF ``fetch_endpoint`` alias) are stubbed so no real network is hit;
the SSRF *gate* (``check_url``) runs for real, so internal-endpoint tests
are deterministic and offline. The provider catalog is overridden with a
fixture so the tests never depend on the server's ``.env`` values.
"""

import json
import uuid

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from users.models import User

from .crypto import encrypt_key
from .models import AiCredential

MASTER = "test-master-key-for-aikeys"
STORED_KEY = "stored-demo-key-5150"  # encrypted at rest, never expected in a response

# Deterministic catalog: bases use the unresolvable .local TLD; the tests
# stub every transport, so these hosts are never contacted.
FIXTURE_PROVIDERS = {
    "deepseek": {"label": "DeepSeek", "endpoint": "https://fixture.deepseek.local/v1"},
    "openai": {"label": "OpenAI", "endpoint": "https://fixture.openai.local/v1"},
    "modelscope": {"label": "ModelScope (DashScope)", "endpoint": "https://fixture.dashscope.local/v1"},
    "custom": {"label": "Custom endpoint", "endpoint": ""},
}

MODELS_BODY = json.dumps({"data": [
    {"id": "gpt-4o", "name": "GPT-4o"},
    {"id": "deepseek-chat"},            # no name -> falls back to the id
    {"id": "", "name": "blank"},        # no id -> skipped
    {"id": "gpt-4o", "name": "dup"},    # duplicate id -> kept once
    "not-a-dict",                       # non-object entry -> skipped
]})


def uid():
    return uuid.uuid4().hex[:12]


class _Recorder:
    """Stub transport that records the URL it was called with."""

    def __init__(self, result):
        self.result = result
        self.urls = []

    def __call__(self, url, *args, **kwargs):
        self.urls.append(url)
        return self.result


@override_settings(AI_PROVIDERS=FIXTURE_PROVIDERS, AI_CREDENTIAL_ENCRYPTION_KEY=MASTER)
class ModelsEndpointTests(TestCase):
    """Happy paths, provider-level outcomes, and the normalization rules."""

    def setUp(self):
        self.suffix = uid()
        self.user = User.objects.create_user(
            username=f"pctest_models_{self.suffix}",
            email=f"pctest-models-{self.suffix}@example.com",
            password="pctest-pass-123",
            role="student",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.cred = AiCredential.objects.create(
            user=self.user,
            provider="deepseek",
            encrypted_key=encrypt_key(STORED_KEY, MASTER),
            key_hint=STORED_KEY[-4:],
        )

    def tearDown(self):
        self.user.delete()
        super().tearDown()

    def _post(self, endpoint=None):
        payload = {}
        if endpoint is not None:
            payload["endpoint"] = endpoint
        return self.client.post("/api/ai/models/", payload, format="json")

    def _patch_plain(self, result):
        import aikeys.views as views

        recorder = _Recorder(result)
        original = views._fetch_models_plain
        views._fetch_models_plain = recorder
        self.addCleanup(lambda: setattr(views, "_fetch_models_plain", original))
        return recorder

    def _patch_guarded(self, result):
        import aikeys.views as views

        recorder = _Recorder(result)
        original = views.ssrf_fetch
        views.ssrf_fetch = recorder
        self.addCleanup(lambda: setattr(views, "ssrf_fetch", original))
        return recorder

    def test_requires_auth(self):
        anon = APIClient()
        resp = anon.post("/api/ai/models/", {}, format="json")
        self.assertEqual(resp.status_code, 401)

    def test_no_credential_400(self):
        # Use a user that never had a credential (avoid the OneToOne cache
        # that deleting self.cred would leave behind on self.user).
        bare = User.objects.create_user(
            username=f"pctest_bare_{uid()}",
            email=f"pctest-bare-{uid()}@example.com",
            password="pctest-pass-123",
            role="student",
        )
        self.addCleanup(bare.delete)
        bare_client = APIClient()
        bare_client.force_authenticate(user=bare)
        resp = bare_client.post("/api/ai/models/", {}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Validate a key", resp.json()["error"])

    def test_success_returns_normalized_models(self):
        recorder = self._patch_plain((200, MODELS_BODY, ""))
        resp = self._post()
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertEqual(body["provider"], "deepseek")
        self.assertEqual(body["error"], "")
        self.assertEqual(
            body["models"],
            [
                {"id": "gpt-4o", "name": "GPT-4o"},
                {"id": "deepseek-chat", "name": "deepseek-chat"},
            ],
        )
        # The stored key must never appear in the response.
        self.assertNotIn(STORED_KEY, str(body))
        # The operator-configured base (fixture) was used, with /models appended.
        self.assertEqual(recorder.urls, ["https://fixture.deepseek.local/v1/models"])

    def test_provider_rejection_surfaces_error(self):
        self._patch_plain((401, None, ""))
        body = self._post().json()
        self.assertEqual(body["models"], [])
        self.assertIn("rejected this key (HTTP 401)", body["error"])

    def test_provider_403_surfaces_error(self):
        self._patch_plain((403, None, ""))
        body = self._post().json()
        self.assertIn("rejected this key (HTTP 403)", body["error"])

    def test_unreachable_surfaces_error(self):
        self._patch_plain((None, None, "The provider endpoint could not be reached."))
        body = self._post().json()
        self.assertEqual(body["models"], [])
        self.assertEqual(body["error"], "The provider endpoint could not be reached.")

    def test_http_500_surfaces_unverified(self):
        self._patch_plain((500, None, ""))
        body = self._post().json()
        self.assertIn("could not be verified (HTTP 500)", body["error"])

    def test_unexpected_payload_reports_error(self):
        for junk in ("not-json", "{}", json.dumps({"models": []}), "null"):
            self._patch_plain((200, junk, ""))
            body = self._post().json()
            self.assertEqual(body["models"], [], junk)
            self.assertIn("unexpected response", body["error"], junk)

    def test_unsupported_provider_400(self):
        self.cred.provider = "skynet"
        self.cred.save()
        resp = self._post()
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Unsupported provider", resp.json()["error"])

    def test_custom_provider_without_endpoint_400(self):
        self.cred.provider = "custom"
        self.cred.save()
        # Fixture custom base is empty and no override was sent.
        resp = self._post()
        self.assertEqual(resp.status_code, 400)
        self.assertIn("No endpoint is configured", resp.json()["error"])


@override_settings(AI_PROVIDERS=FIXTURE_PROVIDERS, AI_CREDENTIAL_ENCRYPTION_KEY=MASTER)
class ModelsSsrfTests(TestCase):
    """User-supplied endpoints must pass the SSRF gate before any fetch."""

    def setUp(self):
        self.suffix = uid()
        self.user = User.objects.create_user(
            username=f"pctest_mssrf_{self.suffix}",
            email=f"pctest-mssrf-{self.suffix}@example.com",
            password="pctest-pass-123",
            role="student",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.cred = AiCredential.objects.create(
            user=self.user,
            provider="custom",
            encrypted_key=encrypt_key(STORED_KEY, MASTER),
            key_hint=STORED_KEY[-4:],
        )

    def tearDown(self):
        self.user.delete()
        super().tearDown()

    def _post(self, endpoint):
        return self.client.post(
            "/api/ai/models/", {"endpoint": endpoint}, format="json"
        )

    def _patch_guarded(self, result):
        import aikeys.views as views

        recorder = _Recorder(result)
        original = views.ssrf_fetch
        views.ssrf_fetch = recorder
        self.addCleanup(lambda: setattr(views, "ssrf_fetch", original))
        return recorder

    def test_loopback_endpoint_400_and_never_fetched(self):
        recorder = self._patch_guarded((200, MODELS_BODY, ""))
        resp = self._post("http://127.0.0.1:59999/v1")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("loopback", resp.json()["error"])
        self.assertEqual(recorder.urls, [])  # the gate stopped it pre-fetch

    def test_localhost_endpoint_400(self):
        self._patch_guarded((200, MODELS_BODY, ""))
        resp = self._post("http://localhost:11434/v1")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("localhost", resp.json()["error"])

    def test_metadata_endpoint_400(self):
        self._patch_guarded((200, MODELS_BODY, ""))
        resp = self._post("http://169.254.169.254/v1")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("link-local", resp.json()["error"])

    def test_private_lan_endpoint_400(self):
        self._patch_guarded((200, MODELS_BODY, ""))
        resp = self._post("http://192.168.0.102:3000/v1")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("private", resp.json()["error"])

    def test_public_endpoint_uses_guarded_fetch(self):
        # 8.8.8.8 is a literal public IP: the gate passes offline.
        recorder = self._patch_guarded((200, MODELS_BODY, ""))
        resp = self._post("https://8.8.8.8:8443/gw/v1")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["models"][0]["id"], "gpt-4o")
        self.assertEqual(recorder.urls, ["https://8.8.8.8:8443/gw/v1/models"])

    def test_unsafe_protocol_rejected_before_gate(self):
        # Non-http(s) input is not even a usable endpoint: normalization
        # drops it, the (empty) custom base is used, and the request fails
        # with a clean 400 before the SSRF gate or any fetch.
        recorder = self._patch_guarded((200, MODELS_BODY, ""))
        resp = self._post("ftp://example.com/v1")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("No endpoint is configured", resp.json()["error"])
        self.assertEqual(recorder.urls, [])


@override_settings(AI_PROVIDERS=FIXTURE_PROVIDERS, AI_CREDENTIAL_ENCRYPTION_KEY="")
class ModelsMasterMissingTests(TestCase):
    """Without the master key nothing is probed or stored (503)."""

    def setUp(self):
        self.suffix = uid()
        self.user = User.objects.create_user(
            username=f"pctest_m503_{self.suffix}",
            email=f"pctest-m503-{self.suffix}@example.com",
            password="pctest-pass-123",
            role="student",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.cred = AiCredential.objects.create(
            user=self.user,
            provider="deepseek",
            encrypted_key="not-a-real-blob",
            key_hint="9999",
        )

    def tearDown(self):
        self.user.delete()
        super().tearDown()

    def test_503_and_no_fetch(self):
        import aikeys.views as views

        plain, guarded = _Recorder((200, "{}", "")), _Recorder((200, "{}", ""))
        orig_plain, orig_guarded = views._fetch_models_plain, views.ssrf_fetch
        views._fetch_models_plain = plain
        views.ssrf_fetch = guarded
        self.addCleanup(lambda: setattr(views, "_fetch_models_plain", orig_plain))
        self.addCleanup(lambda: setattr(views, "ssrf_fetch", orig_guarded))

        resp = self.client.post("/api/ai/models/", {}, format="json")
        self.assertEqual(resp.status_code, 503)
        self.assertIn("AI_CREDENTIAL_ENCRYPTION_KEY", resp.json()["error"])
        self.assertEqual(plain.urls, [])
        self.assertEqual(guarded.urls, [])


@override_settings(AI_PROVIDERS=FIXTURE_PROVIDERS, AI_CREDENTIAL_ENCRYPTION_KEY=MASTER)
class ModelsCorruptCredentialTests(TestCase):
    """A stored blob that fails integrity check -> clean 500, no fetch."""

    def setUp(self):
        self.suffix = uid()
        self.user = User.objects.create_user(
            username=f"pctest_mcor_{self.suffix}",
            email=f"pctest-mcor-{self.suffix}@example.com",
            password="pctest-pass-123",
            role="student",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.cred = AiCredential.objects.create(
            user=self.user,
            provider="deepseek",
            encrypted_key="garbage-blob",
            key_hint="9999",
        )

    def tearDown(self):
        self.user.delete()
        super().tearDown()

    def test_500_and_no_fetch(self):
        import aikeys.views as views

        recorder = _Recorder((200, "{}", ""))
        original = views._fetch_models_plain
        views._fetch_models_plain = recorder
        self.addCleanup(lambda: setattr(views, "_fetch_models_plain", original))

        resp = self.client.post("/api/ai/models/", {}, format="json")
        self.assertEqual(resp.status_code, 500)
        self.assertIn("could not be read", resp.json()["error"])
        self.assertEqual(recorder.urls, [])
        self.assertNotIn(STORED_KEY, str(resp.json()))
