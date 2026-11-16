"""Tests for the aikeys app: crypto round-trip and the validation endpoints.

Isolation follows the project's dmb convention (no transactional rollback):
users are created with a unique ``pctest_`` prefix and deleted in tearDown.
The provider probe is stubbed so the tests never hit the network.
"""

import base64
import uuid

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from users.models import User

from .crypto import CredentialEncryptionError, decrypt_key, encrypt_key
from .ssrf import MAX_REDIRECTS, check_url, fetch_endpoint, probe_endpoint
from .models import AiCredential

MASTER = "test-master-key-for-aikeys"


def uid():
    return uuid.uuid4().hex[:12]


class CryptoTests(TestCase):
    """AES-256-GCM blob behavior (``aikeys.crypto``)."""

    KEY = "alpha-key-9876"

    def test_roundtrip_recovers_plaintext(self):
        blob = encrypt_key(self.KEY, MASTER)
        self.assertNotIn(self.KEY, blob)  # plaintext never in the blob
        self.assertEqual(decrypt_key(blob, MASTER), self.KEY)

    def test_two_encryptions_differ(self):
        a = encrypt_key(self.KEY, MASTER)
        b = encrypt_key(self.KEY, MASTER)
        self.assertNotEqual(a, b)  # random salt + nonce per blob

    def test_tampered_ciphertext_detected(self):
        blob = encrypt_key(self.KEY, MASTER)
        raw = bytearray(base64.urlsafe_b64decode(blob.encode()))
        raw[-1] ^= 0xFF  # corrupt the ciphertext
        with self.assertRaises(CredentialEncryptionError):
            decrypt_key(base64.urlsafe_b64encode(bytes(raw)).decode(), MASTER)

    def test_truncated_blob_detected(self):
        blob = encrypt_key(self.KEY, MASTER)
        raw = base64.urlsafe_b64decode(blob.encode())[:-12]  # cut into the tag
        with self.assertRaises(CredentialEncryptionError):
            decrypt_key(base64.urlsafe_b64encode(raw).decode(), MASTER)

    def test_wrong_master_detected(self):
        blob = encrypt_key(self.KEY, MASTER)
        with self.assertRaises(CredentialEncryptionError):
            decrypt_key(blob, "some-other-master")

    def test_missing_master_raises(self):
        with self.assertRaises(CredentialEncryptionError):
            encrypt_key(self.KEY, "")
        with self.assertRaises(CredentialEncryptionError):
            decrypt_key("anything", "")

    def test_malformed_blob_detected(self):
        for junk in ("not-base64!!!", "!!!", base64.urlsafe_b64encode(b"xx").decode()):
            with self.assertRaises(CredentialEncryptionError):
                decrypt_key(junk, MASTER)

    def test_legacy_ai1_blob_rejected_with_clear_error(self):
        legacy = base64.urlsafe_b64encode(
            b"ai1" + b"\x00" * 16 + b"\x00" * 12 + b"\x00" * 32 + b"Z"
        ).decode()
        with self.assertRaises(CredentialEncryptionError) as ctx:
            decrypt_key(legacy, MASTER)
        self.assertIn("retired", str(ctx.exception))


class AiKeysBaseTest(TestCase):
    """Shared setup: one user, an authenticated client, probe + master stubs."""

    def setUp(self):
        self.suffix = uid()
        self.user = User.objects.create_user(
            username=f"pctest_ai_{self.suffix}",
            email=f"pctest-ai-{self.suffix}@example.com",
            password="pctest-pass-123",
            role="student",
        )
        self.client = APIClient()
        self.client.force_authenticate(user=self.user)
        self.created_credentials = []

    def tearDown(self):
        for cred in self.created_credentials:
            AiCredential.objects.filter(pk=cred.pk).delete()
        self.user.delete()
        super().tearDown()

    def track(self, cred):
        self.created_credentials.append(cred)
        return cred


@override_settings(AI_CREDENTIAL_ENCRYPTION_KEY=MASTER)
class ProviderListTests(AiKeysBaseTest):
    def test_lists_all_configured_providers(self):
        from django.conf import settings

        resp = self.client.get("/api/ai/providers/")
        self.assertEqual(resp.status_code, 200)
        ids = {p["id"] for p in resp.json()["providers"]}
        self.assertEqual(ids, set(settings.AI_PROVIDERS.keys()))
        for provider in resp.json()["providers"]:
            self.assertNotIn("api_key", provider)  # catalog never carries a key


@override_settings(AI_CREDENTIAL_ENCRYPTION_KEY=MASTER)
class ValidateEndpointTests(AiKeysBaseTest):
    def _validate(self, **overrides):
        payload = {"provider": "deepseek", "api_key": "sk-test-000111"}
        payload.update(overrides)
        return self.client.post("/api/ai/validate/", payload, format="json")

    def test_requires_auth(self):
        anon = APIClient()
        resp = anon.post("/api/ai/validate/", {"provider": "deepseek", "api_key": "x"}, format="json")
        self.assertEqual(resp.status_code, 401)

    def test_unknown_provider_400(self):
        resp = self._validate(provider="skynet", api_key="k")
        self.assertEqual(resp.status_code, 400)

    def test_missing_key_400(self):
        resp = self._validate(api_key="")
        self.assertEqual(resp.status_code, 400)

    def test_rejected_key_is_not_stored(self):
        with self._stub_probe(ok=False, detail="The provider rejected this key (HTTP 401).") as stub:
            resp = self._validate()
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertIs(body["valid"], False)
        self.assertIs(body["stored"], False)
        self.assertIn("rejected", body["message"])
        self.assertEqual(AiCredential.objects.filter(user=self.user).count(), 0)
        self.assertEqual(stub.calls, 1)

    def test_valid_key_is_stored_encrypted(self):
        with self._stub_probe(ok=True, detail="") as stub:
            resp = self._validate(api_key="sk-test-000111")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertIs(body["valid"], True)
        self.assertIs(body["stored"], True)
        self.assertEqual(body["provider"], "deepseek")
        # The response must never leak the plaintext key.
        self.assertNotIn("sk-test-000111", str(body))
        self.assertEqual(body["key_hint"], "0111")

        cred = AiCredential.objects.get(user=self.user)
        self.track(cred)
        self.assertNotIn("sk-test-000111", cred.encrypted_key)  # not cleartext on disk
        self.assertEqual(decrypt_key(cred.encrypted_key, MASTER), "sk-test-000111")

    def test_revalidate_updates_same_row(self):
        with self._stub_probe(ok=True, detail=""):
            self._validate(api_key="sk-old")
            first = AiCredential.objects.get(user=self.user)
            self.track(first)
        with self._stub_probe(ok=True, detail=""):
            self._validate(api_key="sk-new-999")
        self.assertEqual(AiCredential.objects.filter(user=self.user).count(), 1)
        cred = AiCredential.objects.get(user=self.user)
        self.assertEqual(decrypt_key(cred.encrypted_key, MASTER), "sk-new-999")

    def test_endpoint_override_wins(self):
        with self._stub_probe(ok=True, detail="") as stub:
            resp = self._validate(provider="custom", api_key="k", endpoint="https://gw.example.com/v1")
        self.assertEqual(resp.status_code, 200)
        # The probe must have been pointed at the override, not a default.
        self.assertIn("gw.example.com", stub.last_base or "")

    class _Stub:
        def __init__(self):
            self.calls = 0
            self.last_base = None

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def __call__(self, base_url, api_key):
            self.calls += 1
            self.last_base = base_url
            return self._ok, self._detail

    def _stub_probe(self, ok, detail):
        import aikeys.views as views

        stub = self._Stub()
        stub._ok = ok
        stub._detail = detail
        original = views._probe_endpoint
        original_guard = views._probe_with_ssrf_guard
        views._probe_endpoint = stub
        views._probe_with_ssrf_guard = stub
        self.addCleanup(lambda: setattr(views, "_probe_endpoint", original))
        self.addCleanup(lambda: setattr(views, "_probe_with_ssrf_guard", original_guard))
        return stub


@override_settings(AI_CREDENTIAL_ENCRYPTION_KEY=MASTER)
class StatusEndpointTests(AiKeysBaseTest):
    def test_status_empty_when_nothing_stored(self):
        resp = self.client.get("/api/ai/status/")
        self.assertEqual(resp.status_code, 200)
        self.assertIs(resp.json()["configured"], False)

    def test_status_reflects_stored_credential(self):
        blob = encrypt_key("sk-status-777", MASTER)
        cred = AiCredential.objects.create(
            user=self.user,
            provider="openai",
            encrypted_key=blob,
            key_hint="777",
        )
        self.track(cred)
        resp = self.client.get("/api/ai/status/")
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertIs(body["configured"], True)
        self.assertEqual(body["provider"], "openai")
        self.assertEqual(body["key_hint"], "777")
        self.assertIs(body["verified"], True)
        self.assertNotIn("sk-status-777", str(body))


@override_settings(AI_CREDENTIAL_ENCRYPTION_KEY="")
class MasterMissingTests(AiKeysBaseTest):
    def test_validate_503_without_master_key(self):
        # No probe should happen and nothing should be stored.
        import aikeys.views as views

        stub = []
        original = views._probe_endpoint
        views._probe_endpoint = lambda base, key: stub.append(base) or (True, "")
        self.addCleanup(lambda: setattr(views, "_probe_endpoint", original))

        resp = self.client.post(
            "/api/ai/validate/", {"provider": "deepseek", "api_key": "sk-x"}, format="json"
        )
        self.assertEqual(resp.status_code, 503)
        self.assertIn("AI_CREDENTIAL_ENCRYPTION_KEY", resp.json()["error"])
        self.assertEqual(stub, [])  # probe never ran
        self.assertEqual(AiCredential.objects.filter(user=self.user).count(), 0)


class SsrfGateTests(TestCase):
    """The SSRF gate must refuse internal/unsafe URLs without connecting."""

    def _blocked(self, url, fragment):
        ok, why = check_url(url)
        self.assertFalse(ok, url)
        if fragment:
            self.assertIn(fragment, why)

    def test_loopback_blocked(self):
        self._blocked("http://127.0.0.1:11434/v1", "loopback")
        self._blocked("http://[::1]/v1", "loopback")
        self._blocked("http://0.0.0.0:80/v1", "unspecified")

    def test_localhost_blocked(self):
        self._blocked("http://localhost:11434/v1", "localhost")

    def test_private_ranges_blocked(self):
        self._blocked("http://192.168.0.102/v1", "private")
        self._blocked("http://10.1.2.3/v1", "private")
        self._blocked("http://172.16.0.1/v1", "private")

    def test_link_local_metadata_blocked(self):
        self._blocked("http://169.254.169.254/latest/meta-data/", "link-local")

    def test_ip_tricks_blocked(self):
        # Decimal and hex encodings of 127.0.0.1 must not bypass the gate.
        self._blocked("http://2130706433/", "loopback")
        self._blocked("http://0x7f000001/", "loopback")

    def test_reserved_range_blocked(self):
        # TEST-NET-2 (documentation range) and the broadcast address.
        self._blocked("http://203.0.113.10/v1", "address range")
        self._blocked("http://255.255.255.255/v1", "address range")

    def test_unsafe_protocols_blocked(self):
        for scheme in ("ftp", "file", "gopher"):
            self._blocked(f"{scheme}://example.com/v1", "http/https")

    def test_public_literal_ip_passes_offline(self):
        ok, why = check_url("https://8.8.8.8:443/v1")
        self.assertTrue(ok, why)


class SsrfRedirectTests(TestCase):
    """Redirect handling must re-validate every hop (fake transport).

    The transport hook returns a 3-tuple ``(status, location, body)``.
    ``fetch_endpoint`` (the core used by model discovery) returns
    ``(status, body, error)``; ``probe_endpoint`` (the key-validation
    compatibility wrapper) returns ``(ok, detail)``.
    """

    def _run(self, url, script, fn):
        calls = []

        def transport(host, port, ip, path, headers):
            calls.append((host, port, ip, path))
            return script[min(len(calls) - 1, len(script) - 1)]

        result = fn(url, {}, 5, transport=transport)
        return result, calls

    # --- fetch_endpoint: raw (status, body, error) -----------------------
    def test_fetch_success_returns_body(self):
        (st, body, err), calls = self._run(
            "https://8.8.8.8:8443/gw/v1",
            [(200, None, '{"data": [{"id": "m1"}]}')],
            fetch_endpoint,
        )
        self.assertEqual(st, 200)
        self.assertEqual(body, '{"data": [{"id": "m1"}]}')
        self.assertEqual(err, "")
        self.assertEqual(len(calls), 1)

    def test_fetch_redirect_to_loopback_blocked(self):
        (st, _body, err), calls = self._run(
            "https://8.8.8.8:8443/gw/v1",
            [(302, "http://127.0.0.1:6000/admin", None), (200, None, "")],
            fetch_endpoint,
        )
        self.assertIsNone(st)
        self.assertIn("loopback", err)
        self.assertEqual(len(calls), 1)  # never reaches the internal hop

    def test_fetch_redirect_to_link_local_blocked(self):
        (st, _body, err), _ = self._run(
            "https://8.8.8.8:8443/gw/v1",
            [(302, "http://169.254.169.254/latest/meta-data/", None)],
            fetch_endpoint,
        )
        self.assertIsNone(st)
        self.assertIn("link-local", err)

    def test_fetch_redirect_to_private_range_blocked(self):
        (st, _body, err), _ = self._run(
            "https://8.8.8.8:8443/gw/v1",
            [(302, "http://192.168.0.102/v1", None)],
            fetch_endpoint,
        )
        self.assertIsNone(st)
        self.assertIn("private", err)

    def test_fetch_redirect_to_another_public_host_followed(self):
        (st, body, err), calls = self._run(
            "https://8.8.8.8:8443/gw/v1",
            [(302, "http://8.8.4.4:9000/v2", None), (200, None, "FINAL")],
            fetch_endpoint,
        )
        self.assertEqual(st, 200)
        self.assertEqual(body, "FINAL")
        self.assertEqual(err, "")
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1][0], "8.8.4.4")

    def test_fetch_redirect_loop_rejected(self):
        (st, _body, err), calls = self._run(
            "https://8.8.8.8:8443/gw/v1",
            [(302, "http://8.8.4.4:9000/again", None)] * 10,
            fetch_endpoint,
        )
        self.assertIsNone(st)
        self.assertIn("redirected too many times", err)
        self.assertEqual(len(calls), MAX_REDIRECTS + 1)

    def test_fetch_401_reports_status_not_error(self):
        (st, body, err), _ = self._run("https://8.8.8.8:8443/gw/v1", [(401, None, None)], fetch_endpoint)
        self.assertEqual(st, 401)
        self.assertIsNone(body)
        self.assertEqual(err, "")

    # --- probe_endpoint: (ok, detail) compatibility wrapper -------------
    def test_probe_success(self):
        (ok, why), _ = self._run("https://8.8.8.8:8443/gw/v1", [(200, None, "")], probe_endpoint)
        self.assertTrue(ok)
        self.assertEqual(why, "")

    def test_probe_401_surfaces_as_key_rejection(self):
        (ok, why), _ = self._run("https://8.8.8.8:8443/gw/v1", [(401, None, None)], probe_endpoint)
        self.assertFalse(ok)
        self.assertIn("rejected this key", why)

    def test_probe_500_surfaces_as_unverified(self):
        (ok, why), _ = self._run("https://8.8.8.8:8443/gw/v1", [(500, None, None)], probe_endpoint)
        self.assertFalse(ok)
        self.assertIn("could not be verified", why)

    def test_probe_redirect_loop_rejected(self):
        (ok, why), calls = self._run(
            "https://8.8.8.8:8443/gw/v1",
            [(302, "http://8.8.4.4:9000/again", None)] * 10,
            probe_endpoint,
        )
        self.assertFalse(ok)
        self.assertIn("redirected too many times", why)
        self.assertEqual(len(calls), MAX_REDIRECTS + 1)


@override_settings(AI_CREDENTIAL_ENCRYPTION_KEY=MASTER)
class SsrfViewTests(AiKeysBaseTest):
    """User-supplied endpoints that fail the SSRF gate never hit the network."""

    def _assert_blocked(self, endpoint, fragment):
        resp = self.client.post(
            "/api/ai/validate/",
            {"provider": "custom", "api_key": "user-key-4242", "endpoint": endpoint},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        body = resp.json()
        self.assertIs(body["valid"], False)
        self.assertIs(body["stored"], False)
        self.assertIn(fragment, body["message"])
        self.assertNotIn("user-key-4242", str(body))
        self.assertEqual(AiCredential.objects.filter(user=self.user).count(), 0)

    def test_loopback_endpoint_blocked(self):
        self._assert_blocked("http://127.0.0.1:59999/v1", "loopback")

    def test_localhost_endpoint_blocked(self):
        self._assert_blocked("http://localhost:11434/v1", "localhost")

    def test_metadata_endpoint_blocked(self):
        self._assert_blocked("http://169.254.169.254/v1", "link-local")

    def test_private_lan_endpoint_blocked(self):
        self._assert_blocked("http://192.168.0.102:3000/v1", "private")

    def test_unsafe_protocol_rejected_before_probe(self):
        # Non-http(s) input is not even a usable endpoint: it falls back to
        # the (empty) custom base and fails with a clean 400, no probing.
        resp = self.client.post(
            "/api/ai/validate/",
            {"provider": "custom", "api_key": "user-key-4242", "endpoint": "ftp://example.com/v1"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(AiCredential.objects.filter(user=self.user).count(), 0)

    def test_operator_configured_base_skips_guard(self):
        # Without a user-supplied endpoint the plain probe runs, so trusted
        # operator-configured gateways keep working unchanged.
        import aikeys.views as views

        seen = []
        original = views._probe_endpoint
        views._probe_endpoint = lambda base, key: seen.append(base) or (True, "")
        self.addCleanup(lambda: setattr(views, "_probe_endpoint", original))

        resp = self.client.post(
            "/api/ai/validate/",
            {"provider": "deepseek", "api_key": "user-key-4242"},
            format="json",
        )
        self.assertEqual(resp.status_code, 200)
        self.assertIs(resp.json()["valid"], True)
        self.assertEqual(len(seen), 1)
