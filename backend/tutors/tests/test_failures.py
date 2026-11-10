"""Failure-window and reconciliation tests: T2-T5, T14, T19-T21, T28."""

from datetime import timedelta
from unittest import mock

from django.utils import timezone

from rest_framework.test import APIClient

from .. import cas
from .. import reconcile
from ..booking import BookingConflict, book_published_slot
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


class FailureWindowTest(TutorsBaseTest):
    """T2-T5: every crash window in the published-booking flow."""

    def setUp(self):
        super().setUp()
        self.tutor = self.make_tutor()
        self.student = self.make_user()
        self.slot = self.make_slot(self.tutor, "2099-01-05", "09:00")

    def test_t2_session_creation_failure_leaves_slot_untouched(self):
        # Inject: Session.objects.create raises AFTER the view's dedupe.
        with mock.patch(
            "tutors.cas.create_sealed_session",
            side_effect=RuntimeError("db down"),
        ):
            with self.assertRaises(RuntimeError):
                book_published_slot(
                    self.student, self.slot, "C", "", "", f"tok-{uid()}"
                )
        self.slot.refresh_from_db()
        self.assertIsNone(self.slot.reserved_by, "no claim may be written on create failure")
        # Retry with a healthy create succeeds.
        outcome, b, _ = book_published_slot(
            self.student, self.slot, "C", "", "", f"tok-{uid()}"
        )
        self.assertIn(outcome, ("created", "replay"))
        self.assert_invariants()

    def test_t3_claim_failure_is_retry_safe(self):
        # Inject: the CAS claim write fails (DB hiccup). The slot state is
        # unknown but the retry path resolves it through the linked-ours /
        # open branches. The retry MUST reuse the same client_token so the
        # service reuses the same Sealed document (never a second doc).
        token = f"tok-{uid()}"
        with mock.patch(
            "tutors.cas.claim_slot", side_effect=RuntimeError("db down")
        ):
            with self.assertRaises(RuntimeError):
                book_published_slot(
                    self.student, self.slot, "C", "", "", token
                )
        # A Sealed booking now exists (created before the claim failed):
        # the same-token retry REUSES it (fresh Sealed, never replaced).
        outcome, b, _ = book_published_slot(
            self.student, self.slot, "C", "", "", token
        )
        self.assertIn(outcome, ("created", "replay"))
        b.refresh_from_db()
        self.assertEqual(b.status, PENDING)
        self.slot.refresh_from_db()
        self.assertEqual(self.slot.reserved_by, self.student)
        self.assertEqual(
            Session.objects.filter(student=self.student, client_token=token).count(),
            1,
            "retry reuses the same Sealed doc; no duplicate",
        )
        self.assert_invariants()

    def test_t4_activation_death_recovers_after_claim_grace(self):
        # Crash AFTER the claim (B Sealed+linked), activation never ran.
        b = cas.create_sealed_session(
            student=self.student,
            tutor=self.tutor,
            subject="C",
            date=self.slot.date,
            time=self.slot.time,
            mode=self.slot.mode,
            location=self.slot.location,
            duration=self.slot.duration,
            slot=self.slot,
            client_token=f"tok-{uid()}",
        )
        cas.claim_slot(self.slot, self.student, b)
        self.slot.refresh_from_db()
        self.assertEqual(self.slot.reserved_session, b)

        # Within the claim grace: untouched, and B is invisible everywhere.
        self.assertEqual(reconcile.reconcile_all(), {})
        self.assertNotIn(
            b.status, [PENDING, SUGGESTED, CONFIRMED, CANCELLED], "Sealed stays Sealed in-window"
        )

        # Age past the claim grace: R3 releases + collects B.
        self.age_slot_claim(self.slot, reconcile.claim_grace().total_seconds() / 60 + 1)
        counts = reconcile.reconcile_all()
        self.assertIn("R3", counts)
        self.slot.refresh_from_db()
        self.assertIsNone(self.slot.reserved_by, "slot back to open after recovery")
        self.assertIsNone(
            Session.objects.filter(pk=b.pk).first(), "Sealed B collected"
        )
        self.assert_invariants()

    def test_t5_late_original_request_cannot_complete(self):
        # A stale Sealed B whose claim was lost must not activate.
        b = self.make_session(
            self.student, self.tutor, SEALED, slot=self.slot, client_token=f"tok-{uid()}"
        )
        cas.claim_slot(self.slot, self.student, b)
        self.slot.refresh_from_db()
        # Age the claim, let reconcile release it, then another student takes it.
        self.age_slot_claim(self.slot, reconcile.claim_grace().total_seconds() / 60 + 1)
        self.assertIn("R3", reconcile.reconcile_all())
        other = self.make_user(tag="o")
        outcome_other, b_other, _ = book_published_slot(
            other, self.slot, "C", "", "", f"tok-{uid()}"
        )
        self.assertIn(outcome_other, ("created", "replay"))

        # The stale original's late retry: its B was R3-collected, so a
        # fresh retry under a NEW token is either clean (slot open) or a
        # "taken" conflict (slot now held). Never a stale activation.
        token2 = f"tok-{uid()}"
        outcome, b2, payload = book_published_slot(
            self.student, self.slot, "C", "", "", token2
        )
        self.slot.refresh_from_db()
        if self.slot.reserved_by is not None:
            self.assertEqual(outcome, "conflict")
            self.assertEqual(payload["error"].code, "taken")
        else:
            self.assertIn(outcome, ("created", "replay"))
            b2.refresh_from_db()
            self.assertEqual(b2.status, PENDING)
        self.assert_invariants()

    def test_t14_fresh_sealed_never_deleted_by_rules(self):
        b = self.make_session(
            self.student, self.tutor, SEALED, slot=self.slot, client_token=f"tok-{uid()}"
        )
        cas.claim_slot(self.slot, self.student, b)
        # Fresh: reconcile is a full no-op even when run repeatedly.
        self.assertEqual(reconcile.reconcile_all(), {})
        self.assertEqual(reconcile.reconcile_all(), {})
        self.assertIsNotNone(Session.objects.filter(pk=b.pk).first())

    def test_t19_cancel_success_with_failed_release_recovers_via_r5(self):
        tutor = self.make_tutor(tag="t19")
        student = self.make_user(tag="s19")
        s0 = self.make_slot(tutor, "2099-01-06", "09:00")
        b = self.make_session(student, tutor, PENDING, slot=s0, client_token=f"tok-{uid()}")
        cas.claim_slot(s0, student, b)
        s0.refresh_from_db()

        # Cancel succeeds, the release write fails.
        n = cas.transition_session(b, PENDING, status=CANCELLED, cancelled_by="student")
        self.assertEqual(n, 1)
        s0.refresh_from_db()
        self.assertIsNotNone(s0.reserved_by, "release failed -> slot still reserved")

        # A foreign claim on the SAME slot is untouched by R5's triple guard.
        other = self.make_user(tag="o19")
        s_other = self.make_slot(tutor, "2099-01-06", "10:00")
        b_other = self.make_session(other, tutor, PENDING, slot=s_other, client_token=f"tok-{uid()}")
        cas.claim_slot(s_other, other, b_other)
        s_other.refresh_from_db()

        counts = reconcile.reconcile_all()
        self.assertIn("R5", counts, "R5 must release the Cancelled pointer")
        s0.refresh_from_db()
        s_other.refresh_from_db()
        self.assertIsNone(s0.reserved_by)
        self.assertEqual(s_other.reserved_by, other, "foreign claim untouched")
        self.assert_invariants()

    def test_t20_repeated_reconciliation_is_idempotent(self):
        tutor = self.make_tutor(tag="t20")
        student = self.make_user(tag="s20")
        s0 = self.make_slot(tutor, "2099-01-07", "09:00")
        b = self.make_session(student, tutor, PENDING, slot=s0, client_token=f"tok-{uid()}")
        cas.claim_slot(s0, student, b)
        s0.refresh_from_db()
        cas.transition_session(b, PENDING, status=CANCELLED, cancelled_by="student")
        s0.refresh_from_db()

        first = reconcile.reconcile_all()
        self.assertIn("R5", first)
        second = reconcile.reconcile_all()
        self.assertEqual(second, {}, "second pass must be a no-op")
        third = reconcile.reconcile_all()
        self.assertEqual(third, {})
        self.assert_invariants()

    def test_t21_concurrent_cancel_and_reconcile_exactly_one_release(self):
        import threading

        tutor = self.make_tutor(tag="t21")
        student = self.make_user(tag="s21")
        s0 = self.make_slot(tutor, "2099-01-08", "09:00")
        b = self.make_session(student, tutor, PENDING, slot=s0, client_token=f"tok-{uid()}")
        claim_stamp = cas.claim_slot(s0, student, b)
        s0.refresh_from_db()
        self.assertEqual(claim_stamp, 1)

        barrier = threading.Barrier(2)
        results = []

        def cancel():
            cas.transition_session(b, PENDING, status=CANCELLED, cancelled_by="student")
            s0.refresh_from_db()
            if s0.reserved_by is None:
                # The sweep already released it (R5); a release against an
                # open slot must be a no-op, never a second release.
                n = cas.release_slot_claim(s0.pk, None, None, None)
                self.assertEqual(n, 0, "release on an open slot must be a no-op")
                results.append(("cancel", 0))
                barrier.wait()
                return
            n = cas.release_slot_claim(
                s0.pk, s0.reserved_by, s0.reserved_session, s0.reserved_at
            )
            barrier.wait()
            results.append(("cancel", 1 if n == 1 else 0))

        def sweep():
            barrier.wait()
            total = 0
            for _ in range(50):
                counts = reconcile.reconcile_all()
                total += counts.get("R5", 0)
                if total:
                    break
            results.append(("sweep", total))

        t1 = threading.Thread(target=cancel)
        t2 = threading.Thread(target=sweep)
        t1.start()
        t2.start()
        t1.join()
        t2.join()

        s0.refresh_from_db()
        self.assertIsNone(s0.reserved_by, "exactly-once release effect")
        b.refresh_from_db()
        self.assertEqual(b.status, CANCELLED)
        total_releases = sum(n for _name, n in results)
        self.assertEqual(
            total_releases, 1,
            f"exactly one release mutation may occur, got entries={results}",
        )
        self.assert_invariants()


class DeleteConfirmedSlotTest(TutorsBaseTest):
    """T28: deleting a Confirmed slot keeps the Session/history intact."""

    def test_delete_confirmed_slot_releases_booking_intact(self):
        tutor = self.make_tutor()
        student = self.make_user()
        s0 = self.make_slot(tutor, "2099-02-05", "09:00")
        b = self.make_session(student, tutor, PENDING, slot=s0, client_token=f"tok-{uid()}")
        cas.claim_slot(s0, student, b)
        s0.refresh_from_db()
        self.assertEqual(cas.transition_session(b, PENDING, status=CONFIRMED), 1)
        b.refresh_from_db()
        self.assertEqual(b.slot_id, s0.pk)
        self.assertEqual(b.date, "2099-02-05")

        # Delete via the view (owner, Confirmed claim -> allowed).
        c = APIClient()
        c.force_authenticate(user=tutor)
        r = c.delete(f"/api/availability/{s0.pk}/")
        self.assertEqual(r.status_code, 204)
        self.assertIsNone(AvailabilitySlot.objects.filter(pk=s0.pk).first())

        # Booking survives with its denormalized copies; slot ref cleared.
        b.refresh_from_db()
        self.assertEqual(b.status, CONFIRMED)
        self.assertEqual(b.date, "2099-02-05")
        self.assertIsNone(b.slot, "slot reference cleared on delete")
        self.assert_invariants()

    def test_delete_pending_claim_refused(self):
        tutor = self.make_tutor(tag="t28")
        student = self.make_user(tag="s28")
        s0 = self.make_slot(tutor, "2099-02-06", "09:00")
        b = self.make_session(student, tutor, PENDING, slot=s0, client_token=f"tok-{uid()}")
        cas.claim_slot(s0, student, b)
        c = APIClient()
        c.force_authenticate(user=tutor)
        r = c.delete(f"/api/availability/{s0.pk}/")
        self.assertEqual(r.status_code, 409)
        self.assertIsNotNone(AvailabilitySlot.objects.filter(pk=s0.pk).first())

    def test_r8_clears_dangling_confirmed_slot_reference(self):
        # A dmb ORM slot.delete() cascades SET_NULL (the reference side is
        # nulled automatically), so the dangling-reference state R8 recovers
        # can only be reached when the slot doc disappears out-of-band
        # (crash, raw DB surgery). Reproduce that with a raw delete.
        import re
        import pymongo

        from django.conf import settings
        from django.db import connection

        tutor = self.make_tutor(tag="t28r8")
        student = self.make_user(tag="s28r8")
        s0 = self.make_slot(tutor, "2099-02-07", "09:00")
        b = self.make_session(student, tutor, PENDING, slot=s0, client_token=f"tok-{uid()}")
        cas.claim_slot(s0, student, b)
        s0.refresh_from_db()
        self.assertEqual(cas.transition_session(b, PENDING, status=CONFIRMED), 1)

        uri = settings.DATABASES["default"]["HOST"]
        dbname = connection.settings_dict["NAME"]
        test_db = pymongo.MongoClient(uri, serverSelectionTimeoutMS=5000)[dbname]
        test_db["tutors_availabilityslot"].delete_one({"_id": s0.pk})  # no cascade
        b.refresh_from_db()
        self.assertEqual(b.slot_id, s0.pk, "dangling reference")

        counts = reconcile.reconcile_all()
        self.assertIn("R8", counts, "R8 must clear the dangling reference")
        b.refresh_from_db()
        self.assertIsNone(b.slot, "R8 cleared the dangling reference")
        self.assertEqual(b.status, CONFIRMED)
        test_db.client.close()
        self.assert_invariants()
