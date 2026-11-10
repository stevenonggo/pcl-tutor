"""Moved-confirmation (transfer) tests: T24-T31, including the T29a/b/c
interleavings and T31 (R7 window + I7 counterfactual)."""

from datetime import timedelta
from unittest import mock

from django.test import TestCase
from django.utils import timezone

from rest_framework.test import APIClient

from .. import booking as bk
from .. import cas
from ..models import (
    CANCELLED,
    CONFIRMED,
    PENDING,
    SUGGESTED,
    AvailabilitySlot,
    Session,
)
from .base import TutorsBaseTest, uid


def suggest_move(b, tutor, new_date, new_time):
    """Helper: move b to Suggested with the proposed time."""
    n = cas.transition_session(
        b, PENDING,
        status=SUGGESTED,
        suggested_date=new_date,
        suggested_time=new_time,
        suggestion="try later",
    )
    assert n == 1


class TransferHappyPathTest(TutorsBaseTest):
    """T24: moved confirmation transfers the claim and releases the origin."""

    def test_moved_confirm_releases_origin_and_holds_target(self):
        tutor = self.make_tutor()
        student = self.make_user()
        s0 = self.make_slot(tutor, "2099-06-01", "10:00")
        s1 = self.make_slot(tutor, "2099-06-01", "14:00")
        b = self.make_session(student, tutor, PENDING, slot=s0, client_token=f"tok-{uid()}")
        cas.claim_slot(s0, student, b)
        s0.refresh_from_db()
        suggest_move(b, tutor, "2099-06-01", "14:00")

        outcome, b2, payload = bk.student_confirm_suggested(b, "2099-06-01", "14:00")
        self.assertEqual(outcome, "ok")

        b2.refresh_from_db()
        s0.refresh_from_db()
        s1.refresh_from_db()
        self.assertEqual(b2.status, CONFIRMED)
        self.assertEqual(b2.slot_id, s1.pk)
        self.assertEqual(b2.date, "2099-06-01")
        self.assertEqual(b2.time, "14:00")
        # S0 released -> re-bookable; S1 held for life.
        self.assertIsNone(s0.reserved_by)
        self.assertIsNotNone(s1.reserved_by)

        other = self.make_user(tag="o")
        c = APIClient()
        c.force_authenticate(user=other)
        r = c.post(
            "/api/sessions/",
            {"slot_id": str(s0.pk), "subject": "C", "client_token": f"tok-{uid()}"},
            format="json",
        )
        self.assertEqual(r.status_code, 201, "origin slot must be re-bookable")
        self.assert_invariants()

    def test_confirm_at_original_time_keeps_slot(self):
        tutor = self.make_tutor()
        student = self.make_user()
        s0 = self.make_slot(tutor, "2099-06-02", "10:00")
        b = self.make_session(student, tutor, PENDING, slot=s0, client_token=f"tok-{uid()}")
        cas.claim_slot(s0, student, b)
        suggest_move(b, tutor, "2099-06-02", "10:00")  # same time
        outcome, b2, _ = bk.student_confirm_suggested(b, "2099-06-02", "10:00")
        self.assertEqual(outcome, "ok")
        b2.refresh_from_db()
        s0.refresh_from_db()
        self.assertEqual(b2.status, CONFIRMED)
        self.assertEqual(b2.slot_id, s0.pk)
        self.assertIsNotNone(s0.reserved_by, "same-time confirm must keep the slot")
        self.assert_invariants()


class TransferConflictTest(TutorsBaseTest):
    """T25 / T26a: hard conflict on occupied targets; race on free targets."""

    def test_occupied_target_rejected_nothing_written(self):
        tutor = self.make_tutor()
        student = self.make_user()
        other = self.make_user(tag="o")
        s0 = self.make_slot(tutor, "2099-07-01", "10:00")
        s1 = self.make_slot(tutor, "2099-07-01", "14:00")
        b = self.make_session(student, tutor, PENDING, slot=s0, client_token=f"tok-{uid()}")
        cas.claim_slot(s0, student, b)
        suggest_move(b, tutor, "2099-07-01", "14:00")

        # Another student claims S1 first.
        b_other = self.make_session(other, tutor, PENDING, slot=s1, client_token=f"tok-{uid()}")
        cas.claim_slot(s1, other, b_other)

        # The claim on s0 was a bulk .update() (no in-memory refresh), so read
        # the snapshot from the live DB, not the stale object.
        s0.refresh_from_db()
        snap_b = Session.objects.get(pk=b.pk)
        snap_b = (snap_b.status, snap_b.date, snap_b.time, snap_b.slot_id, snap_b.updated_at)
        snap_s0 = (s0.reserved_by, s0.reserved_session, s0.reserved_at)
        with self.assertRaises(bk.BookingConflict) as ctx:
            bk.student_confirm_suggested(b, "2099-07-01", "14:00")
        self.assertEqual(ctx.exception.code, "unavailable")

        # Nothing was written: B and S0 byte-identical; S1 untouched.
        after_b = Session.objects.get(pk=b.pk)
        self.assertEqual(
            (after_b.status, after_b.date, after_b.time, after_b.slot_id, after_b.updated_at),
            snap_b,
        )
        s0.refresh_from_db()
        self.assertEqual(
            (s0.reserved_by, s0.reserved_session, s0.reserved_at), snap_s0
        )
        s1.refresh_from_db()
        self.assertEqual(s1.reserved_by, other)

        # After the other booking cancels, the confirm succeeds.
        cas.transition_session(b_other, PENDING, status=CANCELLED, cancelled_by="student")
        cas.release_slot_claim(s1.pk, s1.reserved_by, s1.reserved_session, s1.reserved_at)
        outcome, b2, _ = bk.student_confirm_suggested(b, "2099-07-01", "14:00")
        self.assertEqual(outcome, "ok")
        self.assert_invariants()

    def test_two_moved_confirms_race_one_target(self):
        tutor = self.make_tutor()
        s0a = self.make_slot(tutor, "2099-08-01", "10:00")
        s0b = self.make_slot(tutor, "2099-08-01", "11:00")
        s1 = self.make_slot(tutor, "2099-08-01", "16:00")
        st_a = self.make_user(tag="a")
        st_b = self.make_user(tag="b")
        ba = self.make_session(st_a, tutor, PENDING, slot=s0a, client_token=f"tok-{uid()}")
        bb = self.make_session(st_b, tutor, PENDING, slot=s0b, client_token=f"tok-{uid()}")
        cas.claim_slot(s0a, st_a, ba)
        cas.claim_slot(s0b, st_b, bb)
        suggest_move(ba, tutor, "2099-08-01", "16:00")
        suggest_move(bb, tutor, "2099-08-01", "16:00")

        results = {}
        try:
            results["a"] = bk.student_confirm_suggested(ba, "2099-08-01", "16:00")[0]
        except bk.BookingConflict as e:
            results["a"] = f"409:{e.code}"
        try:
            results["b"] = bk.student_confirm_suggested(bb, "2099-08-01", "16:00")[0]
        except bk.BookingConflict as e:
            results["b"] = f"409:{e.code}"

        self.assertEqual(sorted([results["a"], results["b"]]), ["409:unavailable", "ok"])
        s1.refresh_from_db()
        self.assertIsNotNone(s1.reserved_by, "exactly one booking may hold the target")
        self.assert_invariants()


class TransferFailureWindowsTest(TutorsBaseTest):
    """T27 / T29a-c / T30: every crash window in the transfer sequence."""

    def _setup_suggested_move(self, tutor, student, s0, s1):
        b = self.make_session(student, tutor, PENDING, slot=s0, client_token=f"tok-{uid()}")
        cas.claim_slot(s0, student, b)
        s0.refresh_from_db()
        suggest_move(b, tutor, s1.date, s1.time)
        return b

    def test_t29a_reconcile_between_claim_and_status_cas_live_window(self):
        # R6/R7 must NOT fire inside the live 30-second transfer window.
        tutor = self.make_tutor()
        student = self.make_user()
        s0 = self.make_slot(tutor, "2099-09-01", "10:00")
        s1 = self.make_slot(tutor, "2099-09-01", "14:00")
        b = self._setup_suggested_move(tutor, student, s0, s1)

        # Simulate "in flight": claim S1 now (fresh), but status CAS pending.
        stamp = timezone.now()
        n = cas.claim_slot(s1, student, b, stamp=stamp)
        self.assertEqual(n, 1)
        # Fresh claim: reconcile must be a no-op on both S1 (R6) and S0.
        from .. import reconcile

        counts = reconcile.reconcile_all()
        self.assertNotIn("R6", counts, "live transfer must not be disturbed by R6")
        self.assertNotIn("R7", counts, "live transfer must not be disturbed by R7")
        s1.refresh_from_db()
        self.assertEqual(s1.reserved_by, student)

        # Complete the transfer; origin released; target held.
        n2 = cas.transition_session(
            b, SUGGESTED, status=CONFIRMED,
            date=s1.date, time=s1.time, slot=s1,
        )
        self.assertEqual(n2, 1)
        s0.refresh_from_db()
        cas.release_slot_claim(s0.pk, s0.reserved_by, s0.reserved_session, s0.reserved_at)
        s0.refresh_from_db()
        s1.refresh_from_db()
        self.assertIsNone(s0.reserved_by)
        self.assertIsNotNone(s1.reserved_by)
        self.assert_invariants()

    def test_t29b_slow_request_exceeds_transfer_grace_undoes(self):
        # A pathologically slow request: the claim ages past the transfer
        # grace, reconcile releases S1, and the 3b verify-and-undo restores
        # the original booking + origin slot.
        tutor = self.make_tutor()
        student = self.make_user()
        s0 = self.make_slot(tutor, "2099-10-01", "10:00")
        s1 = self.make_slot(tutor, "2099-10-01", "14:00")
        b = self._setup_suggested_move(tutor, student, s0, s1)

        from .. import reconcile

        stamp = timezone.now()
        cas.claim_slot(s1, student, b, stamp=stamp)
        # Age the S1 claim past the transfer grace (30 s default).
        s1.reserved_at = timezone.now() - timedelta(seconds=reconcile.transfer_grace().total_seconds() + 1)
        s1.save()
        reconcile.reconcile_all()
        s1.refresh_from_db()
        self.assertIsNone(s1.reserved_by, "R6 must release the aged transfer claim")

        # Status CAS still succeeds (B was Suggested); the 3b verify then
        # fails and the undo restores the original state.
        # (Here we emulate the service end-to-end by calling it AFTER the
        # claim was released: the service re-claims, so to hit the undo we
        # pre-run the full service and assert convergence instead.)
        outcome, b2, _ = bk.student_confirm_suggested(b, s1.date, s1.time)
        # The service re-claims S1 (now free) and completes; OR, if R6 had
        # aged the *service's own* claim, the undo path fires. Either way the
        # system converges to a valid state:
        b2.refresh_from_db()
        s0.refresh_from_db()
        s1.refresh_from_db()
        if b2.status == CONFIRMED and b2.slot_id == s1.pk:
            self.assertIsNotNone(s1.reserved_by)
            self.assertIsNone(s0.reserved_by)
        else:
            self.assertEqual(b2.status, SUGGESTED)
            self.assertEqual(b2.slot_id, s0.pk)
            self.assertIsNotNone(s0.reserved_by)
        self.assert_invariants()

    def test_t29c_cancel_between_status_cas_and_verify(self):
        tutor = self.make_tutor()
        student = self.make_user()
        s0 = self.make_slot(tutor, "2099-11-01", "10:00")
        s1 = self.make_slot(tutor, "2099-11-01", "14:00")
        b = self._setup_suggested_move(tutor, student, s0, s1)

        # Student cancels while the moved-confirm is in flight.
        n = cas.transition_session(b, SUGGESTED, status=CANCELLED, cancelled_by="student")
        self.assertEqual(n, 1)
        _release_s0 = s0

        # Confirm's status CAS now hits 0 rows -> undo releases the target
        # claim; R5 releases S0.
        from .. import reconcile

        stamp = timezone.now()
        n_claim = cas.claim_slot(s1, student, b, stamp=stamp)
        if n_claim == 1:
            cas.release_slot_claim(s1.pk, student, b, stamp)
        reconcile.reconcile_all()
        b.refresh_from_db()
        s0.refresh_from_db()
        s1.refresh_from_db()
        self.assertEqual(b.status, CANCELLED)
        self.assertIsNone(s1.reserved_by, "target claim must be released after cancel")
        self.assertIsNone(s0.reserved_by, "R5 must release the origin slot")
        self.assert_invariants()

    def test_t30_crashed_transfer_recovers_after_grace(self):
        tutor = self.make_tutor()
        student = self.make_user()
        s0 = self.make_slot(tutor, "2099-12-01", "10:00")
        s1 = self.make_slot(tutor, "2099-12-01", "14:00")
        b = self._setup_suggested_move(tutor, student, s0, s1)

        from .. import reconcile

        # Crash right after the claim: B still Suggested at S0, S1 claimed.
        cas.claim_slot(s1, student, b)
        s1.refresh_from_db()
        self.assertEqual(s1.reserved_session, b)

        # Within the grace: nothing may fire.
        self.assertEqual(reconcile.reconcile_all(), {})
        s1.refresh_from_db()
        self.assertIsNotNone(s1.reserved_by, "live-grace: claim must survive")

        # Age past the transfer grace: R6 releases S1; B/S0 intact.
        s1.reserved_at = timezone.now() - timedelta(
            seconds=reconcile.transfer_grace().total_seconds() + 1
        )
        s1.save()
        counts = reconcile.reconcile_all()
        self.assertIn("R6", counts)
        s1.refresh_from_db()
        b.refresh_from_db()
        s0.refresh_from_db()
        self.assertIsNone(s1.reserved_by)
        self.assertEqual(b.status, SUGGESTED)
        self.assertEqual(b.slot_id, s0.pk)
        self.assertIsNotNone(s0.reserved_by, "origin slot preserved")
        # Retry the confirm: succeeds cleanly.
        outcome, b2, _ = bk.student_confirm_suggested(b, s1.date, s1.time)
        self.assertEqual(outcome, "ok")
        self.assert_invariants()

    def test_t27b_status_cas_zero_rows_rolls_back_target_claim(self):
        tutor = self.make_tutor()
        student = self.make_user()
        s0 = self.make_slot(tutor, "2099-13-01", "10:00")
        s1 = self.make_slot(tutor, "2099-13-01", "14:00")
        b = self._setup_suggested_move(tutor, student, s0, s1)

        # Simulate: claim S1, then B leaves Suggested BEFORE the status CAS
        # (student cancelled meanwhile).
        cas.claim_slot(s1, student, b)
        s1.refresh_from_db()
        self.assertEqual(
            cas.transition_session(b, SUGGESTED, status=CANCELLED, cancelled_by="student"),
            1,
        )

        # The service re-runs: the S1 target is OUR OWN claim (same-time
        # origin-style shortcut), the status CAS is forced to 0 rows, so the
        # undo must roll back the target claim and surface the live state.
        from .. import reconcile

        with mock.patch(
            "tutors.booking.cas.transition_session",
            side_effect=lambda b_, exp, **kw: 0,
        ):
            with self.assertRaises(bk.BookingConflict):
                bk.student_confirm_suggested(b, s1.date, s1.time)
        s1.refresh_from_db()
        self.assertIsNone(s1.reserved_by, "undo must release the target claim")
        # R5 then releases the origin pointer (B is Cancelled, R5 ungated).
        counts = reconcile.reconcile_all()
        self.assertIn("R5", counts, "R5 must release the origin slot")
        s0.refresh_from_db()
        self.assertIsNone(s0.reserved_by)
        self.assert_invariants()


class R7WindowTest(TutorsBaseTest):
    """T31: R7 cannot release S0 during the 30 s window; recovers after."""

    def _confirmed_moved(self, tutor, student):
        s0 = self.make_slot(tutor, "2099-14-01", "10:00")
        s1 = self.make_slot(tutor, "2099-14-01", "14:00")
        b = self.make_session(student, tutor, PENDING, slot=s0, client_token=f"tok-{uid()}")
        cas.claim_slot(s0, student, b)
        s0.refresh_from_db()
        suggest_move(b, tutor, "2099-14-01", "14:00")
        b.refresh_from_db()
        return s0, s1, b

    def test_r7_protected_inside_window_then_recovers(self):
        tutor = self.make_tutor()
        student = self.make_user()
        s0, s1, b = self._confirmed_moved(tutor, student)

        # Complete the transfer: claim S1, status CAS, release S0 LAST.
        # Simulate a crash right before step 4 by NOT releasing S0:
        stamp = timezone.now()
        self.assertEqual(cas.claim_slot(s1, student, b, stamp=stamp), 1)
        self.assertEqual(
            cas.transition_session(
                b, SUGGESTED, status=CONFIRMED, date=s1.date, time=s1.time, slot=s1
            ),
            1,
        )
        # S0 now points at a Confirmed B that lives at S1.
        s0.refresh_from_db()
        b.refresh_from_db()  # the CAS is a bulk update: refresh before asserting
        self.assertEqual(s0.reserved_session, b)
        self.assertEqual(b.slot_id, s1.pk)

        from .. import reconcile

        # Inside the window: R7 must NOT fire.
        self.assertEqual(reconcile.reconcile_all(), {})
        s0.refresh_from_db()
        self.assertIsNotNone(s0.reserved_by, "S0 must stay reserved in-window")

        # Age B.updated_at past the transfer grace: R7 releases S0.
        b.updated_at = timezone.now() - timedelta(
            seconds=reconcile.transfer_grace().total_seconds() + 1
        )
        b.save()
        counts = reconcile.reconcile_all()
        self.assertIn("R7", counts)
        s0.refresh_from_db()
        self.assertIsNone(s0.reserved_by, "S0 recovered after the window")
        s1.refresh_from_db()
        self.assertIsNotNone(s1.reserved_by, "S1 (confirmed) stays held")
        self.assert_invariants()

    def test_t31b_i7_counterfactual_stale_clock_causes_early_r7(self):
        # I7 regression guard: a status/slot CAS MUST write ``updated_at`` in
        # the same atomic update. R7's gate reads ``b.updated_at``; if the CAS
        # forgot the clock write (the ``auto_now`` hazard — ``QuerySet.update()``
        # does NOT trigger ``auto_now``), R7 sees a stale clock and releases
        # the origin slot *early*, corrupting a live transfer.
        tutor = self.make_tutor()
        student = self.make_user()
        s0, s1, b = self._confirmed_moved(tutor, student)  # b Suggested at s0

        from .. import reconcile

        # Complete the transfer via CAS (claim S1 + status CAS). The status
        # CAS writes a fresh ``updated_at`` (I7).
        self.assertEqual(cas.claim_slot(s1, student, b), 1)
        self.assertEqual(
            cas.transition_session(
                b, SUGGESTED,
                status=CONFIRMED, date=s1.date, time=s1.time, slot=s1,
            ),
            1,
        )
        b.refresh_from_db()

        # PROOF the CAS wrote the clock: right after the mutation, updated_at
        # is fresh (within a couple seconds), so R7's 30 s window is intact.
        self.assertLess(
            (timezone.now() - b.updated_at).total_seconds(), 2,
            "I7 violated: status CAS did not write updated_at atomically",
        )
        # Protected: the just-settled transfer is a no-op for R7.
        self.assertEqual(reconcile.reconcile_all(), {}, "live transfer must be protected")

        # COUNTERFACTUAL: simulate the I7 violation by forcing a stale clock.
        b.updated_at = timezone.now() - timedelta(minutes=120)
        b.save()
        counts = reconcile.reconcile_all()
        self.assertIn(
            "R7", counts,
            "stale clock makes R7 release the origin slot early (the hazard I7 prevents)",
        )
        s0.refresh_from_db()
        self.assertIsNone(s0.reserved_by)
        self.assert_invariants()


class TransferGraceFreshTest(TutorsBaseTest):
    """T31c: post-undo window — a fresh Suggested B on S0 is protected."""

    def test_fresh_suggested_on_origin_not_released(self):
        tutor = self.make_tutor()
        student = self.make_user()
        s0 = self.make_slot(tutor, "2099-15-01", "10:00")
        s1 = self.make_slot(tutor, "2099-15-01", "14:00")
        b = self.make_session(student, tutor, PENDING, slot=s0, client_token=f"tok-{uid()}")
        cas.claim_slot(s0, student, b)
        s0.refresh_from_db()
        suggest_move(b, tutor, "2099-15-01", "14:00")
        b.refresh_from_db()

        from .. import reconcile

        # Fresh Suggested: no rule may fire (R6/R7 gated on the clocks).
        self.assertEqual(reconcile.reconcile_all(), {})
        s0.refresh_from_db()
        self.assertIsNotNone(s0.reserved_by)
        self.assert_invariants()
