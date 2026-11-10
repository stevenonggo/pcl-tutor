import { modesFor } from './slots';

export function findTutor(tutors, id) {
  if (!id) return null;
  return (tutors || []).find((tutor) => tutor.id === id || tutor.tutorId === id) || null;
}

export function tutorsWithModes(tutors, availability = {}) {
  return (tutors || []).map((tutor) => ({
    ...tutor,
    modes: modesFor(availability?.[tutor.id] || {}),
  }));
}

export function visibleRequestsFor(user, requests) {
  if (!user) return [];
  if (user.role === 'student') {
    return (requests || []).filter((request) => (
      request.studentId ? request.studentId === user.id : request.studentName === user.name
    ));
  }
  return (requests || []).filter((request) => request.tutorId === user.tutorId || request.tutorId === user.id);
}

export function visibleSessionsFor(user, sessions) {
  if (!user) return [];
  if (user.role === 'student') {
    return (sessions || []).filter((session) => (
      session.studentId ? session.studentId === user.id : session.studentName === user.name
    ));
  }
  return (sessions || []).filter((session) => session.tutorId === user.tutorId || session.tutorId === user.id);
}

export function buildNotifications(user, sessions = [], requests = []) {
  if (!user) return [];

  const notifications = [];
  const visibleRequests = visibleRequestsFor(user, requests);
  const visibleSessions = visibleSessionsFor(user, sessions);

  visibleRequests
    .filter((request) => request.status === 'Pending' || request.status === 'Suggested')
    .slice(0, 3)
    .forEach((request) => {
      const suggested = request.status === 'Suggested';
      notifications.push({
        id: `request-${request.id}`,
        type: 'request',
        title: suggested ? 'Tutor suggested a new time' : 'Booking request',
        body: suggested
          ? `${request.tutorName} proposed ${request.date} at ${request.time} for ${request.subject}.`
          : `${request.studentName} requested ${request.subject} on ${request.date} at ${request.time}.`,
        time: suggested ? 'Awaiting your review' : 'Pending',
      });
    });

  visibleSessions
    .filter((session) => session.status === 'Confirmed')
    .slice(0, 2)
    .forEach((session) => {
      notifications.push({
        id: `session-${session.id}`,
        type: 'session',
        title: 'Session confirmed',
        body: `${session.subject} is confirmed for ${session.date} at ${session.time}.`,
        time: 'Confirmed',
      });
    });

  return notifications.slice(0, 5);
}
