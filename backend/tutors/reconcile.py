"""Reconciliation rules R1-R8: crash recovery for claims and bookings.

Two time gates (never release something live):

* **Claim grace** (default 30 min): rules that recover *orphaned* state
  (crashed requests, missing/stale bookings) only touch state older than the
  grace window, keyed on the relevant clock (``reserved_at`` or
  ``created_at``).
* **Transfer grace** (default 30 s): rules for in-flight moved-confirmation
  transfers are keyed on the transfer's own clocks — the target slot's
  ``reserved_at`` (R6) and the booking's ``updated_at`` (R7) — so a live
  transfer (a few ms old) is never disturbed; crashed transfers recover
  quickly.

Terminal-state rules (R5, R8) are **ungated**: a Cancelled booking or a
deleted slot can never come back, so releasing/clearing is always safe.

Every release is a triple-matched CAS (``reserved_by``,
``reserved_session``, ``reserved_at``), so it can never release another
booking's claim; repeated runs are no-ops (idempotent).
"""

from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from . import cas
from .models import (
    CANCELLED,
    CONFIRMED,
    PENDING,
    SEALED,
    SUGGESTED,
    AvailabilitySlot,
    Session,
)


def claim_grace():
    minutes = getattr(settings, "SLOT_CLAIM_GRACE_MINUTES", 30)
    return timedelta(minutes=minutes)


def transfer_grace():
    seconds = getattr(settings, "SLOT_TRANSFER_GRACE_SECONDS", 30)
    return timedelta(seconds=seconds)


def _release(slot, expected_at):
    """Release a slot claim, matching the exact triple the caller observed.
    Re-reading ``slot`` inside the CAS guard is impossible (the guard *is*
    the observed state); a 0-row result means a newer claim owns the slot.
    """
    return cas.release_slot_claim(
        slot.pk, slot.reserved_by, slot.reserved_session, expected_at
    )


# --------------------------------------------------------------------------
# Per-slot rules (used by read-time repair on touched documents)
# --------------------------------------------------------------------------
def reconcile_slot(slot, now_ts=None):
    """Apply every rule that can act on this slot. Returns a list of rule ids
    that performed a mutation.

    Rule priority (first match wins; all releases are triple-CAS and
    idempotent):

    * R5  (ungated)      slot points at a Cancelled booking            -> release
    * R6  (30 s gate)    slot claimed by a transfer whose booking is
                         still Sealed/Pending/Suggested elsewhere      -> release
    * R7  (30 s gate)    slot left pointing at a Confirmed booking
                         that now lives elsewhere                      -> release
    * R1  (30 min gate)  claimed but never linked (no reserved_session)-> release
    * R2  (30 min gate)  reserved_session points at a missing document -> release
    * R3  (30 min gate)  booking stuck in Sealed (activation died)    -> release + collect B
    """
    now_ts = now_ts or timezone.now()
    actions = []

    b = None
    if slot.reserved_by is not None and slot.reserved_session is not None:
        b = Session.objects.filter(pk=slot.reserved_session_id).first()

    # R5 (ungated): booking is terminal; the claim is a stale pointer.
    if b is not None and b.status == CANCELLED:
        if _release(slot, slot.reserved_at):
            actions.append("R5")
        return actions

    # R6 (transfer-gated on the claim's own clock): crashed transfer left
    # the target slot claimed for a booking that still sits at its origin.
    if (
        b is not None
        and b.slot_id != slot.pk
        and b.status in (PENDING, SUGGESTED, SEALED)
        and slot.reserved_at is not None
        and (now_ts - slot.reserved_at) > transfer_grace()
    ):
        if _release(slot, slot.reserved_at):
            actions.append("R6")
        return actions

    # R7 (transfer-gated on the booking's mutation clock): settled transfer
    # left a stale source pointer.
    if (
        b is not None
        and b.slot_id != slot.pk
        and b.status == CONFIRMED
        and b.updated_at is not None
        and (now_ts - b.updated_at) > transfer_grace()
    ):
        if _release(slot, slot.reserved_at):
            actions.append("R7")
        return actions

    # R1 (claim-gated): claimed but never linked to any booking.
    if (
        slot.reserved_by is not None
        and slot.reserved_session is None
        and slot.reserved_at is not None
        and (now_ts - slot.reserved_at) > claim_grace()
    ):
        if _release(slot, slot.reserved_at):
            actions.append("R1")
        return actions

    # R2 (claim-gated): the linked booking document is missing.
    if (
        slot.reserved_by is not None
        and slot.reserved_session is not None
        and b is None
        and slot.reserved_at is not None
        and (now_ts - slot.reserved_at) > claim_grace()
    ):
        if _release(slot, slot.reserved_at):
            actions.append("R2")
        return actions

    # R3 (claim-gated): activation never completed; the booking is invisible
    # (Sealed) and safe to collect.
    if (
        b is not None
        and b.status == SEALED
        and slot.reserved_at is not None
        and (now_ts - slot.reserved_at) > claim_grace()
    ):
        if _release(slot, slot.reserved_at):
            actions.append("R3")
            cas.delete_sealed_session(b)
        return actions

    return actions


# --------------------------------------------------------------------------
# Per-booking rules
# --------------------------------------------------------------------------
def reconcile_session(b, now_ts=None):
    """Apply rules that act on the booking side. Returns rule ids."""
    now_ts = now_ts or timezone.now()
    actions = []

    # R8 (ungated): Confirmed booking whose backing slot was deleted.
    if b.status == CONFIRMED and b.slot_id is not None:
        slot = AvailabilitySlot.objects.filter(pk=b.slot_id).first()
        if slot is None:
            if cas.transition_session(b, CONFIRMED, slot=None):
                actions.append("R8")
        return actions

    # R4 (claim-gated on created_at): stale Sealed booking whose slot claim
    # no longer references it (or whose slot vanished) — replaceable by a
    # fresh retry. Fresh Sealed bookings are NEVER deleted or replaced.
    if b.status == SEALED and (now_ts - b.created_at) > claim_grace():
        slot = (
            AvailabilitySlot.objects.filter(pk=b.slot_id).first()
            if b.slot_id is not None
            else None
        )
        orphaned = slot is None or slot.reserved_session_id != b.pk
        if orphaned:
            if cas.delete_sealed_session(b):
                actions.append("R4")
    return actions


def reconcile_all(now_ts=None, limit=500):
    """Sweep: slot-side rules on every reserved slot, then booking-side rules
    on candidate bookings. Idempotent; safe to run repeatedly (repeated runs
    are no-ops once converged). Returns rule ids -> applied counts."""
    now_ts = now_ts or timezone.now()
    counts = {}

    slots = AvailabilitySlot.objects.filter(reserved_by__isnull=False)[:limit]
    for slot in slots:
        for rule in reconcile_slot(slot, now_ts):
            counts[rule] = counts.get(rule, 0) + 1

    # Booking-side: Sealed (R4). A Sealed booking whose slot was released in
    # the loop above may now qualify for R4 — the sweep therefore runs after
    # all slot releases in the same pass.
    for b in Session.objects.filter(status=SEALED)[:limit]:
        for rule in reconcile_session(b, now_ts):
            counts[rule] = counts.get(rule, 0) + 1

    # R8: Confirmed bookings with a dangling slot reference (slot deleted
    # while the B-side clear was still pending).
    for b in Session.objects.filter(status=CONFIRMED, slot__isnull=False)[:limit]:
        for rule in reconcile_session(b, now_ts):
            counts[rule] = counts.get(rule, 0) + 1

    return counts


def preview_all(now_ts=None, limit=500):
    """Read-only: which documents WOULD be acted on by each rule right now.
    Used by ``reconcile_slots --dry-run``; performs no mutations."""
    now_ts = now_ts or timezone.now()
    affected = {}

    for slot in AvailabilitySlot.objects.filter(reserved_by__isnull=False)[:limit]:
        rule = _matching_rule(slot, now_ts)
        if rule:
            affected.setdefault(rule, []).append(str(slot.pk))

    for b in Session.objects.filter(status=SEALED)[:limit]:
        slot = (
            AvailabilitySlot.objects.filter(pk=b.slot_id).first()
            if b.slot_id is not None
            else None
        )
        orphaned = slot is None or slot.reserved_session_id != b.pk
        if (now_ts - b.created_at) > claim_grace() and orphaned:
            affected.setdefault("R4", []).append(str(b.pk))

    for b in Session.objects.filter(status=CONFIRMED, slot__isnull=False)[:limit]:
        slot = AvailabilitySlot.objects.filter(pk=b.slot_id).first()
        if slot is None:
            affected.setdefault("R8", []).append(str(b.pk))

    return affected


def _matching_rule(slot, now_ts):
    """Return the first rule whose predicate matches (no mutation)."""
    b = None
    if slot.reserved_by is not None and slot.reserved_session is not None:
        b = Session.objects.filter(pk=slot.reserved_session_id).first()
    if b is not None and b.status == CANCELLED:
        return "R5"
    if (
        b is not None
        and b.slot_id != slot.pk
        and b.status in (PENDING, SUGGESTED, SEALED)
        and slot.reserved_at is not None
        and (now_ts - slot.reserved_at) > transfer_grace()
    ):
        return "R6"
    if (
        b is not None
        and b.slot_id != slot.pk
        and b.status == CONFIRMED
        and b.updated_at is not None
        and (now_ts - b.updated_at) > transfer_grace()
    ):
        return "R7"
    if slot.reserved_by is not None and slot.reserved_session is None and slot.reserved_at is not None and (now_ts - slot.reserved_at) > claim_grace():
        return "R1"
    if (
        slot.reserved_by is not None
        and slot.reserved_session is not None
        and b is None
        and slot.reserved_at is not None
        and (now_ts - slot.reserved_at) > claim_grace()
    ):
        return "R2"
    if b is not None and b.status == SEALED and slot.reserved_at is not None and (now_ts - slot.reserved_at) > claim_grace():
        return "R3"
    return None


__all__ = [
    "claim_grace",
    "transfer_grace",
    "reconcile_slot",
    "reconcile_session",
    "reconcile_all",
    "preview_all",
]
