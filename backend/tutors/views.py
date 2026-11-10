"""Tutor discovery, availability, booking, requests, actions, activity,
and profile endpoints. All endpoints require JWT authentication.

Conventions: dictionary responses (project style), role checks explicit,
Sealed bookings excluded from every read (invariant I4).
"""

from django.db import IntegrityError
from django.utils import timezone

from rest_framework import permissions, status
from rest_framework.response import Response
from rest_framework.views import APIView

from users.models import User

from . import booking as bk
from . import reconcile
from .models import (
    CANCELLED,
    CONFIRMED,
    PENDING,
    SEALED,
    SUGGESTED,
    ACTIVE_STATUSES,
    AvailabilitySlot,
    Session,
)

VALID_MODES = ("Online", "Offline")
VALID_ACTIONS = ("confirm", "decline", "suggest", "cancel")


def _tutor_profile(u):
    return {
        "id": str(u.id),
        "username": u.username,
        "full_name": u.full_name,
        "major": u.major,
        "semester": u.semester,
        "bio": u.bio,
        "subjects": list(u.subjects or []),
        "accent": u.accent,
        "rating": u.rating,
        "sessions_count": u.sessions_count,
        "is_demo": u.is_demo,
    }


def _slot_payload(slot, now_ts=None):
    return {
        "id": str(slot.pk),
        "date": slot.date,
        "time": slot.time,
        "mode": slot.mode,
        "location": slot.location,
        "duration": slot.duration,
        "reserved": slot.reserved_by is not None,
        "reserved_session": str(slot.reserved_session_id) if slot.reserved_session_id else None,
    }


class _TutorOnly(permissions.BasePermission):
    def has_permission(self, request, view):
        return (
            request.user.is_authenticated
            and getattr(request.user, "role", "student") == "tutor"
        )


class _StudentOnly(permissions.BasePermission):
    def has_permission(self, request, view):
        return (
            request.user.is_authenticated
            and getattr(request.user, "role", "student") == "student"
        )


# --------------------------------------------------------------------------
# Availability (published slots)
# --------------------------------------------------------------------------
class AvailabilityListView(APIView):
    """GET  /api/availability/?date=  -> own published slots for a date
    POST /api/availability/           -> publish a slot (no tutor_id; the
                                          authenticated user is the tutor)
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        if user.role != "tutor":
            return Response(
                {"error": "Only tutors manage availability"},
                status=status.HTTP_403_FORBIDDEN,
            )
        date = request.query_params.get("date") or timezone.localdate().isoformat()
        slots = (
            AvailabilitySlot.objects.filter(tutor=user, date=date)
            .order_by("time")
        )
        # Read-time repair: touch every slot we serve.
        for s in slots:
            reconcile.reconcile_slot(s)
        for s in slots:
            s.refresh_from_db()
        return Response(
            {
                "date": date,
                "slots": [_slot_payload(s) for s in slots],
            }
        )

    def post(self, request):
        user = request.user
        if user.role != "tutor":
            return Response(
                {"error": "Only tutors publish availability"},
                status=status.HTTP_403_FORBIDDEN,
            )
        # tutor_id in the body is ignored by design (owner comes from JWT).
        date = str(request.data.get("date", ""))
        time = str(request.data.get("time", ""))
        mode = str(request.data.get("mode", ""))
        location = str(request.data.get("location", ""))
        try:
            duration = int(request.data.get("duration", 60))
        except (TypeError, ValueError):
            duration = 60
        duration = max(15, min(duration, 480))

        errors = {}
        if len(date) != 10:
            errors["date"] = "Use YYYY-MM-DD."
        if len(time) != 5:
            errors["time"] = "Use HH:MM."
        if mode not in VALID_MODES:
            errors["mode"] = f"Must be one of {list(VALID_MODES)}."
        if mode == "Online":
            location = ""
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)

        try:
            slot = AvailabilitySlot.objects.create(
                tutor=user,
                date=date,
                time=time,
                mode=mode,
                location=location,
                duration=duration,
            )
        except IntegrityError:
            return Response(
                {"error": "You already have a slot at that time."},
                status=status.HTTP_409_CONFLICT,
            )
        return Response(
            {"slot": _slot_payload(slot)}, status=status.HTTP_201_CREATED
        )


class AvailabilityDetailView(APIView):
    """DELETE /api/availability/{id}/ -> owner removes an unpublished slot.

    Refused with 409 while the slot is claimed by a live booking, EXCEPT
    when the claim belongs to a Confirmed booking: the Session keeps its
    denormalized copies and history, so deletion is safe (invariant I2b).
    """
    permission_classes = [permissions.IsAuthenticated]

    def delete(self, request, slot_id):
        user = request.user
        slot = AvailabilitySlot.objects.filter(pk=slot_id).first()
        if slot is None or slot.tutor_id != user.id:
            return Response(
                {"error": "Not found"}, status=status.HTTP_404_NOT_FOUND
            )

        if slot.reserved_by is not None:
            b = (
                Session.objects.filter(pk=slot.reserved_session_id).first()
                if slot.reserved_session
                else None
            )
            if not (b is not None and b.status == CONFIRMED):
                return Response(
                    {"error": "Slot is reserved for a pending request."},
                    status=status.HTTP_409_CONFLICT,
                )
            # Confirmed booking: clear its slot reference (I7 clock write),
            # keep the booking fully valid (denormalized details).
            bk.cas.transition_session(b, CONFIRMED, slot=None)

        slot.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


# --------------------------------------------------------------------------
# Tutor discovery
# --------------------------------------------------------------------------
class TutorListView(APIView):
    """GET /api/tutors/?q=&subject= -> tutor directory."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        tutors = User.objects.filter(role="tutor")
        q = (request.query_params.get("q") or "").strip()
        subject = (request.query_params.get("subject") or "").strip()
        today = timezone.localdate().isoformat()
        horizon = (timezone.localdate() + timezone.timedelta(days=6)).isoformat()

        results = []
        for t in tutors:
            name = (t.full_name or t.username or "").lower()
            if q and q.lower() not in name and q.lower() not in (t.username or "").lower():
                continue
            subjects = list(t.subjects or [])
            if subject and subject not in subjects:
                continue
            open_slots = (
                AvailabilitySlot.objects.filter(
                    tutor=t, reserved_by=None, date__gte=today, date__lte=horizon
                )
                .count()
            )
            item = _tutor_profile(t)
            item["open_slots_next_7d"] = open_slots
            results.append(item)
        return Response({"tutors": results})


class TutorDetailView(APIView):
    """GET /api/tutors/{id}/ -> tutor + next-7-day slots with reserved flags."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request, tutor_id):
        t = User.objects.filter(role="tutor", pk=tutor_id).first()
        if t is None:
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)
        today = timezone.localdate().isoformat()
        horizon = (timezone.localdate() + timezone.timedelta(days=6)).isoformat()
        slots = AvailabilitySlot.objects.filter(
            tutor=t, date__gte=today, date__lte=horizon
        ).order_by("date", "time")
        for s in slots:
            reconcile.reconcile_slot(s)
        slots = list(AvailabilitySlot.objects.filter(
            tutor=t, date__gte=today, date__lte=horizon
        ).order_by("date", "time"))
        payload = _tutor_profile(t)
        payload["slots"] = [_slot_payload(s) for s in slots]
        payload["open_slots_next_7d"] = sum(
            1 for s in slots if s.reserved_by is None
        )
        return Response(payload)


# --------------------------------------------------------------------------
# Booking (sessions)
# --------------------------------------------------------------------------
class SessionCreateView(APIView):
    """POST /api/sessions/  -> create a booking
    GET  /api/sessions/     -> role-scoped confirmed sessions (calendar)

    A single URL entry (``sessions/``) dispatches by HTTP method; the URL
    conf must therefore register this view only once for that path.

    POST payloads:
      Published slot: {"slot_id", "subject", "topic"?, "notes"?,
                        "client_token"} — date/time/mode/location/duration
                        come from the slot, NEVER from the client.
      Custom time:    {"tutor", "subject", "topic"?, "notes"?, "date", "time",
                        "mode", "location"?, "client_token", "custom": true}

    ``client_token`` is REQUIRED and non-empty for every new booking (400
    otherwise); the client must reuse it on retries of the same intent.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        if user.role == "tutor":
            qs = Session.objects.filter(tutor=user, status=CONFIRMED)
        else:
            qs = Session.objects.filter(student=user, status=CONFIRMED)
        items = []
        for b in qs.order_by("date", "time"):
            p = bk._serialize(b)
            p["display_status"] = b.display_status
            items.append(p)
        return Response({"sessions": items})

    def post(self, request):
        user = request.user
        if user.role != "student":
            return Response(
                {"error": "Only students create bookings"},
                status=status.HTTP_403_FORBIDDEN,
            )

        token = str(request.data.get("client_token") or "").strip()
        if not token:
            return Response(
                {"client_token": "A non-empty client_token is required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        subject = str(request.data.get("subject", "")).strip()
        topic = str(request.data.get("topic", "")).strip()
        notes = str(request.data.get("notes", "")).strip()

        slot_id = request.data.get("slot_id")
        is_custom = bool(request.data.get("custom"))

        if not is_custom:
            slot = (
                AvailabilitySlot.objects.filter(pk=slot_id).first()
                if slot_id
                else None
            )
            if slot is None:
                return Response(
                    {"error": "Slot not found"}, status=status.HTTP_404_NOT_FOUND
                )
            tutor = slot.tutor
            if subject not in list(tutor.subjects or []):
                return Response(
                    {"subject": "That subject is not offered by this tutor."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            outcome, b, payload = bk.book_published_slot(
                user, slot, subject, topic, notes, token
            )
        else:
            tutor = User.objects.filter(pk=request.data.get("tutor"), role="tutor").first()
            if tutor is None:
                return Response(
                    {"error": "Tutor not found"}, status=status.HTTP_404_NOT_FOUND
                )
            if subject not in list(tutor.subjects or []):
                return Response(
                    {"subject": "That subject is not offered by this tutor."},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            date = str(request.data.get("date", ""))
            time = str(request.data.get("time", ""))
            mode = str(request.data.get("mode", ""))
            errors = {}
            if len(date) != 10:
                errors["date"] = "Use YYYY-MM-DD."
            if len(time) != 5:
                errors["time"] = "Use HH:MM."
            if mode not in VALID_MODES:
                errors["mode"] = f"Must be one of {list(VALID_MODES)}."
            if errors:
                return Response(errors, status=status.HTTP_400_BAD_REQUEST)
            location = "" if mode == "Online" else str(request.data.get("location", ""))
            outcome, b, payload = bk.book_custom_time(
                user, tutor, subject, topic, notes, date, time, mode, location, token
            )

        if outcome == "created":
            return Response(payload, status=status.HTTP_201_CREATED)
        if outcome == "replay":
            return Response(payload, status=status.HTTP_200_OK)
        if outcome == "conflict":
            err = payload.get("error")
            return Response({"error": err.message}, status=status.HTTP_409_CONFLICT)
        # 'error' -> retryable (state is safe; the client should retry with
        # the same client_token).
        return Response(
            {"error": "Booking is in progress; retry with the same client_token."},
            status=status.HTTP_503_SERVICE_UNAVAILABLE,
        )


# --------------------------------------------------------------------------
# Requests / sessions / activity (read models, role-scoped, no Sealed)
# --------------------------------------------------------------------------
def _visible(b):
    return b.status != SEALED


class RequestListView(APIView):
    """GET /api/requests/ -> role-scoped requests (non-terminal lifecycle).

    Student: their own open/recent requests. Tutor: incoming requests.
    """
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        if user.role == "tutor":
            qs = Session.objects.filter(tutor=user, status__in=[PENDING, SUGGESTED, CANCELLED])
        else:
            qs = Session.objects.filter(student=user, status__in=[PENDING, SUGGESTED, CANCELLED])
        items = []
        for b in qs.order_by("-updated_at"):
            p = bk._serialize(b)
            p["display_status"] = b.display_status
            student = User.objects.filter(pk=b.student_id).first()
            tutor = User.objects.filter(pk=b.tutor_id).first()
            p["student_name"] = (student.full_name or student.username) if student else "?"
            p["tutor_name"] = (tutor.full_name or tutor.username) if tutor else "?"
            items.append(p)
        return Response({"requests": items})


class SessionActionView(APIView):
    """POST /api/sessions/{id}/actions/ -> {action, ...}

    confirm   (student, from Suggested; moved-time when suggested_* set)
    decline   (tutor, from Pending)
    suggest   (tutor, from Pending; new date/time/alternative/suggestion)
    cancel    (student, from Suggested)
    Idempotent: re-sending an action that already completed returns 200 with
    the current state.
    """
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request, session_id):
        user = request.user
        b = Session.objects.filter(pk=session_id).first()
        if b is None or not _visible(b):
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)

        # Participants only.
        is_mine_student = b.student_id == user.id
        is_mine_tutor = b.tutor_id == user.id
        if not (is_mine_student or is_mine_tutor):
            return Response({"error": "Not found"}, status=status.HTTP_404_NOT_FOUND)

        action = str(request.data.get("action", "")).strip()
        if action not in VALID_ACTIONS:
            return Response(
                {"action": f"Must be one of {list(VALID_ACTIONS)}"},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            if action == "confirm":
                if is_mine_student:
                    if b.status == PENDING:
                        # Student cannot act on a Pending request (web parity:
                        # "Waiting for tutor").
                        return Response(
                            {"error": "Request is awaiting the tutor."},
                            status=status.HTTP_409_CONFLICT,
                        )
                    if b.status == SUGGESTED:
                        target_date = str(request.data.get("date") or b.suggested_date or b.date)
                        target_time = str(request.data.get("time") or b.suggested_time or b.time)
                        outcome, b2, payload = bk.student_confirm_suggested(
                            b, target_date, target_time
                        )
                        return Response(payload, status=status.HTTP_200_OK)
                    if b.status == CONFIRMED:
                        return Response(
                            {"booking": bk._serialize(b), "idempotent": True}
                        )
                    return Response(
                        {"error": f"Cannot confirm from {b.status}."},
                        status=status.HTTP_409_CONFLICT,
                    )
                # Tutor confirms from Pending only (original time; the slot
                # stays reserved for life).
                if not is_mine_tutor:
                    return Response(
                        {"error": "Only a participant can confirm."},
                        status=status.HTTP_403_FORBIDDEN,
                    )
                if b.status == PENDING:
                    outcome, b2, payload = bk.tutor_confirm(b)
                    return Response(payload, status=status.HTTP_200_OK)
                if b.status == CONFIRMED:
                    return Response(
                        {"booking": bk._serialize(b), "idempotent": True}
                    )
                return Response(
                    {"error": "Only pending requests can be confirmed."},
                    status=status.HTTP_409_CONFLICT,
                )

            if action == "decline":
                if not is_mine_tutor:
                    return Response(
                        {"error": "Only the tutor declines."},
                        status=status.HTTP_403_FORBIDDEN,
                    )
                outcome, b2, payload = bk.tutor_decline(b)
                return Response(payload)

            if action == "suggest":
                if not is_mine_tutor:
                    return Response(
                        {"error": "Only the tutor suggests."},
                        status=status.HTTP_403_FORBIDDEN,
                    )
                sd = str(request.data.get("date") or b.suggested_date or b.date)
                st = str(request.data.get("time") or b.suggested_time or b.time)
                if len(sd) != 10 or len(st) != 5:
                    return Response(
                        {"date": "Use YYYY-MM-DD.", "time": "Use HH:MM."},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
                outcome, b2, payload = bk.tutor_suggest(
                    b,
                    sd,
                    st,
                    str(request.data.get("alternative", "")),
                    str(request.data.get("suggestion", "")),
                )
                return Response(payload)

            if action == "cancel":
                if not is_mine_student:
                    return Response(
                        {"error": "Only the student cancels."},
                        status=status.HTTP_403_FORBIDDEN,
                    )
                if b.status != SUGGESTED:
                    # Web parity: students cancel from Suggested only; Pending
                    # shows "Waiting for tutor".
                    return Response(
                        {"error": "Only suggested requests can be cancelled."},
                        status=status.HTTP_409_CONFLICT,
                    )
                outcome, b2, payload = bk.student_cancel(b)
                return Response(payload)
        except bk.BookingConflict as exc:
            return Response({"error": exc.message}, status=status.HTTP_409_CONFLICT)
        except bk.BookingUnavailable as exc:
            return Response(
                {"error": "Action is in progress; retry."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )
        except bk.BookingIncompatible as exc:
            return Response({"error": str(exc)}, status=status.HTTP_400_BAD_REQUEST)


# --------------------------------------------------------------------------
# Activity (derived notifications — no separate model)
# --------------------------------------------------------------------------
class ActivityListView(APIView):
    """GET /api/activity/ -> derived feed for the acting role (Sealed never
    appears; ordered by updated_at desc, limited)."""
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        user = request.user
        limit = 20
        if user.role == "tutor":
            qs = Session.objects.filter(tutor=user, status__in=ACTIVE_STATUSES).order_by(
                "-updated_at"
            )[:limit]
            items = []
            for b in qs:
                if b.status == PENDING:
                    text = f"New request from {b.student.username} ({b.subject})"
                elif b.status == SUGGESTED:
                    text = f"You suggested {b.suggested_date} {b.suggested_time} to {b.student.username}"
                elif b.status == CONFIRMED:
                    text = f"{b.student.username} confirmed {b.date} {b.time}"
                else:
                    text = f"{b.student.username} cancelled {b.date} {b.time}"
                items.append({"id": str(b.pk), "status": b.status, "text": text, "at": b.updated_at})
            return Response({"activity": items})

        # Student
        qs = Session.objects.filter(student=user, status__in=[SUGGESTED, CONFIRMED, CANCELLED]).order_by(
            "-updated_at"
        )[:limit]
        items = []
        for b in qs:
            if b.status == SUGGESTED:
                text = f"{b.tutor.full_name or b.tutor.username} suggested {b.suggested_date} {b.suggested_time}"
            elif b.status == CONFIRMED:
                text = f"{b.tutor.full_name or b.tutor.username} confirmed {b.date} {b.time}"
            else:
                text = (
                    f"Your request was rejected by {b.tutor.full_name or b.tutor.username}"
                    if b.cancelled_by == "tutor"
                    else f"You cancelled {b.date} {b.time}"
                )
            items.append(
                {"id": str(b.pk), "status": b.status, "text": text, "at": b.updated_at}
            )
        return Response({"activity": items})


# --------------------------------------------------------------------------
# Profile
# --------------------------------------------------------------------------
class ProfileView(APIView):
    """GET/PATCH /api/profile/ -> current user; PATCH edits profile fields."""
    permission_classes = [permissions.IsAuthenticated]

    EDITABLE = ("full_name", "major", "semester", "bio", "accent")

    def get(self, request):
        u = request.user
        payload = _tutor_profile(u)
        payload["role"] = u.role
        payload["email"] = u.email
        return Response(payload)

    def patch(self, request):
        u = request.user
        errors = {}
        for field in self.EDITABLE:
            if field in request.data:
                value = request.data.get(field)
                if not isinstance(value, str):
                    errors[field] = "Must be a string."
                    continue
                if len(value) > 300:
                    errors[field] = "Too long."
                    continue
                setattr(u, field, value.strip())
        subjects = request.data.get("subjects")
        if subjects is not None:
            if not isinstance(subjects, list) or not all(
                isinstance(s, str) for s in subjects
            ):
                errors["subjects"] = "Must be a list of strings."
            else:
                u.subjects = [s.strip() for s in subjects if s.strip()][:20]
        if errors:
            return Response(errors, status=status.HTTP_400_BAD_REQUEST)
        u.save()
        payload = _tutor_profile(u)
        payload["role"] = u.role
        return Response(payload)


class BecomeTutorView(APIView):
    """POST /api/profile/become-tutor/ -> promote the student account."""
    permission_classes = [permissions.IsAuthenticated]

    def post(self, request):
        u = request.user
        if u.role == "tutor":
            return Response(
                {"error": "Already a tutor."}, status=status.HTTP_409_CONFLICT
            )
        u.role = "tutor"
        u.save()
        return Response({"role": u.role})
