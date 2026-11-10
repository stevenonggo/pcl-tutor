"""Booking lifecycle service: published-slot claims, custom-time bookings,
and request actions (confirm / decline / suggest / cancel), including
moved-confirmation transfers.

Conventions (P0 design Revisions 1-5):
- Published-slot bookings are *create-first*: the Sealed Session is created
  before the claim, and the claim writes ``reserved_by``,
  ``reserved_session`` and ``reserved_at`` in ONE atomic update. There is no
  steady "claimed but unlinked" state.
- A late original request can never complete: the claim CAS requires
  ``reserved_by=None`` and the freshness guard refuses claims whose booking
  is older than the claim grace window.
- Reconciliation (``tutors.reconcile``) converges every crash state; all
  rules are CAS-guarded and idempotent.
- ``client_token`` is REQUIRED (enforced in the view layer; 400 on
  missing/empty) and drives DB-level idempotency via the partial-unique
  index. Retries reuse the same token; the service reuses the same Sealed
  document (never deletes a *fresh* one).
"""

from django.db import IntegrityError
from django.utils import timezone

from . import cas, reconcile
from .models import (
    ACTIVE_STATUSES,
    CANCELLED,
    CONFIRMED,
    PENDING,
    SEALED,
    SUGGESTED,
    AvailabilitySlot,
    Session,
)
from users.models import User


class BookingConflict(Exception):
    """409-class outcome with a stable code: 'taken', 'expired', 'unavailable',
    'slot-gone', 'foreign-active'."""

    def __init__(self, code, message=None):
        super().__init__(message or code)
        self.code = code
        self.message = message or code


class BookingIncompatible(Exception):
    """400-class outcome (validation)."""


class BookingUnavailable(Exception):
    """503-class outcome (an in-flight write failed; state is safe/retryable)."""


def _stale_booking(b, now_ts):
    return (now_ts - b.created_at) > reconcile.claim_grace()


def _find_winner(student, slot=None, tutor=None, client_token=""):
    """Re-run the dedupe lookup after a lost same-token create race."""
    qs = Session.objects.filter(
        student=student,
        client_token=client_token,
        status__in=ACTIVE_STATUSES,
    )
    if slot is not None:
        qs = qs.filter(slot=slot)
    if tutor is not None:
        qs = qs.filter(tutor=tutor)
    return qs.order_by("-created_at").first()


# --------------------------------------------------------------------------
# Published-slot booking (create-first claim)
# --------------------------------------------------------------------------
def book_published_slot(student, slot, subject, topic, notes, client_token, now_ts=None):
    """Run the full published-slot booking flow.

    Returns ``(kind, booking, payload)`` where kind is one of:
    'created' (201), 'replay' (200, same booking), 'conflict' (409, payload
    carries the BookingConflict), 'error' (503).
    """
    now_ts = now_ts or timezone.now()
    tutor = slot.tutor
    slot.refresh_from_db()

    # --- 1. Idempotency / dedupe by (student, client_token, slot) ---
    b0 = (
        Session.objects.filter(
            student=student,
            slot=slot,
            client_token=client_token,
            status__in=ACTIVE_STATUSES,
        )
        .order_by("-created_at")
        .first()
    )
    if b0 is not None:
        if b0.status in (PENDING, SUGGESTED, CONFIRMED):
            # Active booking for this intent: replay, never duplicate.
            return "replay", b0, {"replay": True, "booking": _serialize(b0)}
        # b0.status == SEALED:
        if slot.reserved_by_id == student.id and slot.reserved_session_id == b0.pk:
            # Our retry after a post-claim death: activate the SAME document.
            return _activate(b0, now_ts)
        if _stale_booking(b0, now_ts):
            # Stale Sealed (its request is definitely dead): replaceable.
            cas.delete_sealed_session(b0)
            b0 = None
        else:
            # Fresh Sealed: the original may still be in flight. REUSE it —
            # never delete or replace a fresh Sealed booking.
            return _claim_and_activate(student, slot, subject, topic, notes,
                                       client_token, b0, now_ts)

    # --- 2. Create the Sealed session (details come ONLY from the slot) ---
    b = None
    try:
        b = cas.create_sealed_session(
            student=student,
            tutor=tutor,
            subject=subject,
            topic=topic,
            notes=notes,
            date=slot.date,
            time=slot.time,
            mode=slot.mode,
            location=slot.location,
            duration=slot.duration,
            slot=slot,
            custom=False,
            client_token=client_token,
        )
    except IntegrityError:
        # Lost the same-token create race (concurrent stale-replace retries
        # both deleted the stale doc and recreated it). Re-run dedupe and
        # REUSE the winner's document — never 500, never duplicate.
        winner = _find_winner(student, slot=slot, client_token=client_token)
        if winner is None:
            raise BookingUnavailable("token conflict; retry with the same token")
        if winner.status in (PENDING, SUGGESTED, CONFIRMED):
            return "replay", winner, {"replay": True, "booking": _serialize(winner)}
        return _claim_and_activate(student, slot, subject, topic, notes,
                                   client_token, winner, now_ts)

    # --- 3. CAS claim + link + timestamp (one atomic write) ---
    return _claim_and_activate(student, slot, subject, topic, notes,
                               client_token, b, now_ts, just_created=True)


def _claim_and_activate(student, slot, subject, topic, notes, client_token, b,
                        now_ts, just_created=False):
    try:
        n = cas.claim_slot(slot, student, b, stamp=now_ts)
    except IntegrityError:
        raise BookingUnavailable("slot write failed; retry with the same token")

    if n == 0:
        slot.refresh_from_db()
        if slot.reserved_by_id == student.id and slot.reserved_session_id == b.pk:
            # Our own earlier attempt already claimed it (crash-recovery
            # retry path): fall through to activation.
            pass
        else:
            # Someone else owns the slot. B stays Sealed (invisible); R4
            # collects it once stale. Never activate a lost claim.
            return "conflict", b, {"error": BookingConflict(
                "taken", "That time was just taken. Pick another time.")}

    # Freshness guard: a late original request must not complete after its
    # claim has expired / been reassigned.
    if _stale_booking(b, now_ts):
        cas.delete_sealed_session(b)
        return "conflict", b, {"error": BookingConflict(
            "expired", "Claim expired. Retry the booking.")}

    # --- 4. Activate (Sealed -> Pending), same-document retry converges ---
    return _activate(b, now_ts)


def _activate(b, now_ts):
    n = cas.activate_session(b)
    if n == 1:
        b.refresh_from_db()
        return "created", b, {"booking": _serialize(b)}
    # Lost the activation CAS: either a concurrent retry activated the SAME
    # document (converge on it) or reconciliation deleted it.
    live = Session.objects.filter(pk=b.pk).first()
    if live is not None and live.status == PENDING:
        return "replay", live, {"replay": True, "booking": _serialize(live)}
    return "conflict", b, {"error": BookingConflict(
        "expired", "Slot no longer available. Retry the booking.")}


# --------------------------------------------------------------------------
# Custom-time booking (no slot resource; token dedupe + advisory overlap)
# --------------------------------------------------------------------------
def book_custom_time(student, tutor, subject, topic, notes, date, time, mode,
                     location, client_token, now_ts=None):
    now_ts = now_ts or timezone.now()
    b0 = (
        Session.objects.filter(
            student=student,
            tutor=tutor,
            client_token=client_token,
            status__in=ACTIVE_STATUSES,
        )
        .order_by("-created_at")
        .first()
    )
    if b0 is not None and b0.status in (PENDING, SUGGESTED, CONFIRMED):
        return "replay", b0, {"replay": True, "booking": _serialize(b0)}

    try:
        b = cas.create_pending_custom_session(
            student=student,
            tutor=tutor,
            subject=subject,
            topic=topic,
            notes=notes,
            date=date,
            time=time,
            mode=mode,
            location=location,
            client_token=client_token,
        )
    except IntegrityError:
        # Lost the same-token create race (concurrent retries of the same
        # intent): reuse the winner's document instead of erroring.
        winner = _find_winner(student, tutor=tutor, client_token=client_token)
        if winner is None:
            raise BookingUnavailable("token conflict; retry with the same token")
        return "replay", winner, {"replay": True, "booking": _serialize(winner)}

    notice = _overlap_notice(b)
    return "created", b, {"booking": _serialize(b), **notice}


def _overlap_notice(b):
    """Advisory only: list other ACTIVE bookings at the same tutor/time.
    Overlapping custom bookings are allowed by design (the tutor arbitrates);
    this notice is response metadata, never a 409."""
    others = Session.objects.filter(
        tutor=b.tutor,
        date=b.date,
        time=b.time,
        status__in=[PENDING, SUGGESTED, CONFIRMED],
    ).exclude(pk=b.pk)
    ids = [str(o.pk) for o in others]
    return {"overlap_notice": ids} if ids else {}


# --------------------------------------------------------------------------
# Request actions
# --------------------------------------------------------------------------
def tutor_confirm(b, now_ts=None):
    """Pending -> Confirmed (original time; the slot stays reserved for life)."""
    now_ts = now_ts or timezone.now()
    n = cas.transition_session(b, PENDING, status=CONFIRMED)
    if n == 1:
        b.refresh_from_db()
        return "ok", b, {"booking": _serialize(b)}
    return _return_state_or_conflict(b, expected=CONFIRMED)


def tutor_decline(b, now_ts=None):
    """Pending -> Cancelled (cancelled_by='tutor') + release the slot."""
    now_ts = now_ts or timezone.now()
    n = cas.transition_session(b, PENDING, status=CANCELLED, cancelled_by="tutor")
    if n == 1:
        _release_for_terminated(b)
        b.refresh_from_db()
        return "ok", b, {"booking": _serialize(b)}
    return _return_state_or_conflict(b, expected=CANCELLED)


def tutor_suggest(b, suggested_date, suggested_time, alternative, suggestion,
                  now_ts=None):
    """Pending -> Suggested with the proposed new time stored on the booking.
    The original slot stays reserved while the student decides."""
    now_ts = now_ts or timezone.now()
    n = cas.transition_session(
        b, PENDING,
        status=SUGGESTED,
        suggested_date=suggested_date,
        suggested_time=suggested_time,
        alternative=alternative,
        suggestion=suggestion,
    )
    if n == 1:
        b.refresh_from_db()
        return "ok", b, {"booking": _serialize(b)}
    return _return_state_or_conflict(b, expected=SUGGESTED)


def student_cancel(b, now_ts=None):
    """Suggested -> Cancelled (cancelled_by='student') + release the slot."""
    now_ts = now_ts or timezone.now()
    n = cas.transition_session(b, SUGGESTED, status=CANCELLED, cancelled_by="student")
    if n == 1:
        _release_for_terminated(b)
        b.refresh_from_db()
        return "ok", b, {"booking": _serialize(b)}
    return _return_state_or_conflict(b, expected=CANCELLED)


def _release_for_terminated(b):
    """Best-effort triple-CAS release of the backing slot after a terminal
    transition. R5 reconciles any failure; the triple guard makes a lost
    release a no-op, never a foreign release."""
    if b.slot_id is not None:
        slot = AvailabilitySlot.objects.filter(pk=b.slot_id).first()
        if slot is not None:
            cas.release_slot_claim(
                slot.pk, slot.reserved_by, slot.reserved_session, slot.reserved_at
            )


def _return_state_or_conflict(b, expected):
    live = Session.objects.filter(pk=b.pk).first()
    if live is not None and live.status == expected:
        return "ok", live, {"booking": _serialize(live), "idempotent": True}
    raise BookingConflict("state", f"Booking is not in the expected state (now: {b.status}).")


# --------------------------------------------------------------------------
# Moved confirmation (Suggested -> Confirmed at a new time, with transfer)
# --------------------------------------------------------------------------
def student_confirm_suggested(b, target_date, target_time, now_ts=None):
    """Confirm a Suggested booking, possibly at the tutor's proposed time.

    Slot target (hard conflict):
        1. claim S1 (one atomic write: reserved_by/reserved_session/reserved_at)
        2. status CAS: Suggested -> Confirmed (new date/time, slot=S1) + I7 clock
        3. VERIFY the claim still holds (3b); if lost -> UNDO back to
           Suggested at the original slot (S0 is never released in the undo
           path, so the original booking + slot are preserved)
        4. release S0 (moved time only; idempotent)
    Custom target (soft conflict):
        1. advisory overlap check (allowed, never blocks)
        2. status CAS (slot=None)
        3. release S0
    """
    now_ts = now_ts or timezone.now()
    b.refresh_from_db()
    original_date, original_time = b.date, b.time
    s0_pk = b.slot_id

    target_slot = AvailabilitySlot.objects.filter(
        tutor=b.tutor, date=target_date, time=target_time, mode=b.mode
    ).first()

    claimed_ts = None
    if target_slot is not None:
        if target_slot.reserved_by is not None:
            own = (
                target_slot.reserved_by_id == b.student_id
                and target_slot.reserved_session_id == b.pk
            )
            if not own:
                # Hard conflict: the target time is held by someone else.
                # Nothing written.
                raise BookingConflict(
                    "unavailable", "The suggested time is no longer available."
                )
            # Same-time confirm: the "target" is the origin slot and it is
            # our own live claim. Keep it (reserved for life once Confirmed);
            # no new claim, no release in step 4 (s0 == target below).
            claimed_ts = target_slot.reserved_at
        else:
            n = cas.claim_slot(target_slot, b.student, b, stamp=now_ts)
            if n == 0:
                raise BookingConflict(
                    "unavailable", "The suggested time was just taken."
                )
            claimed_ts = now_ts
    else:
        # Custom target: overlapping active bookings are ALLOWED (advisory).
        pass

    # Status CAS (single atomic write, I7 clock).
    n2 = cas.transition_session(
        b, SUGGESTED,
        status=CONFIRMED,
        date=target_date,
        time=target_time,
        slot=target_slot.pk if target_slot is not None else None,
    )
    if n2 == 0:
        # B left Suggested (e.g. cancelled concurrently): undo any claim we
        # made; B's own cancellation path owns S0 (R5 covers the pointer).
        if claimed_ts is not None:
            cas.release_slot_claim(
                target_slot.pk, b.student, b, claimed_ts
            )
        return _return_state_or_conflict(b, expected=CONFIRMED)

    if target_slot is not None:
        # 3b: verify the claim still holds. A lost claim can only happen if
        # the transfer grace elapsed (reconcile released it); the undo
        # restores the original booking + original slot.
        holds = cas.slot_claim_holds(target_slot.pk, b.student, b, claimed_ts)
        if holds == 0:
            undone = cas.revert_session(
                b, CONFIRMED,
                status=SUGGESTED,
                date=original_date,
                time=original_time,
                slot=_slot_or_none(s0_pk),
            )
            if undone == 1:
                raise BookingConflict("unavailable", "Time no longer available; retry.")
            # Undo lost: B was cancelled in the meantime (R5 owns S0; R6 owns
            # S1). Surface the current state.
            return _return_state_or_conflict(b, expected=CONFIRMED)

    # Step 4: release the source slot when the time actually moved. This
    # applies to BOTH slot targets and custom targets: a moved confirm
    # (published or custom) vacates the origin slot. Same-time confirms
    # (s0 == target, or custom with no origin slot) release nothing. The
    # origin slot is re-read for the triple so a concurrent re-claim can
    # never be disturbed.
    if s0_pk is not None and s0_pk != (target_slot.pk if target_slot is not None else None):
        s0 = AvailabilitySlot.objects.filter(pk=s0_pk).first()
        if s0 is not None:
            cas.release_slot_claim(
                s0.pk, s0.reserved_by, s0.reserved_session, s0.reserved_at
            )

    b.refresh_from_db()
    payload = {"booking": _serialize(b)}
    if target_slot is None:
        payload.update(_overlap_notice(b))
    return "ok", b, payload


def _slot_or_none(pk):
    if pk is None:
        return None
    return AvailabilitySlot.objects.filter(pk=pk).first()


# --------------------------------------------------------------------------
# Serialization
# --------------------------------------------------------------------------
def _serialize(b):
    return {
        "id": str(b.pk),
        "student": str(b.student_id),
        "tutor": str(b.tutor_id),
        "subject": b.subject,
        "topic": b.topic,
        "notes": b.notes,
        "date": b.date,
        "time": b.time,
        "mode": b.mode,
        "location": b.location,
        "duration": b.duration,
        "slot": str(b.slot_id) if b.slot_id is not None else None,
        "custom": b.custom,
        "status": b.status,
        "display_status": b.display_status,
        "cancelled_by": b.cancelled_by,
        "suggested_date": b.suggested_date,
        "suggested_time": b.suggested_time,
        "alternative": b.alternative,
        "suggestion": b.suggestion,
    }
