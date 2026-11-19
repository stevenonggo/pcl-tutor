"""Focused tests for POST /api/ai/validate-model/ (Step 2.2 — model validation).

Same isolation and stubbing rules as ``test_models.py``: unique ``pctest_``
users, provider transports stubbed so no real network is hit, the SSRF gate
runs for real so internal-endpoint tests are deterministic and offline. The
provider catalog is a fixture so tests never depend on the server's ``.env``.
"""

import json
import uuid

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from users.models import User

from .crypto import encrypt_key
from .models import AiCredential

MASTER = "test-master-key-for-model-validate"
STORED_KEY = "stored-demo-key-5150"  # encrypted at rest, never expected in a response

# Deterministic catalog: bases use the unresolvable .local TLD; the tests
# stub every transport, so these hosts are never contacted.
FIXTURE_PROVIDERS = {
    "deepseek": {"label": "DeepSeek", "endpoint": "https://fixture.deepseek.local/v1"},
    "openai": {"label": "OpenAI", "endpoint": "https://fixture.openai.local/v1"},
    "modelscope": {"label": "ModelScope (DashScope)", "endpoint": "https://fixture.dashscope.local/v1"},
    "custom": {"label": "Custom endpoint", "endpoint": ""},
}


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
class ModelValidateEndpointTests(TestCase):
    """Happy paths, provider-level outcomes, and the error-code mapping."""

    def setUp(self):
        self.suffix = uid()
        self.user = User.objects.create_user(
            username=f"pctest_mval_{self.suffix}",
            email=f"pctest-mval-{self.suffix}@example.com",
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

    def _post(self, model="deepseek-chat", endpoint=None):
        payload = {"model": model}
        if endpoint is not None:
            payload["endpoint"] = endpoint
        return self.client.post("/api/ai/validate-model/", payload, format="json")

    def _patch_plain(self, result):
        import aikeys.views as views

        recorder = _Recorder(result)
        original = views._ping_chat_plain
        views._ping_chat_plain = recorder
        self.addCleanup(lambda: setattr(views, "_ping_chat_plain", original))
        return recorder

    def _patch_guarded(self, result):
        import aikeys.views as views

        recorder = _Recorder(result)
        original = views.ssrf_post
        views.ssrf_post = recorder
        self.addCleanup(lambda: setattr(views, "ssrf_post", original))
        return recorder

    def test_requires_auth(self):
        anon = APIClient()
        resp = anon.post("/api/ai/validate-model/", {"model": "x"}, format="json")
        self.assertEqual(resp.status_code, 401)

    def test_no_credential_400(self):
        bare = User.objects.create_user(
            username=f"pctest_mval_bare_{uid()}",
            email=f"pctest-mval-bare-{uid()}@example.com",
            password="pctest-pass-123",
            role="student",
        )
        self.addCleanup(bare.delete)
        bare_client = APIClient()
        bare_client.force_authenticate(user=bare)
        resp = bare_client.post("/api/ai/validate-model/", {"model": "x"}, format="json")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("Validate a key", resp.json()["error"])

    def test_missing_model_400(self):
        self._patch_plain((200, ""))
        resp = self._post(model="")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("model is required", resp.json()["error"])

    def test_success_2xx(self):
        recorder = self._patch_plain((200, ""))
        resp = self._post()
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertIs(body["valid"], True)
        self.assertEqual(body["model"], "deepseek-chat")
        self.assertIn("available", body["message"])
        # The operator-configured base was used, with /chat/completions appended.
        self.assertEqual(recorder.urls, ["https://fixture.deepseek.local/v1/chat/completions"])
        # The stored key must never appear in the response.
        self.assertNotIn(STORED_KEY, str(body))

    def test_key_rejection_401_maps_to_key_message(self):
        self._patch_plain((401, ""))
        body = self._post().json()
        self.assertIs(body["valid"], False)
        self.assertIn("rejected this key (HTTP 401)", body["message"])

    def test_model_not_found_404_maps_to_model_message(self):
        self._patch_plain((404, ""))
        body = self._post().json()
        self.assertIs(body["valid"], False)
        self.assertIn("could not find the selected model (HTTP 404)", body["message"])

    def test_bad_request_400_maps_to_model_message(self):
        self._patch_plain((400, ""))
        body = self._post().json()
        self.assertIs(body["valid"], False)
        self.assertIn("rejected the request for the selected model (HTTP 400)", body["message"])

    def test_rate_limited_429_maps_to_provider_message(self):
        self._patch_plain((429, ""))
        body = self._post().json()
        self.assertIs(body["valid"], False)
        self.assertIn("rate-limited this request (HTTP 429)", body["message"])

    def test_http_500_maps_to_unverified_message(self):
        self._patch_plain((500, ""))
        body = self._post().json()
        self.assertIs(body["valid"], False)
        self.assertIn("could not verify the selected model (HTTP 500)", body["message"])

    def test_unreachable_maps_to_endpoint_message(self):
        self._patch_plain((None, "The provider endpoint could not be reached."))
        body = self._post().json()
        self.assertIs(body["valid"], False)
        self.assertEqual(body["message"], "The provider endpoint could not be reached.")

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
class ModelValidateSsrfTests(TestCase):
    """User-supplied endpoints must pass the SSRF gate before any POST."""

    def setUp(self):
        self.suffix = uid()
        self.user = User.objects.create_user(
            username=f"pctest_mvssrf_{self.suffix}",
            email=f"pctest-mvssrf-{self.suffix}@example.com",
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

    def _post(self, endpoint, model="gw-model-1"):
        return self.client.post(
            "/api/ai/validate-model/",
            {"endpoint": endpoint, "model": model},
            format="json",
        )

    def _patch_guarded(self, result):
        import aikeys.views as views

        recorder = _Recorder(result)
        original = views.ssrf_post
        views.ssrf_post = recorder
        self.addCleanup(lambda: setattr(views, "ssrf_post", original))
        return recorder

    def test_loopback_endpoint_400_and_never_posted(self):
        recorder = self._patch_guarded((200, None, ""))
        resp = self._post("http://127.0.0.1:59999/v1")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("loopback", resp.json()["message"])
        self.assertEqual(recorder.urls, [])  # the gate stopped it pre-POST

    def test_metadata_endpoint_400(self):
        self._patch_guarded((200, None, ""))
        resp = self._post("http://169.254.169.254/v1")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("link-local", resp.json()["message"])

    def test_public_endpoint_uses_guarded_post(self):
        # 8.8.8.8 is a literal public IP: the gate passes offline.
        recorder = self._patch_guarded((200, None, ""))
        resp = self._post("https://8.8.8.8:8443/gw/v1", model="gw-model-1")
        self.assertEqual(resp.status_code, 200)
        self.assertIs(resp.json()["valid"], True)
        self.assertEqual(recorder.urls, ["https://8.8.8.8:8443/gw/v1/chat/completions"])

    def test_unsafe_protocol_rejected_before_gate(self):
        recorder = self._patch_guarded((200, None, ""))
        resp = self._post("ftp://example.com/v1")
        self.assertEqual(resp.status_code, 400)
        self.assertIn("No endpoint is configured", resp.json()["error"])
        self.assertEqual(recorder.urls, [])


@override_settings(AI_PROVIDERS=FIXTURE_PROVIDERS, AI_CREDENTIAL_ENCRYPTION_KEY="")
class ModelValidateMasterMissingTests(TestCase):
    """Without the master key nothing is decrypted or posted (503)."""

    def setUp(self):
        self.suffix = uid()
        self.user = User.objects.create_user(
            username=f"pctest_mv503_{self.suffix}",
            email=f"pctest-mv503-{self.suffix}@example.com",
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

    def test_503_and_no_post(self):
        import aikeys.views as views

        plain, guarded = _Recorder((200, "")), _Recorder((200, None, ""))
        orig_plain, orig_guarded = views._ping_chat_plain, views.ssrf_post
        views._ping_chat_plain = plain
        views.ssrf_post = guarded
        self.addCleanup(lambda: setattr(views, "_ping_chat_plain", orig_plain))
        self.addCleanup(lambda: setattr(views, "ssrf_post", orig_guarded))

        resp = self.client.post("/api/ai/validate-model/", {"model": "x"}, format="json")
        self.assertEqual(resp.status_code, 503)
        self.assertIn("AI_CREDENTIAL_ENCRYPTION_KEY", resp.json()["error"])
        self.assertEqual(plain.urls, [])
        self.assertEqual(guarded.urls, [])


@override_settings(AI_PROVIDERS=FIXTURE_PROVIDERS, AI_CREDENTIAL_ENCRYPTION_KEY=MASTER)
class ModelValidateCorruptCredentialTests(TestCase):
    """A stored blob that fails integrity check -> clean 500, no POST."""

    def setUp(self):
        self.suffix = uid()
        self.user = User.objects.create_user(
            username=f"pctest_mvcor_{self.suffix}",
            email=f"pctest-mvcor-{self.suffix}@example.com",
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

    def test_500_and_no_post(self):
        import aikeys.views as views

        recorder = _Recorder((200, ""))
        original = views._ping_chat_plain
        views._ping_chat_plain = recorder
        self.addCleanup(lambda: setattr(views, "_ping_chat_plain", original))

        resp = self.client.post("/api/ai/validate-model/", {"model": "x"}, format="json")
        self.assertEqual(resp.status_code, 500)
        self.assertIn("could not be read", resp.json()["error"])
        self.assertEqual(recorder.urls, [])
        self.assertNotIn(STORED_KEY, str(resp.json()))
