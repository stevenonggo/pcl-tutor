/**
 * Shared API types for the PCL Tutor mobile app.
 * The shapes mirror the Django REST framework responses in ../backend.
 */

export type UserRole = 'student' | 'tutor';
export type BookingStatus = 'Pending' | 'Suggested' | 'Confirmed' | 'Cancelled' | 'Sealed';
export type BookingMode = 'Online' | 'Offline';

/** Public user payload returned by GET /api/me/ and POST /api/register/. */
export interface ApiUser {
  id: string;
  username: string;
  email: string;
}

/** JWT token pair returned by POST /api/login/ (SimpleJWT TokenObtainPairView). */
export interface AuthTokens {
  access: string;
  refresh: string;
}

/** Credentials accepted by POST /api/login/. */
export interface LoginPayload {
  username: string;
  password: string;
}

/**
 * Payload for POST /api/register/. The backend serializer enforces a minimum
 * password length of 8 characters; keep client-side validation aligned.
 */
export interface RegisterPayload {
  username: string;
  email: string;
  password: string;
}

/** Full profile returned by GET/PATCH /api/profile/. */
export interface Profile {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  full_name: string;
  major: string;
  semester: string;
  bio: string;
  subjects: string[];
  accent: string;
  rating: number;
  sessions_count: number;
  is_demo: boolean;
}

/** Fields the profile PATCH endpoint accepts. */
export interface ProfileUpdatePayload {
  full_name?: string;
  major?: string;
  semester?: string;
  bio?: string;
  accent?: string;
  subjects?: string[];
}

/** Tutor directory entry returned by GET /api/tutors/. */
export interface TutorSummary {
  id: string;
  username: string;
  full_name: string;
  major: string;
  semester: string;
  bio: string;
  subjects: string[];
  accent: string;
  rating: number;
  sessions_count: number;
  is_demo: boolean;
  open_slots_next_7d: number;
}

/** A published availability slot. */
export interface AvailabilitySlot {
  id: string;
  date: string;
  time: string;
  mode: BookingMode;
  location: string;
  duration: number;
  reserved: boolean;
  reserved_session: string | null;
}

/** Tutor detail returned by GET /api/tutors/{id}/. */
export interface TutorDetail extends TutorSummary {
  slots: AvailabilitySlot[];
}

/** Payload accepted by POST /api/availability/. */
export interface CreateSlotPayload {
  date: string;
  time: string;
  mode: BookingMode;
  location?: string;
  duration?: number;
}

/** A booking document (request and session share this shape). */
export interface Booking {
  id: string;
  student: string;
  tutor: string;
  subject: string;
  topic: string;
  notes: string;
  date: string;
  time: string;
  mode: BookingMode;
  location: string;
  duration: number;
  slot: string | null;
  custom: boolean;
  status: BookingStatus;
  display_status: string;
  cancelled_by: string;
  suggested_date: string;
  suggested_time: string;
  alternative: string;
  suggestion: string;
  /** Present on GET /api/requests/ only. */
  student_name?: string;
  /** Present on GET /api/requests/ only. */
  tutor_name?: string;
}

/** Published-slot booking payload for POST /api/sessions/. */
export interface BookingPublishedPayload {
  slot_id: string;
  subject: string;
  topic?: string;
  notes?: string;
  client_token: string;
  custom?: false;
}

/** Custom-time booking payload for POST /api/sessions/. */
export interface BookingCustomPayload {
  tutor: string;
  subject: string;
  topic?: string;
  notes?: string;
  date: string;
  time: string;
  mode: BookingMode;
  location?: string;
  client_token: string;
  custom: true;
}

export type BookingPayload = BookingPublishedPayload | BookingCustomPayload;

export type BookingActionResult = 'confirm' | 'decline' | 'suggest' | 'cancel';

export interface BookingActionPayload {
  action: BookingActionResult;
  date?: string;
  time?: string;
  alternative?: string;
  suggestion?: string;
}

/** One derived notification from GET /api/activity/. */
export interface ActivityItem {
  id: string;
  status: BookingStatus;
  text: string;
  at: string | null;
}

export type StudyPlanLevel = 'Beginner' | 'Intermediate' | 'Advanced';

export interface StudyPlanSettings {
  subject: string;
  topic?: string;
  /** Clamped by the backend to 1..4 weeks. */
  weeks: number;
  level: StudyPlanLevel;
  goal: string;
  /** Human-readable weekly time budget, e.g. "Moderate (~5 h/week)". */
  cadence: string;
}

export interface StudyPhase {
  index: number;
  title: string;
  topics: string[];
  activities: string[];
  milestone: string;
}

/** Normalized study plan; the UI only depends on this shape. */
export interface StudyPlan {
  firstSteps: string[];
  phases: StudyPhase[];
  tip: string;
  /** Model identifier returned by the OpenRouter proxy (informational). */
  model?: string;
  /** Which source produced the plan ("openrouter" from the backend today). */
  source?: string;
  /** Short attribution line shown under the generated plan. */
  disclaimer?: string;
}
