"""T18: randomized interleaving of the full operation set with invariant
checks after every step. This is the "concurrent timelines" property test:
no interleaving of create / claim / activate / release / reconcile /
cancel may violate I1-I5, and the system must always converge.

We use a fixed seed so the suite is deterministic, and we drive the real
service + reconcile layers (not mocks of them) so the CAS guards and the
recovery rules are exercised together.
"""

import random

from .. import cas
from .. import reconcile
from ..booking import BookingConflict, book_published_slot
from ..models import (
    CANCELLED,
    CONFIRMED,
    PENDING,
    SEALED,
    SUGGESTED,
    ACTIVE_STATUSES,
    AvailabilitySlot,
    Session,
)
from .base import TutorsBaseTest, uid


class InterleavingInvariantTest(TutorsBaseTest):
    SEED = 20261109
    STEPS = 24

    def setUp(self):
        super().setUp()
        self.tutor = self.make_tutor()
        self.students = [self.make_user(tag=f"st{i}") for i in range(4)]
        # A small publish grid the actors compete over.
        self.slots = [
            self.make_slot(self.tutor, f"2099-05-{d:02d}", f"{h:02d}:00")
            for d, h in [
                (1, 9), (1, 10), (2, 9), (2, 14),
                (3, 11), (3, 15), (4, 9), (4, 13),
            ]
        ]
        self.active_tokens = []  # (student, token) intents still open

    # ------------------------------------------------------------------
    def _op_book(self, rnd):
        student = rnd.choice(self.students)
        slot = rnd.choice(self.slots)
        token = f"tok-{uid()}"
        try:
            outcome, b, _ = book_published_slot(student, slot, "C", "", "", token)
            if outcome in ("created", "replay"):
                self.active_tokens.append((student, token, b.pk))
        except BookingConflict:
            pass  # expected under contention
        except Exception:
            raise

    def _op_activate_stale_sealed(self, rnd):
        # Simulate a retry that activates a Sealed booking we still own.
        # Only a Sealed whose slot claim is still held BY IT is a legitimate
        # activation target (the create-first retry path); a Sealed whose
        # claim was released is R3/R4 territory, not an activation.
        for b in list(Session.objects.filter(status=SEALED)):
            s = (
                AvailabilitySlot.objects.filter(pk=b.slot_id).first()
                if b.slot_id
                else None
            )
            if s is not None and s.reserved_session_id == b.pk and s.reserved_by is not None:
                cas.activate_session(b)
                return

    def _op_cancel(self, rnd):
        cand = list(
            Session.objects.filter(status__in=[PENDING, SUGGESTED])
        )
        if not cand:
            return
        b = rnd.choice(cand)
        b.refresh_from_db()
        if b.status == PENDING:
            cas.transition_session(b, PENDING, status=CANCELLED, cancelled_by="tutor")
        else:
            cas.transition_session(b, SUGGESTED, status=CANCELLED, cancelled_by="student")
        s = AvailabilitySlot.objects.filter(pk=b.slot_id).first() if b.slot_id else None
        if s:
            s.refresh_from_db()
            cas.release_slot_claim(s.pk, s.reserved_by, s.reserved_session, s.reserved_at)

    def _op_confirm(self, rnd):
        cand = list(Session.objects.filter(status=PENDING))
        if not cand:
            return
        b = rnd.choice(cand)
        cas.transition_session(b, PENDING, status=CONFIRMED)

    def _op_release_all_cancelled(self, rnd):
        for s in AvailabilitySlot.objects.filter(reserved_by__isnull=False):
            s.refresh_from_db()
            b = (
                Session.objects.filter(pk=s.reserved_session_id).first()
                if s.reserved_session
                else None
            )
            if b is not None and b.status == CANCELLED:
                cas.release_slot_claim(s.pk, s.reserved_by, s.reserved_session, s.reserved_at)

    def test_random_interleaving_preserves_invariants(self):
        rnd = random.Random(self.SEED)
        ops = [
            self._op_book,
            self._op_activate_stale_sealed,
            self._op_cancel,
            self._op_confirm,
            self._op_release_all_cancelled,
            lambda r: reconcile.reconcile_all(),
        ]
        for i in range(self.STEPS):
            op = rnd.choice(ops)
            op(rnd)
            # Invariants must hold after every single step.
            self.assert_invariants()
        # Final convergence: a second sweep is a no-op.
        self.assertEqual(reconcile.reconcile_all(), {}, "system must converge")

    def test_claim_never_lost_across_windows(self):
        # Focused property: across many random crashes, a slot's claim is
        # never observed to point at a missing or Cancelled booking after a
        # reconciled state.
        rnd = random.Random(self.SEED + 1)
        for _ in range(6):
            self._op_book(rnd)
            self._op_cancel(rnd)
            self._op_confirm(rnd)
            reconcile.reconcile_all()
            for s in AvailabilitySlot.objects.filter(reserved_by__isnull=False):
                s.refresh_from_db()
                if s.reserved_session:
                    b = Session.objects.filter(pk=s.reserved_session_id).first()
                    self.assertIsNotNone(b, "claim may not dangle after reconcile")
                    self.assertNotEqual(
                        b.status, CANCELLED,
                        "reconciled slot may not point at a Cancelled booking",
                    )
        self.assert_invariants()


class ConcurrentTimelinesTest(TutorsBaseTest):
    """Explicit interleavings from the design's actor table
    (A=booking, B=rival, C=reconciler, D=tutor delete, E=retry)."""

    def _mk(self, role="student"):
        return self.make_tutor() if role == "tutor" else self.make_user()

    def test_timeline_reconciler_vs_fresh_claim(self):
        # C (reconciler) must not touch a fresh claim (time-gated).
        tutor = self._mk("tutor")
        student = self._mk()
        slot = self.make_slot(tutor, "2099-06-01", "09:00")
        b = self.make_session(student, tutor, SEALED, slot=slot)
        cas.claim_slot(slot, student, b)
        slot.refresh_from_db()
        self.assertEqual(reconcile.reconcile_all(), {}, "fresh claim survives reconcile")
        self.assertEqual(slot.reserved_by, student)

    def test_timeline_rival_release_then_retry(self):
        # Student claims a slot, then cancels + releases it. A retry under
        # the SAME intent re-books cleanly — never a double hold.
        tutor = self._mk("tutor")
        student = self._mk()
        slot = self.make_slot(tutor, "2099-06-02", "09:00")
        token = f"tok-{uid()}"
        outcome, b, _ = book_published_slot(student, slot, "C", "", "", token)
        self.assertIn(outcome, ("created", "replay"))
        slot.refresh_from_db()
        self.assertEqual(slot.reserved_by, student)
        self.assertEqual(Session.objects.filter(slot=slot, status__in=ACTIVE_STATUSES).count(), 1)

        # Student cancels the booking and the slot claim is released.
        cas.transition_session(b, PENDING, status=CANCELLED, cancelled_by="student")
        slot.refresh_from_db()
        cas.release_slot_claim(slot.pk, slot.reserved_by, slot.reserved_session, slot.reserved_at)
        slot.refresh_from_db()
        self.assertIsNone(slot.reserved_by)

        # Retry with the same intent: a fresh booking succeeds (token
        # re-used after the previous one went terminal).
        outcome2, b2, _ = book_published_slot(student, slot, "C", "", "", token)
        self.assertIn(outcome2, ("created", "replay"))
        slot.refresh_from_db()
        self.assertEqual(slot.reserved_by, student)
        self.assertEqual(
            Session.objects.filter(slot=slot, status__in=ACTIVE_STATUSES).count(),
            1,
            "exactly one active booking per slot",
        )

    def test_timeline_tutor_delete_blocked_by_live_claim(self):
        from rest_framework.test import APIClient

        tutor = self._mk("tutor")
        student = self._mk()
        slot = self.make_slot(tutor, "2099-06-03", "09:00")
        b = self.make_session(student, tutor, PENDING, slot=slot)
        cas.claim_slot(slot, student, b)
        c = APIClient()
        c.force_authenticate(user=tutor)
        r = c.delete(f"/api/availability/{slot.pk}/")
        self.assertEqual(r.status_code, 409, "delete refused while a live claim holds the slot")
        self.assertIsNotNone(AvailabilitySlot.objects.filter(pk=slot.pk).first())
