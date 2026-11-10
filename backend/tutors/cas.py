"""CAS (compare-and-swap) primitives for the booking lifecycle.

Every write in this module is a *conditional* update whose guard matches the
exact state the caller observed. Two properties follow:

1. **Safety under concurrency** — a losing actor sees ``0`` affected rows and
   can inspect the current state to decide (conflict / retry / undo).
2. **Idempotence** — replaying the same write is a no-op, so reconciliation
   and client retries converge without double effects.

I7 contract: every ``Session`` mutation that changes ``status`` or ``slot``
atomically writes ``updated_at`` in the *same* update. Django's
``auto_now`` is NOT used, because ``QuerySet.update()`` bypasses
``Model.save()`` and would leave the clock stale (see P0 design R5/6).
"""

from django.utils import timezone

from .models import CANCELLED, PENDING, SEALED, AvailabilitySlot, Session


def now():
    """Single clock helper (callers capture one value per operation)."""
    return timezone.now()


def _ms(ts):
    """Truncate a datetime to millisecond precision.

    MongoDB BSON dates are quantized to milliseconds, so an in-memory
    microsecond-precision ``timezone.now()`` never equals the stored value
    after a round-trip. Every CAS guard that compares ``reserved_at`` by
    exact equality must compare against the *truncated* value, or it will
    miss a claim it just wrote.
    """
    return ts.replace(microsecond=ts.microsecond // 1000 * 1000)


# --------------------------------------------------------------------------
# Session (booking) CAS operations
# --------------------------------------------------------------------------
def create_sealed_session(**fields):
    """Create a booking in the internal Sealed state (invisible everywhere).

    ``updated_at`` is written at creation so the transfer gates have a
    truthful mutation clock from the very first mutation.
    """
    fields.setdefault("status", SEALED)
    stamp = now()
    fields.setdefault("created_at", stamp)
    fields["updated_at"] = stamp
    return Session.objects.create(**fields)


def create_pending_custom_session(**fields):
    """Custom-time bookings have no shared slot resource; create Pending.

    Duplicates are prevented by the required ``client_token`` dedupe + the
    partial-unique index (I1-token), so the Sealed state is not needed.
    """
    fields["status"] = PENDING
    fields["custom"] = True
    fields["slot"] = None
    stamp = now()
    fields.setdefault("created_at", stamp)
    fields["updated_at"] = stamp
    return Session.objects.create(**fields)


def activate_session(b):
    """Sealed -> Pending. Returns affected rows (0 if lost the CAS or B was
    deleted by reconciliation)."""
    return Session.objects.filter(pk=b.pk, status=SEALED).update(
        status=PENDING,
        updated_at=now(),
    )


def transition_session(b, expected_status, **changes):
    """Status transition CAS. Returns affected rows.

    ``changes`` may include status, cancelled_by, date, time, slot,
    suggested_* — all applied atomically with the I7 clock write.
    """
    fields = dict(changes)
    fields["updated_at"] = now()
    return Session.objects.filter(pk=b.pk, status=expected_status).update(**fields)


def revert_session(b, expected_status, **changes):
    """Undo CAS (e.g. failed moved-confirm). Same guard semantics as
    ``transition_session`` but named for the undo path; I7 clock included."""
    return transition_session(b, expected_status, **changes)


def delete_sealed_session(b):
    """Delete a Sealed booking (stale-replace / conflict cleanup).

    Guarded on status so an activation that completed concurrently cannot be
    deleted. Returns affected rows.
    """
    return Session.objects.filter(pk=b.pk, status=SEALED).delete()


def release_token(b):
    """Explicit token release for terminal bookings.

    The partial-unique index already releases the token when ``status`` leaves
    the active set; this helper exists so callers have a single, testable
    place to reason about the effect (and future non-partial fallbacks).
    """
    return b


# --------------------------------------------------------------------------
# AvailabilitySlot CAS operations
# --------------------------------------------------------------------------
def claim_slot(slot, student, session, stamp=None):
    """CAS claim: ``reserved_by=None`` -> (student, session, now) in ONE write.

    Returns affected rows (0 = the slot was already claimed by someone else).
    ``stamp`` is accepted so tests can pin the claim timestamp. The stored
    ``reserved_at`` is truncated to milliseconds so it round-trips exactly
    through MongoDB (BSON dates are ms-quantized); exact-equality CAS guards
    below compare against the same truncated value.
    """
    stamp = _ms(stamp or now())
    return AvailabilitySlot.objects.filter(pk=slot.pk, reserved_by=None).update(
        reserved_by=student,
        reserved_session=session,
        reserved_at=stamp,
    )


def release_slot_claim(slot_pk, expected_reserved_by, expected_session, expected_reserved_at):
    """Triple-matched release. Matches the *exact* claim triple so a release
    can never disturb a newer claim (a new claim rewrites all three fields,
    changing the reserved_at value). Returns affected rows.

    A release observed against an already-open slot (``expected_reserved_by``
    is None) is a no-op returning 0: the triple must match a *live* claim,
    so a late release can never report success on released state."""
    if expected_reserved_by is None:
        return 0
    qs = _slot_qs(slot_pk, expected_reserved_by, expected_session, expected_reserved_at)
    return qs.update(reserved_by=None, reserved_session=None, reserved_at=None)


def slot_claim_holds(slot_pk, reserved_by, session, reserved_at):
    """Verify a claim is still held (post-transfer 3b check). Returns rows."""
    return _slot_qs(slot_pk, reserved_by, session, reserved_at).count()


def _slot_qs(slot_pk, reserved_by, session, reserved_at):
    qs = AvailabilitySlot.objects.filter(
        pk=slot_pk, reserved_by=reserved_by, reserved_session=session
    )
    if reserved_at is None:
        qs = qs.filter(reserved_at__isnull=True)
    else:
        # Truncate to ms so an in-memory microsecond clock matches the
        # millisecond-quantized value the claim actually stored.
        qs = qs.filter(reserved_at=_ms(reserved_at))
    return qs
