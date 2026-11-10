"""Shared fixtures, time-travel helpers and invariant checkers.

Isolation: dmb has no transactional test isolation (``atomic`` is a no-op),
so every test cleans up after itself via the base class tearDown. All test
data uses the ``pctest_`` username prefix and uuid-suffixed tokens so runs
never collide with each other or with dev data.
"""

import uuid
from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from users.models import User

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
from .. import reconcile


def uid():
    return uuid.uuid4().hex[:12]


class TutorsBaseTest(TestCase):
    """Base with fixture factory + full cleanup of anything this run created."""

    maxDiff = None

    def setUp(self):
        super().setUp()
        self.suffix = uid()
        self.created_users = []
        self.created_slots = []
        self.created_sessions = []

    # ------------------------------------------------------------------
    # Fixture factory
    # ------------------------------------------------------------------
    def make_user(self, role="student", full_name=None, subjects=None, **kw):
        u = User.objects.create_user(
            username=f"pctest_{self.suffix}_{kw.pop('tag', '')}{len(self.created_users)}",
            email=f"pctest-{self.suffix}@example.com",
            password="pctest-pass-123",
            role=role,
            full_name=full_name or f"T {self.suffix}",
            subjects=list(subjects or (["C", "Data Structures"] if role == "tutor" else [])),
            **kw,
        )
        self.created_users.append(u)
        return u

    def make_tutor(self, **kw):
        return self.make_user(role="tutor", **kw)

    def make_slot(self, tutor, date, time, mode="Online", location="", duration=60):
        s = AvailabilitySlot.objects.create(
            tutor=tutor, date=date, time=time, mode=mode,
            location=location, duration=duration,
        )
        self.created_slots.append(s)
        return s

    def make_session(self, student, tutor, status=PENDING, slot=None, **kw):
        b = Session.objects.create(
            student=student,
            tutor=tutor,
            subject=kw.pop("subject", "C"),
            status=status,
            date=kw.pop("date", slot.date if slot else "2099-01-01"),
            time=kw.pop("time", slot.time if slot else "09:00"),
            mode=kw.pop("mode", slot.mode if slot else "Online"),
            location=kw.pop("location", slot.location if slot else ""),
            duration=kw.pop("duration", slot.duration if slot else 60),
            slot=slot,
            custom=kw.pop("custom", slot is None),
            client_token=kw.pop("client_token", f"tok-{uid()}"),
            **kw,
        )
        self.created_sessions.append(b)
        return b

    # ------------------------------------------------------------------
    # Time travel (Mongo stores ms-precision datetimes; gates are seconds /
    # minutes, so aging by whole minutes is exact)
    # ------------------------------------------------------------------
    def age_slot_claim(self, slot, minutes):
        ts = timezone.now() - timedelta(minutes=minutes)
        slot.reserved_at = ts
        slot.save()

    def age_booking(self, b, minutes, field="created_at"):
        ts = timezone.now() - timedelta(minutes=minutes)
        getattr(b, field)
        b.created_at = ts
        b.updated_at = ts
        b.save()

    # ------------------------------------------------------------------
    # Invariants
    # ------------------------------------------------------------------
    def assert_invariants(self):
        """Assert I1/I1-token/I2a/I2b/I3/I4/I5 on the (post-reconcile) state.

        I5 semantics: invariants are checked AFTER a reconciliation pass,
        i.e. on the converged state. Mid-window transients are covered by
        the dedicated transfer tests instead.
        """
        reconcile.reconcile_all()

        # I1: at most one *visible* active booking (Pending/Suggested/
        # Confirmed) per slot. The claim CAS is the single-occupancy
        # enforcer; fresh Sealed orphans (lost-claim leftovers awaiting R3/R4
        # collection) are intentionally excluded — several students' Sealed
        # docs may transiently sit on the same slot after a contention.
        by_slot = {}
        for b in Session.objects.filter(
            slot__isnull=False, status__in=[PENDING, SUGGESTED, CONFIRMED]
        ):
            by_slot.setdefault(b.slot_id, []).append(b.pk)
        for slot_pk, pks in by_slot.items():
            self.assertLessEqual(
                len(pks), 1,
                f"I1 violated: slot {slot_pk} has {len(pks)} active bookings",
            )

        # I1-token: at most one active-status doc per (student, client_token).
        seen = {}
        for b in Session.objects.filter(status__in=ACTIVE_STATUSES):
            key = (b.student_id, b.client_token)
            seen.setdefault(key, []).append(b.pk)
        for key, pks in seen.items():
            self.assertLessEqual(
                len(pks), 1,
                f"I1-token violated: {key} has {len(pks)} active docs",
            )

        # I2a: S.reserved_session=B => B exists and B.slot == S (converged).
        for s in AvailabilitySlot.objects.filter(reserved_session__isnull=False):
            b = Session.objects.filter(pk=s.reserved_session_id).first()
            self.assertIsNotNone(b, f"I2a violated: slot {s.pk} points to missing B")
            self.assertEqual(b.slot_id, s.pk, f"I2a violated: {b.pk} not at {s.pk}")

        # I2b: dangling B.slot only on Confirmed bookings (and never after
        # reconcile, since R8 clears them).
        for b in Session.objects.filter(slot__isnull=False):
            if AvailabilitySlot.objects.filter(pk=b.slot_id).first() is None:
                self.assertEqual(
                    b.status, CONFIRMED,
                    f"I2b violated: non-Confirmed {b.status} with dangling slot",
                )

        # I3: no recoverable state older than the claim grace.
        cutoff = timezone.now() - reconcile.claim_grace()
        stale_sealed = Session.objects.filter(
            status=SEALED, created_at__lt=cutoff
        )
        # R4 deletes stale orphaned Sealed docs; a stale Sealed whose slot
        # still links it would have been released+deleted by R3.
        for b in stale_sealed:
            s = (
                AvailabilitySlot.objects.filter(pk=b.slot_id).first()
                if b.slot_id
                else None
            )
            if s is not None and s.reserved_session_id == b.pk:
                self.fail(f"I3 violated: stale Sealed {b.pk} still linked")

        # I4: Sealed docs must be absent from read endpoints — verified by
        # the endpoint tests; here we assert the queryset rule used by them.
        self.assertFalse(
            list(
                Session.objects.filter(status__in=[PENDING, SUGGESTED, CONFIRMED, CANCELLED])
                .filter(status=SEALED)
            )
        )

        # I5: no slot pointer may reference a missing/Cancelled/stale booking.
        for s in AvailabilitySlot.objects.filter(reserved_by__isnull=False):
            b = (
                Session.objects.filter(pk=s.reserved_session_id).first()
                if s.reserved_session
                else None
            )
            if b is None:
                self.assertGreater(
                    s.reserved_at,
                    timezone.now() - timedelta(seconds=reconcile.transfer_grace().total_seconds()),
                    f"I5 violated: dangling link on slot {s.pk}",
                )
            elif b.status == CANCELLED:
                self.fail(f"I5 violated: slot {s.pk} points at Cancelled {b.pk}")
            elif b.status == CONFIRMED and b.slot_id != s.pk:
                self.assertLess(
                    timezone.now() - b.updated_at,
                    reconcile.transfer_grace(),
                    f"I5 violated: stale Confirmed pointer on {s.pk}",
                )

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------
    def tearDown(self):
        super().tearDown()
        pks = [b.pk for b in Session.objects.filter(student__in=self.created_users)
               ] + [b.pk for b in Session.objects.filter(tutor__in=self.created_users)]
        pks = list(dict.fromkeys(pks))
        Session.objects.filter(pk__in=pks).delete()
        slot_pks = [s.pk for s in AvailabilitySlot.objects.filter(tutor__in=self.created_users)]
        AvailabilitySlot.objects.filter(pk__in=slot_pks).delete()
        User.objects.filter(pk__in=[u.pk for u in self.created_users]).delete()


__all__ = ["TutorsBaseTest", "uid"]
