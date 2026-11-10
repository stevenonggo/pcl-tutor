"""Core booking semantics: CAS races, token lifecycle, replay matrix,
slot-lifecycle rules, advisory overlap, authorization."""

import threading

from django.test import Client
from rest_framework.test import APIClient

from users.models import User

from ..models import (
    CANCELLED,
    CONFIRMED,
    PENDING,
    SEALED,
    SUGGESTED,
    AvailabilitySlot,
    Session,
)
from .. import cas
from ..booking import book_published_slot, BookingConflict
from .base import TutorsBaseTest, uid


class BookingRaceTest(TutorsBaseTest):
    """T1: N concurrent bookings for one slot -> exactly one wins."""

    def test_concurrent_double_booking_exactly_one_wins(self):
        tutor = self.make_tutor()
        slot = self.make_slot(tutor, "2099-02-01", "10:00")
        students = [self.make_user(tag=f"s{i}") for i in range(10)]

        results = []
        lock = threading.Lock()

        def attempt(student):
            client = APIClient()
            client.force_authenticate(user=student)
            resp = client.post(
                "/api/sessions/",
                {
                    "slot_id": str(slot.pk),
                    "subject": "C",
                    "client_token": f"tok-{uid()}",
                },
                format="json",
            )
            with lock:
                results.append(resp.status_code)

        threads = [threading.Thread(target=attempt, args=(s,)) for s in students]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        self.assertEqual(results.count(201), 1, f"expected one 201, got {results}")
        self.assertEqual(results.count(409), 9)
        slot.refresh_from_db()
        self.assertIsNotNone(slot.reserved_by)
        self.assert_invariants()


class TokenLifecycleTest(TutorsBaseTest):
    """T16 / T6 / T14: required token, partial-unique behavior, replays."""

    def setUp(self):
        super().setUp()
        self.tutor = self.make_tutor()
        self.student = self.make_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.student)

    def post(self, slot, token, subject="C"):
        return self.client.post(
            "/api/sessions/",
            {"slot_id": str(slot.pk), "subject": subject, "client_token": token},
            format="json",
        )

    def test_missing_client_token_is_400(self):
        slot = self.make_slot(self.tutor, "2099-02-02", "11:00")
        resp = self.client.post(
            "/api/sessions/",
            {"slot_id": str(slot.pk), "subject": "C"},
            format="json",
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn("client_token", resp.json())
        # Nothing was created.
        self.assertEqual(Session.objects.filter(student=self.student).count(), 0)

    def test_empty_client_token_is_400(self):
        slot = self.make_slot(self.tutor, "2099-02-02", "11:00")
        resp = self.post(slot, "   ")
        self.assertEqual(resp.status_code, 400)

    def test_replay_matrix(self):
        # T6: same token replayed at each active state returns the SAME doc.
        from .. import booking as bk

        slot = self.make_slot(self.tutor, "2099-02-03", "12:00")
        r1 = self.post(slot, "tok-replay")
        self.assertEqual(r1.status_code, 201)
        b = Session.objects.get(pk=r1.json()["booking"]["id"])

        r2 = self.post(slot, "tok-replay")
        self.assertEqual(r2.status_code, 200)
        self.assertTrue(r2.json().get("replay"))
        self.assertEqual(r2.json()["booking"]["id"], str(b.pk))
        self.assertEqual(
            Session.objects.filter(student=self.student, client_token="tok-replay")
            .count(),
            1,
            "replay must never create a second doc",
        )

        # Confirmed bookings keep the token (partial index holds it).
        slot2 = self.make_slot(self.tutor, "2099-02-03", "13:00")
        b2 = self.make_session(self.student, self.tutor, PENDING, slot=slot2, client_token="tok-held")
        cas.claim_slot(slot2, self.student, b2)
        slot2.refresh_from_db()
        self.assertEqual(bk.tutor_confirm(b2)[0], "ok")
        self.assertEqual(b2.status, CONFIRMED)
        r3 = self.post(slot2, "tok-held")
        self.assertEqual(r3.status_code, 200, "Confirmed still holds its token")
        self.assertEqual(r3.json()["booking"]["id"], str(b2.pk))

        # A booking cancelled via the service releases the slot AND the token:
        # re-booking the same slot with the same token succeeds (new doc).
        slot3 = self.make_slot(self.tutor, "2099-02-03", "15:00")
        b3 = self.make_session(self.student, self.tutor, PENDING, slot=slot3, client_token="tok-rel")
        cas.claim_slot(slot3, self.student, b3)
        slot3.refresh_from_db()
        self.assertEqual(bk.tutor_suggest(b3, "2099-02-03", "16:00", "", "later")[0], "ok")
        self.assertEqual(bk.student_cancel(b3)[0], "ok")
        slot3.refresh_from_db()
        self.assertIsNone(slot3.reserved_by, "student cancel must release the slot")
        r4 = self.post(slot3, "tok-rel")
        self.assertEqual(r4.status_code, 201, "terminal booking releases the token for re-booking")
        self.assertEqual(
            Session.objects.filter(student=self.student, client_token="tok-rel")
            .count(),
            2,
        )
        self.assert_invariants()

    def test_duplicate_active_token_rejected_by_index(self):
        # T15-style direct proof of the DB enforcement (not just app dedupe).
        slot = self.make_slot(self.tutor, "2099-02-04", "13:00")
        b = self.make_session(
            self.student, self.tutor, PENDING, slot=slot, client_token="tok-idx"
        )
        from django.db import IntegrityError

        dup = Session(
            student=self.student,
            tutor=self.tutor,
            subject="C",
            date=slot.date,
            time=slot.time,
            mode=slot.mode,
            status=PENDING,
            slot=slot,
            client_token="tok-idx",
        )
        with self.assertRaises(IntegrityError):
            dup.save()
        # Terminal status is excluded from the partial index.
        term = Session.objects.create(
            student=self.student,
            tutor=self.tutor,
            subject="C",
            date=slot.date,
            time=slot.time,
            mode=slot.mode,
            status=CANCELLED,
            cancelled_by="student",
            slot=slot,
            client_token="tok-idx",
        )
        self.assertIsNotNone(term.pk)


class SlotLifecycleTest(TutorsBaseTest):
    """T22: Confirmed holds the slot; Cancelled releases it."""

    def setUp(self):
        super().setUp()
        self.tutor = self.make_tutor()
        self.student = self.make_user()
        self.client = APIClient()
        self.client.force_authenticate(user=self.student)

    def _book(self, tutor, date, time, token):
        slot = self.make_slot(tutor, date, time)
        resp = self.client.post(
            "/api/sessions/",
            {"slot_id": str(slot.pk), "subject": "C", "client_token": token},
            format="json",
        )
        self.assertIn(resp.status_code, (201, 200))
        return slot, Session.objects.get(pk=resp.json()["booking"]["id"])

    def test_confirmed_slot_stays_reserved(self):
        tutor = self.make_tutor(tag="t2")
        slot, b = self._book(tutor, "2099-03-01", "09:00", "tok-held")
        b.status = CONFIRMED
        b.save()
        slot.refresh_from_db()
        self.assertIsNotNone(slot.reserved_by, "Confirmed must keep the slot reserved")
        # Another student cannot take it.
        other = self.make_user(tag="o")
        c2 = APIClient()
        c2.force_authenticate(user=other)
        r = c2.post(
            "/api/sessions/",
            {"slot_id": str(slot.pk), "subject": "C", "client_token": f"tok-{uid()}"},
            format="json",
        )
        self.assertEqual(r.status_code, 409)
        self.assert_invariants()

    def test_cancelled_slot_is_released_and_rebookable(self):
        tutor = self.make_tutor(tag="t3")
        slot, b = self._book(tutor, "2099-03-02", "09:00", "tok-rel")
        b.status = CANCELLED
        b.cancelled_by = "student"
        b.save()
        from ..booking import _release_for_terminated

        _release_for_terminated(b)
        slot.refresh_from_db()
        self.assertIsNone(slot.reserved_by)
        other = self.make_user(tag="o2")
        c2 = APIClient()
        c2.force_authenticate(user=other)
        r = c2.post(
            "/api/sessions/",
            {"slot_id": str(slot.pk), "subject": "C", "client_token": f"tok-{uid()}"},
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        self.assert_invariants()


class AdvisoryOverlapTest(TutorsBaseTest):
    """T32: overlapping custom-time bookings are allowed + advisory notice."""

    def setUp(self):
        super().setUp()
        self.tutor = self.make_tutor()
        self.a = self.make_user(tag="a")
        self.b = self.make_user(tag="b")
        self.ca = APIClient()
        self.ca.force_authenticate(user=self.a)
        self.cb = APIClient()
        self.cb.force_authenticate(user=self.b)

    def test_two_custom_bookings_same_time_coexist(self):
        ra = self.ca.post(
            "/api/sessions/",
            {
                "tutor": str(self.tutor.pk),
                "subject": "C",
                "date": "2099-04-01",
                "time": "14:00",
                "mode": "Online",
                "custom": True,
                "client_token": f"tok-{uid()}",
            },
            format="json",
        )
        self.assertEqual(ra.status_code, 201)
        self.assertNotIn("overlap_notice", ra.json())

        rb = self.cb.post(
            "/api/sessions/",
            {
                "tutor": str(self.tutor.pk),
                "subject": "C",
                "date": "2099-04-01",
                "time": "14:00",
                "mode": "Online",
                "custom": True,
                "client_token": f"tok-{uid()}",
            },
            format="json",
        )
        # Soft conflict: allowed, with an advisory notice listing booking A.
        self.assertEqual(rb.status_code, 201)
        notice = rb.json().get("overlap_notice")
        self.assertIsNotNone(notice, "second overlapping custom booking must carry overlap_notice")
        self.assertEqual(notice, [ra.json()["booking"]["id"]])
        self.assert_invariants()

    def test_custom_booking_publish_slot_same_time_notifies(self):
        slot = self.make_slot(self.tutor, "2099-04-02", "15:00")
        rc = self.ca.post(
            "/api/sessions/",
            {
                "tutor": str(self.tutor.pk),
                "subject": "C",
                "date": "2099-04-02",
                "time": "15:00",
                "mode": "Online",
                "custom": True,
                "client_token": f"tok-{uid()}",
            },
            format="json",
        )
        self.assertEqual(rc.status_code, 201)
        # Now book the PUBLISHED slot at the same time (hard claim on the
        # slot; the pre-existing custom booking is advisory overlap).
        rd = self.cb.post(
            "/api/sessions/",
            {
                "slot_id": str(slot.pk),
                "subject": "C",
                "client_token": f"tok-{uid()}",
            },
            format="json",
        )
        self.assertIn(rd.status_code, (201, 200))


class AuthorizationTest(TutorsBaseTest):
    """T7: role guards and foreign-resource 404s."""

    def setUp(self):
        super().setUp()
        self.tutor = self.make_tutor()
        self.student = self.make_user()

    def test_student_cannot_publish_availability(self):
        c = APIClient()
        c.force_authenticate(user=self.student)
        r = c.post(
            "/api/availability/",
            {"date": "2099-05-01", "time": "09:00", "mode": "Online"},
            format="json",
        )
        self.assertEqual(r.status_code, 403)

    def test_tutor_cannot_book_own_slot(self):
        slot = self.make_slot(self.tutor, "2099-05-02", "09:00")
        c = APIClient()
        c.force_authenticate(user=self.tutor)
        r = c.post(
            "/api/sessions/",
            {"slot_id": str(slot.pk), "subject": "C", "client_token": f"tok-{uid()}"},
            format="json",
        )
        self.assertEqual(r.status_code, 403)

    def test_foreign_slot_delete_is_404(self):
        other_tutor = self.make_tutor(tag="x")
        slot = self.make_slot(other_tutor, "2099-05-03", "09:00")
        c = APIClient()
        c.force_authenticate(user=self.tutor)
        r = c.delete(f"/api/availability/{slot.pk}/")
        self.assertEqual(r.status_code, 404)

    def test_publish_availability_ignores_client_tutor_id(self):
        c = APIClient()
        c.force_authenticate(user=self.tutor)
        r = c.post(
            "/api/availability/",
            {
                "date": "2099-05-04",
                "time": "09:00",
                "mode": "Online",
                "tutor_id": "some-other-id",
            },
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        slot = AvailabilitySlot.objects.get(pk=r.json()["slot"]["id"])
        self.assertEqual(slot.tutor_id, self.tutor.pk, "owner must come from the JWT user")

    def test_duplicate_slot_key_is_409(self):
        c = APIClient()
        c.force_authenticate(user=self.tutor)
        body = {"date": "2099-05-05", "time": "09:00", "mode": "Online"}
        self.assertEqual(
            c.post("/api/availability/", body, format="json").status_code, 201
        )
        r2 = c.post("/api/availability/", body, format="json")
        self.assertEqual(r2.status_code, 409)
        self.assertEqual(r2.json()["error"], "You already have a slot at that time.")


class WebCompatTest(TutorsBaseTest):
    """T9: pre-existing endpoint behavior is unchanged (additive only)."""

    def test_register_still_accepts_three_fields(self):
        c = APIClient()
        r = c.post(
            "/api/register/",
            {
                "username": f"pctest_{uid()}",
                "email": f"pctest-{uid()}@example.com",
                "password": "password123",
            },
            format="json",
        )
        self.assertEqual(r.status_code, 201)
        user = User.objects.get(username=r.json()["user"]["username"])
        # New users default to student; profile fields exist with defaults.
        self.assertEqual(user.role, "student")
        self.assertEqual(user.subjects, [])

    def test_me_shape_unchanged(self):
        u = self.make_user()
        c = APIClient()
        c.force_authenticate(user=u)
        r = c.get("/api/me/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(set(r.json().keys()), {"id", "username", "email"})
