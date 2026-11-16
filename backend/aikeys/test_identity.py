"""Tests for the login-independent device-identity path on the AI endpoints.

Conventions follow ``test_models.py``: unique ``pctest_`` identities, a
deterministic provider fixture (unresolvable ``.local`` hosts — nothing is
ever contacted for real; every provider transport is stubbed), and a
test-only master key. Device tokens are fresh random UUID-4s generated per
test; they are randomness, not secrets, and no real credentials appear
here.
"""

import json
import uuid

from django.test import TestCase, override_settings
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from users.models import User

from .identity import IDENTITY_HEADER, normalize_identity_header
from .models import AiCredential

MASTER = "test-master-key-for-aikeys"

FIXTURE_PROVIDERS = {
    "deepseek": {"label": "DeepSeek", "endpoint": "https://fixture.deepseek.local/v1"},
    "openai": {"label": "OpenAI", "endpoint": "https://fixture.openai.local/v1"},
}

MODELS_BODY = json.dumps({"data": [
    {"id": "gpt-4o", "name": "GPT-4o"},
    {"id": "deepseek-chat"},  # no name -> falls back to the id
]})

# APIClient kwarg for IDENTITY_HEADER ("X-PCL-AI-Identity" -> HTTP_ form).
HEADER_KWARG = "HTTP_" + IDENTITY_HEADER.replace("-", "_").upper()


def uid():
    return uuid.uuid4().hex[:12]


def device_token():
    """A fresh random UUID-4 — the device identity used by a test."""
    return str(uuid.uuid4())


class _Recorder:
    """Stub transport that records the URL it was called with."""

    def __init__(self, result):
        self.result = result
        self.urls = []

    def __call__(self, url, *args, **kwargs):
        self.urls.append(url)
        return self.result


class HeaderNormalizationTests(TestCase):
    """Pure header handling — no database, no network."""

    def test_accepts_uuid4_with_case_and_whitespace(self):
        token = device_token()
        self.assertEqual(normalize_identity_header(token), token)
        self.assertEqual(normalize_identity_header("  " + token.upper() + "  "), token)

    def test_rejects_other_uuid_versions_and_junk(self):
        for junk in (
            "not-a-uuid",
            "123",
            "",
            "   ",
            "00000000-0000-1000-8000-000000000000",  # version 1
            "00000000-0000-5000-8000-000000000000",  # version 5
            "000000000000000000000000000000000000000000000000",  # no dashes
        ):
            self.assertEqual(normalize_identity_header(junk), "", msg=junk)

    def test_rejects_non_string_values(self):
        for value in (None, 42, ["x"]):
            self.assertEqual(normalize_identity_header(value), "")


@override_settings(AI_PROVIDERS=FIXTURE_PROVIDERS, AI_CREDENTIAL_ENCRYPTION_KEY=MASTER)
class DeviceIdentityTests(TestCase):
    """The three protected endpoints, driven by a device-identity header only."""

    def setUp(self):
        self.client = APIClient()  # anonymous: no JWT
        self.created = []
        import aikeys.views as views

        self.original_probe = views._probe_endpoint
        views._probe_endpoint = _Recorder((True, ""))
        self.addCleanup(lambda: setattr(views, "_probe_endpoint", self.original_probe))

    def tearDown(self):
        for cred in self.created:
            AiCredential.objects.filter(pk=cred.pk).delete()
        super().tearDown()

    def track(self, cred):
        self.created.append(cred)
        return cred

    def _validate(self, token, provider="deepseek", api_key="user-key-1234"):
        resp = self.client.post(
            "/api/ai/validate/",
            {"provider": provider, "api_key": api_key},
            format="json",
            **{HEADER_KWARG: token},
        )
        if resp.status_code == 200 and resp.json().get("stored"):
            self.track(AiCredential.objects.get(identity_token=token))
        return resp

    def _status(self, token):
        return self.client.get("/api/ai/status/", **{HEADER_KWARG: token})

    def test_validate_stores_a_device_owned_credential(self):
        token = device_token()
        resp = self._validate(token)
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertIs(body["valid"], True)
        self.assertIs(body["stored"], True)
        self.assertEqual(body["key_hint"], "1234")
        self.assertNotIn("user-key-1234", str(body))  # key material never returned
        cred = AiCredential.objects.get(identity_token=token)
        self.assertIs(cred.user, None)  # device-owned: no account FK
        self.assertEqual(cred.provider, "deepseek")

    def test_revalidate_updates_the_same_device_row(self):
        token = device_token()
        self._validate(token)
        self._validate(token, provider="openai")
        rows = list(AiCredential.objects.filter(identity_token=token))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].provider, "openai")

    def test_rejected_key_creates_no_row(self):
        import aikeys.views as views

        original = views._probe_endpoint
        views._probe_endpoint = lambda base, key: (False, "The provider rejected this key (HTTP 401).")
        self.addCleanup(lambda: setattr(views, "_probe_endpoint", original))
        token = device_token()
        resp = self._validate(token)
        self.assertEqual(resp.status_code, 200)
        self.assertIs(resp.json()["valid"], False)
        self.assertIs(resp.json()["stored"], False)
        self.assertEqual(AiCredential.objects.filter(identity_token=token).count(), 0)

    def test_status_reports_the_owners_own_credential(self):
        token = device_token()
        self._validate(token)
        body = self._status(token).json()
        self.assertIs(body["configured"], True)
        self.assertEqual(body["provider"], "deepseek")
        self.assertEqual(body["key_hint"], "1234")
        self.assertIs(body["verified"], True)
        self.assertNotIn("user-key-1234", str(body))

    def test_status_isolated_between_device_identities(self):
        self._validate(device_token())  # tracked; a different device must not see it
        body = self._status(device_token()).json()
        self.assertEqual(body["configured"], False)

    def test_models_lists_models_through_the_device_key(self):
        import aikeys.views as views

        original = views._fetch_models_plain
        recorder = _Recorder((200, MODELS_BODY, ""))
        views._fetch_models_plain = recorder
        self.addCleanup(lambda: setattr(views, "_fetch_models_plain", original))

        token = device_token()
        self._validate(token)
        resp = self.client.post("/api/ai/models/", {}, format="json", **{HEADER_KWARG: token})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()["models"], [
            {"id": "gpt-4o", "name": "GPT-4o"},
            {"id": "deepseek-chat", "name": "deepseek-chat"},
        ])

    def test_models_without_a_stored_key_is_400(self):
        resp = self.client.post("/api/ai/models/", {}, format="json", **{HEADER_KWARG: device_token()})
        self.assertEqual(resp.status_code, 400)
        self.assertIn("No API key is stored yet", resp.json()["error"])

    def test_uppercase_token_is_normalized(self):
        token = device_token()
        self._validate(token)
        body = self.client.get("/api/ai/status/", **{HEADER_KWARG: " " + token.upper() + " "}).json()
        self.assertIs(body["configured"], True)

    def test_malformed_identity_headers_are_401(self):
        for junk in ("garbage", "00000000-0000-1000-8000-000000000000", "123"):
            self.assertEqual(self._status(junk).status_code, 401, msg=junk)
            self.assertEqual(
                self.client.post(
                    "/api/ai/validate/",
                    {"provider": "deepseek", "api_key": "k"},
                    format="json",
                    **{HEADER_KWARG: junk},
                ).status_code,
                401,
                msg=junk,
            )
            self.assertEqual(
                self.client.post("/api/ai/models/", {}, format="json", **{HEADER_KWARG: junk}).status_code,
                401,
                msg=junk,
            )

    def test_no_identity_at_all_is_401_on_all_three_endpoints(self):
        self.assertEqual(self.client.get("/api/ai/status/").status_code, 401)
        self.assertEqual(
            self.client.post(
                "/api/ai/validate/",
                {"provider": "deepseek", "api_key": "k"},
                format="json",
            ).status_code,
            401,
        )
        self.assertEqual(self.client.post("/api/ai/models/", {}, format="json").status_code, 401)


@override_settings(AI_PROVIDERS=FIXTURE_PROVIDERS, AI_CREDENTIAL_ENCRYPTION_KEY=MASTER)
class JwtCompatTests(TestCase):
    """JWT behavior is preserved; a JWT always wins over a device header."""

    def setUp(self):
        self.suffix = uid()
        self.user = User.objects.create_user(
            username=f"pctest_ident_{self.suffix}",
            email=f"pctest-ident-{self.suffix}@example.com",
            password="pctest-pass-123",
            role="student",
        )
        self.user_client = APIClient()
        self.user_client.force_authenticate(user=self.user)
        self.created = []
        import aikeys.views as views

        self.original_probe = views._probe_endpoint
        views._probe_endpoint = _Recorder((True, ""))
        self.addCleanup(lambda: setattr(views, "_probe_endpoint", self.original_probe))

    def tearDown(self):
        for cred in self.created:
            AiCredential.objects.filter(pk=cred.pk).delete()
        self.user.delete()
        super().tearDown()

    def _user_validate(self, api_key="jwt-key-9911", **extra):
        resp = self.user_client.post(
            "/api/ai/validate/",
            {"provider": "deepseek", "api_key": api_key},
            format="json",
            **extra,
        )
        if resp.status_code == 200 and resp.json().get("stored"):
            self.created.append(AiCredential.objects.get(user=self.user))
        return resp

    def test_jwt_user_validate_and_status_unchanged(self):
        resp = self._user_validate()
        self.assertEqual(resp.status_code, 200)
        cred = AiCredential.objects.get(user=self.user)
        self.assertIs(cred.identity_token, None)  # account-owned: no device token
        body = self.user_client.get("/api/ai/status/").json()
        self.assertIs(body["configured"], True)
        self.assertEqual(body["provider"], "deepseek")

    def test_jwt_wins_when_a_device_header_is_also_sent(self):
        token = device_token()
        resp = self._user_validate(**{HEADER_KWARG: token})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(AiCredential.objects.filter(user=self.user).count(), 1)
        self.assertEqual(AiCredential.objects.filter(identity_token=token).count(), 0)
        self.assertIs(AiCredential.objects.get(user=self.user).identity_token, None)

    def test_jwt_user_cannot_read_a_device_credential(self):
        anon = APIClient()
        other = device_token()
        resp = anon.post(
            "/api/ai/validate/",
            {"provider": "deepseek", "api_key": "dev-key-2244"},
            format="json",
            **{HEADER_KWARG: other},
        )
        self.assertEqual(resp.status_code, 200)
        self.created.append(AiCredential.objects.get(identity_token=other))
        body = self.user_client.get("/api/ai/status/").json()
        self.assertIs(body["configured"], False)

    def test_device_token_cannot_read_a_jwt_credential(self):
        self._user_validate()
        body = APIClient().get("/api/ai/status/", **{HEADER_KWARG: device_token()}).json()
        self.assertIs(body["configured"], False)

    def test_simplejwt_bearer_token_still_authenticates(self):
        """The global JWT authentication path (Authorization: Bearer) is intact."""
        jwt = str(AccessToken.for_user(self.user))
        resp = APIClient().get("/api/ai/status/", HTTP_AUTHORIZATION=f"Bearer {jwt}")
        self.assertEqual(resp.status_code, 200)
        self.assertIs(resp.json()["configured"], False)
