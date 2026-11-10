"""Endpoint & read-model tests: availability, discovery, requests, sessions,
activity, profile, and Sealed invisibility (I4)."""

from rest_framework.test import APIClient

from .. import cas
from ..models import (
    CANCELLED,
    CONFIRMED,
    PENDING,
    SEALED,
    SUGGESTED,
    AvailabilitySlot,
    Session,
)
from .base import TutorsBaseTest, uid


class ReadModelTest(TutorsBaseTest):
    def setUp(self):
        super().setUp()
        self.tutor = self.make_tutor(full_name="Tutor Test")
        self.student = self.make_user(full_name="Student Test")
        self.sc = APIClient()
        self.sc.force_authenticate(user=self.student)
        self.tc = APIClient()
        self.tc.force_authenticate(user=self.tutor)

    def test_sealed_bookings_invisible_in_all_read_endpoints(self):
        slot = self.make_slot(self.tutor, "2099-03-10", "09:00")
        b = self.make_session(self.student, self.tutor, SEALED, slot=slot)
        cas.claim_slot(slot, self.student, b)

        for path in ("/api/requests/", "/api/sessions/", "/api/activity/"):
            resp = self.sc.get(path)
            self.assertEqual(resp.status_code, 200)
            body = resp.json()
            for key in ("requests", "sessions", "activity"):
                for item in body.get(key, []):
                    self.assertNotEqual(item.get("id"), str(b.pk),
                                        f"Sealed leaked via {path}")
                    self.assertNotEqual(item.get("status"), SEALED)
        # Activation makes it visible.
        self.assertEqual(cas.activate_session(b), 1)
        resp = self.sc.get("/api/requests/")
        ids = [i["id"] for i in resp.json()["requests"]]
        self.assertIn(str(b.pk), ids)

    def test_requests_display_status_rejected_vs_cancelled(self):
        slot = self.make_slot(self.tutor, "2099-03-11", "09:00")
        b = self.make_session(self.student, self.tutor, PENDING, slot=slot)
        cas.transition_session(b, PENDING, status=CANCELLED, cancelled_by="tutor")
        r = self.sc.get("/api/requests/")
        item = [i for i in r.json()["requests"] if i["id"] == str(b.pk)][0]
        self.assertEqual(item["display_status"], "Rejected")

        slot2 = self.make_slot(self.tutor, "2099-03-11", "10:00")
        b2 = self.make_session(self.student, self.tutor, PENDING, slot=slot2)
        cas.transition_session(b2, PENDING, status=SUGGESTED,
                               suggested_date="2099-03-11", suggested_time="11:00")
        cas.transition_session(b2, SUGGESTED, status=CANCELLED, cancelled_by="student")
        r2 = self.sc.get("/api/requests/")
        item2 = [i for i in r2.json()["requests"] if i["id"] == str(b2.pk)][0]
        self.assertEqual(item2["display_status"], "Cancelled")

    def test_tutor_requests_are_incoming(self):
        slot = self.make_slot(self.tutor, "2099-03-12", "09:00")
        b = self.make_session(self.student, self.tutor, PENDING, slot=slot)
        cas.claim_slot(slot, self.student, b)
        r = self.tc.get("/api/requests/")
        ids = [i["id"] for i in r.json()["requests"]]
        self.assertIn(str(b.pk), ids, "tutor sees incoming PENDING requests")
        # The owning student sees their own request too (role-scoped view).
        r2 = self.sc.get("/api/requests/")
        ids2 = [i["id"] for i in r2.json()["requests"]]
        self.assertIn(str(b.pk), ids2, "student sees their own PENDING request")

    def test_requests_exclude_sealed_and_confirmed(self):
        slot = self.make_slot(self.tutor, "2099-03-12", "11:00")
        b = self.make_session(self.student, self.tutor, PENDING, slot=slot)
        cas.claim_slot(slot, self.student, b)
        self.assertEqual(cas.transition_session(b, PENDING, status=CONFIRMED), 1)
        for client in (self.sc, self.tc):
            r = client.get("/api/requests/")
            self.assertEqual(r.json()["requests"], [], "requests = non-terminal only")

    def test_activity_feed_roles(self):
        slot = self.make_slot(self.tutor, "2099-03-13", "09:00")
        b = self.make_session(self.student, self.tutor, PENDING, slot=slot)
        r = self.tc.get("/api/activity/")
        texts = [i["text"] for i in r.json()["activity"]]
        self.assertTrue(any("New request" in t for t in texts))
        cas.transition_session(b, PENDING, status=SUGGESTED,
                               suggested_date="2099-03-13", suggested_time="10:00")
        r2 = self.sc.get("/api/activity/")
        texts2 = [i["text"] for i in r2.json()["activity"]]
        self.assertTrue(any("suggested" in t for t in texts2))

    def test_sessions_list_only_confirmed(self):
        slot = self.make_slot(self.tutor, "2099-03-14", "09:00")
        b = self.make_session(self.student, self.tutor, PENDING, slot=slot)
        r = self.sc.get("/api/sessions/")
        self.assertEqual(r.json()["sessions"], [])
        cas.transition_session(b, PENDING, status=CONFIRMED)
        r2 = self.sc.get("/api/sessions/")
        self.assertEqual(len(r2.json()["sessions"]), 1)

    def test_tutor_discovery_and_slots(self):
        r = self.sc.get("/api/tutors/")
        self.assertEqual(r.status_code, 200)
        found = [t for t in r.json()["tutors"] if t["id"] == str(self.tutor.pk)]
        self.assertEqual(len(found), 1)
        self.assertIn("C", found[0]["subjects"])
        self.assertEqual(found[0]["open_slots_next_7d"], 0)

        self.make_slot(self.tutor, "2099-03-15", "09:00")
        # 2099 dates are outside the next-7d window, so open count stays 0;
        # create one in-window slot relative to today instead:
        import datetime
        today = datetime.date.today().isoformat()
        in_window = self.make_slot(self.tutor, today, "09:00")
        r2 = self.sc.get(f"/api/tutors/{self.tutor.pk}/")
        self.assertEqual(r2.status_code, 200)
        self.assertEqual(r2.json()["open_slots_next_7d"], 1)
        slot_items = [s for s in r2.json()["slots"] if s["id"] == str(in_window.pk)]
        self.assertEqual(len(slot_items), 1)
        self.assertFalse(slot_items[0]["reserved"])

    def test_availability_get_returns_own_slots_with_reserved_flag(self):
        import datetime
        today = datetime.date.today().isoformat()
        slot = self.make_slot(self.tutor, today, "09:00")
        r = self.tc.get(f"/api/availability/?date={today}")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.json()["slots"]), 1)
        self.assertFalse(r.json()["slots"][0]["reserved"])

        b = self.make_session(self.student, self.tutor, SEALED, slot=slot)
        cas.claim_slot(slot, self.student, b)
        r2 = self.tc.get(f"/api/availability/?date={today}")
        self.assertTrue(r2.json()["slots"][0]["reserved"])
        self.assertEqual(r2.json()["slots"][0]["reserved_session"], str(b.pk))

    def test_actions_matrix(self):
        slot = self.make_slot(self.tutor, "2099-04-10", "09:00")
        b = self.make_session(self.student, self.tutor, PENDING, slot=slot)
        cas.claim_slot(slot, self.student, b)
        slot.refresh_from_db()

        # Student cannot act on Pending (web parity: "Waiting for tutor").
        r = self.sc.post(f"/api/sessions/{b.pk}/actions/",
                         {"action": "confirm"}, format="json")
        self.assertEqual(r.status_code, 409)

        # Tutor suggests.
        r = self.tc.post(f"/api/sessions/{b.pk}/actions/",
                         {"action": "suggest", "date": "2099-04-10",
                          "time": "10:00", "suggestion": "later"},
                         format="json")
        self.assertEqual(r.status_code, 200)
        b.refresh_from_db()
        self.assertEqual(b.status, SUGGESTED)

        # Student confirms at the suggested time (10:00 != original 09:00 ->
        # moved confirm: origin slot is released; no slot exists at 10:00,
        # so the booking becomes a custom-time Confirmed).
        r = self.sc.post(f"/api/sessions/{b.pk}/actions/",
                         {"action": "confirm"}, format="json")
        self.assertEqual(r.status_code, 200)
        b.refresh_from_db()
        self.assertEqual(b.status, CONFIRMED)
        self.assertEqual(b.time, "10:00")
        self.assertEqual(b.date, "2099-04-10")
        self.assertIsNone(b.slot, "moved-to-custom confirm clears the slot ref")
        # The origin slot was released (time actually moved).
        slot.refresh_from_db()
        self.assertIsNone(slot.reserved_by, "moved confirm releases the origin slot")

        # Idempotent re-confirm.
        r2 = self.sc.post(f"/api/sessions/{b.pk}/actions/",
                          {"action": "confirm"}, format="json")
        self.assertEqual(r2.status_code, 200)
        self.assertTrue(r2.json().get("idempotent"))

    def test_tutor_confirm_pending_holds_slot_for_life(self):
        slot = self.make_slot(self.tutor, "2099-04-15", "09:00")
        b = self.make_session(self.student, self.tutor, PENDING, slot=slot)
        cas.claim_slot(slot, self.student, b)
        slot.refresh_from_db()

        r = self.tc.post(f"/api/sessions/{b.pk}/actions/",
                         {"action": "confirm"}, format="json")
        self.assertEqual(r.status_code, 200)
        b.refresh_from_db()
        self.assertEqual(b.status, CONFIRMED)
        slot.refresh_from_db()
        self.assertIsNotNone(slot.reserved_by, "Confirmed booking holds its slot for life")

        # Idempotent.
        r2 = self.tc.post(f"/api/sessions/{b.pk}/actions/",
                          {"action": "confirm"}, format="json")
        self.assertEqual(r2.status_code, 200)
        self.assertTrue(r2.json().get("idempotent"))
        self.assert_invariants()

    def test_profile_get_patch_and_become_tutor(self):
        r = self.sc.get("/api/profile/")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["role"], "student")

        r = self.sc.patch("/api/profile/",
                          {"bio": "Hi", "subjects": ["C"]}, format="json")
        self.assertEqual(r.status_code, 200)
        self.student.refresh_from_db()
        self.assertEqual(self.student.bio, "Hi")
        self.assertEqual(self.student.subjects, ["C"])

        r = self.tc.post("/api/profile/become-tutor/", format="json")
        self.assertEqual(r.status_code, 409, "already a tutor")
        r2 = self.sc.post("/api/profile/become-tutor/", format="json")
        self.assertEqual(r2.status_code, 200)
