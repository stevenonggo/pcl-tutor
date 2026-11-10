"""Tutors application models: booking sessions and published availability slots.

Design notes (P0 backend design, Revisions 1-5):
- Single-document MongoDB users: profile fields live on ``users.User``.
- ``AvailabilitySlot`` is never deleted by the booking flow; a booking *claims*
  the slot (``reserved_by`` / ``reserved_session`` / ``reserved_at`` in one
  atomic write) and releases it on terminal transitions or via reconciliation.
- ``Session`` is created first in an internal ``Sealed`` state that every read
  endpoint excludes (invariant I4). Sealed sessions are invisible, never
  activated without a successful claim, and collected by reconciliation when
  stale (I3).
- Every status/slot mutation is a compare-and-swap (CAS) update that writes
  ``updated_at`` explicitly in the same atomic write (invariant I7);
  ``auto_now`` is NOT relied upon because Django's ``QuerySet.update()`` does
  not trigger it.
"""

from django.db import models
from django.db.models import Q, UniqueConstraint
from django.utils import timezone

from users.models import User

# --------------------------------------------------------------------------
# Status vocabulary
# --------------------------------------------------------------------------
# Internal creation state: created before the slot claim completes. Excluded
# from every read endpoint (I4). A Sealed session is never an "active booking".
SEALED = "Sealed"
PENDING = "Pending"
SUGGESTED = "Suggested"
CONFIRMED = "Confirmed"
CANCELLED = "Cancelled"

#: Statuses that hold the client token in the partial-unique index and that
#: count as "active" for duplicate-booking prevention.
ACTIVE_STATUSES = [SEALED, PENDING, SUGGESTED, CONFIRMED]

#: Statuses a booking may move to Cancelled from, with the acting role.
TERMINAL_STATUS = CANCELLED


class AvailabilitySlot(models.Model):
    """A published availability slot (one tutor, one date/time/mode)."""

    tutor = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="availability_slots"
    )
    date = models.CharField(max_length=10)  # YYYY-MM-DD
    time = models.CharField(max_length=5)  # HH:MM
    mode = models.CharField(max_length=16)  # 'Online' | 'Offline'
    location = models.CharField(max_length=120, blank=True, default="")
    duration = models.PositiveSmallIntegerField(default=60)  # minutes

    # Claim fields. Written together with a single atomic update (the CAS
    # claim) and released with a triple-matched CAS. ``reserved_at`` is part
    # of the claim from the moment it exists, so read-time repair and the
    # sweeper can time-gate recovery on it (a fresh claim is never released).
    reserved_by = models.ForeignKey(
        User,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="reserved_slots",
    )
    reserved_session = models.ForeignKey(
        "Session",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="holding_slots",
    )
    reserved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            # Mirrors the web app's slotKey uniqueness.
            UniqueConstraint(
                fields=["tutor", "date", "time", "mode"], name="uniq_slot"
            ),
        ]

    @property
    def slot_key(self):
        return f"{self.tutor_id}:{self.date}:{self.time}:{self.mode}"


class Session(models.Model):
    """A single unified booking document (request + session in one lifecycle).

    Lifecycle: Sealed -> Pending -> Suggested -> Confirmed | Cancelled.
    Only one booking per slot can ever be active (enforced by the claim CAS);
    only one active-status document per (student, client_token) is possible
    (enforced by the partial-unique index below).
    """

    student = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="student_sessions"
    )
    tutor = models.ForeignKey(
        User, on_delete=models.CASCADE, related_name="tutor_sessions"
    )

    # Denormalized details. For published-slot bookings these are copied from
    # the slot at creation; for custom-time bookings they come from the
    # request. They survive slot deletion (I2b / R8).
    subject = models.CharField(max_length=100)
    topic = models.CharField(max_length=200, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    date = models.CharField(max_length=10)
    time = models.CharField(max_length=5)
    mode = models.CharField(max_length=16)
    location = models.CharField(max_length=120, blank=True, default="")
    duration = models.PositiveSmallIntegerField(default=60)

    #: Published slot that backs this booking's time. Nullable: None for
    #: custom-time bookings, moved-to-custom bookings, and after the backing
    #: slot is deleted (R8 clears dangling references).
    slot = models.ForeignKey(
        AvailabilitySlot,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="booking_sessions",
    )
    custom = models.BooleanField(default=False)

    status = models.CharField(max_length=16, default=SEALED)
    #: 'tutor' | 'student' | '' — who performed the cancellation.
    cancelled_by = models.CharField(max_length=16, blank=True, default="")

    # Suggestion payload (tutor-proposed new time), used by moved confirms.
    suggested_date = models.CharField(max_length=10, blank=True, default="")
    suggested_time = models.CharField(max_length=5, blank=True, default="")
    alternative = models.CharField(max_length=120, blank=True, default="")
    suggestion = models.TextField(blank=True, default="")

    #: Client-supplied idempotency key (required, non-empty, for all new
    #: bookings). Held while the booking is in an active status; released
    #: automatically for terminal bookings because the unique index is
    #: partial (condition below).
    client_token = models.CharField(max_length=64, blank=True, default="")

    # Explicit clocks. ``created_at`` at creation; ``updated_at`` is written
    # by every CAS mutation (I7 contract).
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [
            # Database-enforced idempotency: at most one active-status booking
            # per (student, client_token). Terminal (Cancelled) documents fall
            # outside the partial filter, releasing the token for re-booking.
            UniqueConstraint(
                fields=["student", "client_token"],
                condition=Q(status__in=ACTIVE_STATUSES) & Q(client_token__gt=""),
                name="uniq_active_booking_token",
            ),
        ]

    # ------------------------------------------------------------------
    # Display helpers (web parity: request-level "Rejected" == a Cancelled
    # booking caused by the tutor; a student cancellation shows "Cancelled")
    # ------------------------------------------------------------------
    @property
    def display_status(self):
        if self.status == CANCELLED and self.cancelled_by == "tutor":
            return "Rejected"
        return self.status

    def is_active(self):
        return self.status in ACTIVE_STATUSES

    def is_terminal(self):
        return self.status == CANCELLED
