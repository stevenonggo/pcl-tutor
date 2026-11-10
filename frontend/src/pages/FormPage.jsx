import React, { useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import Avatar from '../components/Avatar';
import ConfirmDialog from '../components/ConfirmDialog';
import SelectField from '../components/SelectField';
import { Icon } from '../components/icons';
import { CAMPUS_SPOTS, findSlot, indefiniteArticle, makeSlot, slotKey } from '../lib/slots';
import { blockImplicitSubmit } from '../lib/forms';

// A custom-time request is a request, not a booking, so the student is only proposing a
// starting point and the tutor still confirms it. An input[type=time] would be the
// obvious control, but its value is edited through a clock face that the OS paints: an
// unstyled blue list that ignores the app's surfaces and reads nothing like the rest of
// the form, and which cannot be themed from the page at all. Hourly chips are the same
// precision the tutor's own published slots use, so nothing real is given up, and they
// stay inside the document where the theme tokens apply.
const CUSTOM_TIME_CHOICES = ['09:00', '10:00', '11:00', '13:00', '14:00', '15:00', '16:00', '17:00'];

// A published slot is a fixed commitment the tutor already made, so the student cannot
// change its mode or invent a different meeting place. Only a custom-time request may
// propose Offline and a location, and the tutor confirms that one. The list comes from
// App state, so a slot the tutor removed this session disappears here too.
function slotsForDate(availability, tutorId, date) {
  return [...(availability?.[tutorId]?.[date] || [])].sort((a, b) => a.time.localeCompare(b.time));
}

export default function FormPage({ user, requests, tutors = [], availability, onCreateSession, onAddAvailability, onRequestAction }) {
  const params = new URLSearchParams(useLocation().search);
  const mode = params.get('mode');
  if (user.role === 'tutor' && mode === 'suggest') return <SuggestTimeForm requestId={params.get('request')} requests={requests} onRequestAction={onRequestAction} />;
  if (user.role === 'student' && mode === 'review') return <ReviewSuggestionForm requestId={params.get('request')} requests={requests} onRequestAction={onRequestAction} />;
  const isTutor = user.role === 'tutor';
  return isTutor
    ? <AvailabilityForm onAddAvailability={onAddAvailability} availability={availability} tutorId={user.tutorId} />
    : <BookingForm tutors={tutors} onCreateSession={onCreateSession} availability={availability} />;
}

function BookingForm({ tutors = [], onCreateSession, availability = {} }) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const tutorId = params.get('tutor') || tutors[0]?.id || '';
  const initialTutor = tutors.find((item) => item.id === tutorId) || tutors[0] || null;
  const [tutor, setTutor] = useState(initialTutor?.id || '');
  const tutorData = useMemo(
    () => tutors.find((item) => item.id === tutor) || tutors[0] || null,
    [tutor, tutors],
  );
  const [subject, setSubject] = useState(tutorData?.subjects?.[0] || '');
  const [topic, setTopic] = useState('');
  const [date, setDate] = useState(params.get('date') || Object.keys(availability[tutorData?.id] || {})[0] || '');
  const [time, setTime] = useState(params.get('time') || '');
  const [mode, setMode] = useState('Online');
  const [notes, setNotes] = useState('');
  const [custom, setCustom] = useState(params.get('custom') === '1');
  const [customTime, setCustomTime] = useState('');
  const [locationText, setLocationText] = useState('');
  const [error, setError] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [review, setReview] = useState(null);

  const availableDates = Object.keys(availability[tutorData?.id] || {});
  const availableTimes = date ? slotsForDate(availability, tutorData?.id, date) : [];
  const chosenTime = custom ? customTime : time;

  // The published slot is the source of truth for a fixed booking: it carries the mode
  // and the room the tutor set, so the student sees exactly what was agreed. A custom
  // request uses the student's own choice instead. Deriving both keeps the live
  // summary, the validation, and the submitted payload from ever disagreeing.
  const selectedSlot = custom ? null : findSlot(availableTimes, time);
  const effectiveMode = custom ? mode : (selectedSlot?.mode || 'Online');
  const effectiveLocation = custom
    ? (mode === 'Offline' ? locationText.trim() : '')
    : (selectedSlot?.location || '');

  // Switching schedule type clears whatever only applied to the one being left,
  // so a place typed for a custom request never follows the student onto a
  // published slot.
  const chooseSchedule = (nextCustom) => {
    setCustom(nextCustom);
    setMode('Online');
    setLocationText('');
    if (nextCustom) setTime('');
    else setCustomTime('');
    setError('');
  };

  const handleTutorChange = (nextTutor) => {
    const next = tutors.find((item) => item.id === nextTutor) || tutors[0];
    if (!next) return;
    setTutor(next.id);
    setSubject(next.subjects?.[0] || '');
    setDate(Object.keys(availability[next.id] || {})[0] || '');
    setTime('');
    setCustomTime('');
    setMode('Online');
    setLocationText('');
    setError('');
  };

  const submit = (event) => {
    event.preventDefault();
    if (!tutorData) return setError('Choose a tutor first.');
    if (!subject) return setError('Choose a subject.');
    if (!topic.trim()) return setError('Tell the tutor what you want help with.');
    if (!date) return setError('Choose a date.');
    if (custom && !chosenTime) return setError('Choose a preferred custom time.');
    // A stale ?time= in the URL can name a slot the tutor no longer publishes, so the
    // slot itself has to resolve before anything is submitted.
    if (!custom && !selectedSlot) return setError('Choose one of the available slots.');
    if (custom && mode === 'Offline' && !locationText.trim()) return setError('Add a meeting location for an offline session.');

    // Sending is not destructive, but it is immediate and the student may still want to
    // change something, so the payload is reviewed before it leaves the form.
    setReview({
      tutorName: tutorData.name,
      subject,
      topic: topic.trim(),
      date,
      time: chosenTime,
      mode: effectiveMode,
      location: effectiveLocation,
      type: custom ? 'Custom request' : 'Published slot',
      notes: notes.trim(),
    });
  };

  const sendRequest = () => {
    onCreateSession({
      tutorId: tutor,
      tutorName: tutorData.name,
      subject,
      topic: topic.trim(),
      date,
      time: chosenTime,
      mode: effectiveMode,
      notes: notes.trim(),
      location: effectiveLocation,
      custom,
      status: 'Pending',
    });
    setReview(null);
    setSubmitted(true);
  };

  if (!tutorData) {
    return <div className="form-page"><div className="empty-state large"><Icon name="users" size={24} /><strong>No tutors available yet.</strong><span>A tutor needs to register before a session can be requested.</span><Link className="ghost-button" to="/find">Back to tutor library</Link></div></div>;
  }

  if (submitted) {
    return <div className="form-page"><div className="form-success"><div className="success-mark"><Icon name="check" size={24} /></div><span className="eyebrow">Request submitted</span><h1>You're on the tutor's radar.</h1><p>Your request to {tutorData.name} is now <strong>Pending</strong>. The new entry has been added to your dashboard.</p><div className="success-summary"><div><span>Subject</span><strong>{subject}</strong></div><div><span>When</span><strong>{date} · {chosenTime}</strong></div><div><span>Mode</span><strong>{effectiveMode}</strong></div>{effectiveLocation && <div><span>Location</span><strong>{effectiveLocation}</strong></div>}</div><div className="success-actions"><button className="primary-button" onClick={() => navigate('/')}>Go to dashboard</button><Link className="secondary-button" to={`/tutor/${tutorData.id}`}>View tutor</Link></div></div></div>;
  }

  return (
    <div className="form-page">
      <div className="form-header"><div><span className="eyebrow">Form page · main use case</span><h1>Request a tutoring session.</h1><p>Pick a tutor, choose a visible slot or ask for a custom time, then describe what you need help with.</p></div><button className="back-button" onClick={() => navigate(-1)}><Icon name="arrowLeft" size={16} /> Back</button></div>
      <form className="booking-layout" onSubmit={submit} onKeyDown={blockImplicitSubmit}>
        <section className="form-card">
          <div className="form-section"><div className="form-section-head"><span className="form-step">01</span><div><h2>Tutor & subject</h2><p>Start with the person who can help.</p></div></div>
            <div className="field-grid"><SelectField label="Tutor" value={tutor} onChange={handleTutorChange} options={tutors.map((item) => ({ value: item.id, label: item.name }))} /><SelectField label="Subject" value={subject} onChange={setSubject} options={tutorData.subjects || []} /></div>
            <div className="mini-profile"><Avatar initials={tutorData.initials} accent={tutorData.accent} /><div><strong>{tutorData.name}</strong><span>{tutorData.rating} rating · {tutorData.sessions} sessions · {tutorData.participantsToday} today</span></div><Link className="text-link" to={`/tutor/${tutorData.id}`}>Profile <Icon name="arrowRight" size={14} /></Link></div>
          </div>

          <div className="form-section"><div className="form-section-head"><span className="form-step">02</span><div><h2>Schedule</h2><p>Use a visible slot or make a request.</p></div></div>
            <div className="choice-row"><button type="button" className={`choice-button ${!custom ? 'selected' : ''}`} onClick={() => chooseSchedule(false)}>Available slot<span>Pick what the tutor already published.</span></button><button type="button" className={`choice-button ${custom ? 'selected' : ''}`} onClick={() => chooseSchedule(true)}>Custom time<span>Ask the tutor to fit you in.</span></button></div>
            <div className={`field-grid ${custom ? 'custom-schedule-grid' : ''}`}>{custom ? <label className="native-datetime">Date<input type="date" value={date} onChange={(event) => { setDate(event.target.value); setCustomTime(''); }} /></label> : <SelectField label="Date" value={date} onChange={(next) => { setDate(next); if (custom) setCustomTime(''); else setTime(''); }} options={availableDates.map((item) => ({ value: item, label: new Intl.DateTimeFormat('en', { weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(`${item}T12:00:00`)) }))} />}{!custom && <SelectField label="Available time" variant="dropdown" value={time} onChange={setTime} options={availableTimes.map((slot) => ({ value: slot.time, label: `${slot.time} · ${slot.mode}${slot.mode === 'Offline' ? ` · ${slot.location}` : ''}` }))} placeholder="Select a slot" />}
              {custom && <div className="custom-time-field">
                <span className="field-label" id="custom-time-label">Preferred time</span>
                <div className="custom-time-grid" role="radiogroup" aria-labelledby="custom-time-label">
                  {CUSTOM_TIME_CHOICES.map((item) => (
                    <button
                      key={item}
                      type="button"
                      role="radio"
                      aria-checked={customTime === item}
                      className={`custom-time-chip ${customTime === item ? 'selected' : ''}`}
                      onClick={() => setCustomTime(item)}
                    >
                      {item}
                    </button>
                  ))}
                </div>
                <p className="field-hint">The tutor can accept, move, or suggest a different time for this request.</p>
              </div>}</div>
            {custom && <div className="inline-note"><Icon name="spark" size={15} />The tutor can accept, decline, or suggest another time for this request.</div>}
            {custom ? <div className="field-grid"><div><span className="field-label">Session mode</span><div className="mode-toggle">{['Online', 'Offline'].map((item) => <button key={item} type="button" className={mode === item ? 'selected' : ''} onClick={() => setMode(item)}>{item}</button>)}</div></div>{mode === 'Offline' && <label>Location<input value={locationText} onChange={(event) => setLocationText(event.target.value)} placeholder="e.g. Library study zone" /></label>}</div> : <div className="locked-schedule-note"><Icon name="check" size={15} /><span>{selectedSlot ? <>This published slot is <strong>{selectedSlot.mode}</strong>{selectedSlot.mode === 'Offline' ? <> at <strong>{selectedSlot.location}</strong></> : null}. The mode and meeting place are set by the tutor, so they cannot be changed here — pick <strong>Custom time</strong> if you need a different arrangement.</> : <>Pick one of the tutor&rsquo;s published slots. Their mode and meeting place are set by the tutor, so they cannot be changed here — pick <strong>Custom time</strong> to request a different arrangement.</>}</span></div>}
          </div>

          <div className="form-section"><div className="form-section-head"><span className="form-step">03</span><div><h2>What do you need help with?</h2><p>A little context helps the tutor prepare.</p></div></div><label>Topic<textarea value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="e.g. I can calculate eigenvalues but don't understand what they mean visually." rows={4} /></label><label>Additional notes <span className="optional">Optional</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Anything else the tutor should know?" rows={3} /></label></div>

          {error && <div className="form-error large"><Icon name="x" size={17} /><span>{error}</span></div>}
          <div className="form-submit-row"><span className="submit-hint">Your request will appear as Pending on the dashboard.</span><button className="primary-button" type="submit">Submit request <Icon name="arrowRight" size={16} /></button></div>
        </section>

        <aside className="form-summary"><span className="eyebrow">Live summary</span><h2>{tutorData.name}</h2><p>{subject}</p><div className="summary-line"><span>When</span><strong>{date || 'Choose a date'}{chosenTime ? ` · ${chosenTime}` : ''}</strong></div><div className="summary-line"><span>Mode</span><strong>{effectiveMode}</strong></div><div className="summary-line"><span>Type</span><strong>{custom ? 'Custom request' : 'Available slot'}</strong></div>{effectiveLocation && <div className="summary-line"><span>Location</span><strong>{effectiveLocation}</strong></div>}<div className="summary-rule" /><p className="summary-copy">{custom ? 'The tutor will review your preferred time before the session is confirmed.' : 'This slot is already published by the tutor, so your request is easier to confirm.'}</p></aside>
      </form>

      <ConfirmDialog
        open={Boolean(review)}
        tone="default"
        title="Send this request?"
        description={review ? (
          <>
            <p>Check the details below. Nothing is sent until you confirm, so you can still go back and change something.</p>
            <div className="confirm-summary">
              <div className="summary-line"><span>Tutor</span><strong>{review.tutorName}</strong></div>
              <div className="summary-line"><span>Subject</span><strong>{review.subject}</strong></div>
              <div className="summary-line"><span>Topic</span><strong>{review.topic}</strong></div>
              <div className="summary-line"><span>When</span><strong>{review.date} · {review.time}</strong></div>
              <div className="summary-line"><span>Mode</span><strong>{review.mode}</strong></div>
              {review.location && <div className="summary-line"><span>Location</span><strong>{review.location}</strong></div>}
              <div className="summary-line"><span>Type</span><strong>{review.type}</strong></div>
            </div>
            {review.mode === 'Offline' && <p className="inline-note">The tutor confirms the final time before the session is set.</p>}
          </>
        ) : ''}
        confirmLabel="Send request"
        onConfirm={sendRequest}
        onCancel={() => setReview(null)}
      />
    </div>
  );
}


function SuggestTimeForm({ requestId, requests, onRequestAction }) {
  const navigate = useNavigate();
  // Exact match only. Falling back to "the first request" would let a stale link
  // send a tutor's reply to the wrong student.
  const request = requests.find((item) => item.id === requestId);
  const [date, setDate] = useState(request?.date || '');
  const [time, setTime] = useState(request?.time || '');
  const [alternative, setAlternative] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [review, setReview] = useState(null);

  if (!request) {
    return <div className="form-page"><div className="empty-state large"><strong>Request not found</strong><span>This request is no longer in your list, so there is nobody to reply to. It may already have been decided.</span><button className="ghost-button" onClick={() => navigate('/requests')}>Back to requests</button></div></div>;
  }

  const submit = (event) => {
    event.preventDefault();
    if (!date || !time) return setError('Choose the new date and time.');
    // Sent as `suggestion`, not `message`, so the student's original request text is
    // kept and the two sides of the booking can never describe it differently.
    setReview({ date, time, alternative, suggestion: message.trim() });
  };

  const sendSuggestion = () => {
    onRequestAction(request.id, 'suggested', review);
    setReview(null);
    setSaved(true);
  };
  if (saved) return <div className="form-page"><div className="form-success"><div className="success-mark"><Icon name="check" size={24} /></div><span className="eyebrow">Suggestion sent</span><h1>The student now has your proposed time.</h1><p>The request remains pending until the final session time is agreed.</p><div className="success-summary"><div><span>Student</span><strong>{request.studentName}</strong></div><div><span>Subject</span><strong>{request.subject}</strong></div><div><span>Suggested</span><strong>{date} · {time}</strong></div></div><button className="primary-button" onClick={() => navigate('/')}>Back to tutor dashboard <Icon name="arrowRight" size={15} /></button></div></div>;
  return <div className="form-page"><div className="form-header"><div><span className="eyebrow">Tutor response</span><h1>Suggest another time.</h1><p>Keep the original request visible while proposing a schedule that fits your availability.</p></div><button className="back-button" onClick={() => navigate('/')}><Icon name="arrowLeft" size={16}/> Back</button></div><form className="booking-layout" onSubmit={submit} onKeyDown={blockImplicitSubmit}><section className="form-card"><div className="form-section"><div className="form-section-head"><span className="form-step">01</span><div><h2>Request</h2><p>{request.studentName} · {request.subject}</p></div></div><div className="detail-note"><strong>{request.date} · {request.time} · {request.mode}</strong><p>{request.message}</p></div></div><div className="form-section"><div className="form-section-head"><span className="form-step">02</span><div><h2>Your proposal</h2><p>Give the student one clear alternative and an optional backup.</p></div></div><div className="field-grid"><label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Time<input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label><label>Alternative time <span className="optional">Optional</span><input type="time" value={alternative} onChange={(event) => setAlternative(event.target.value)} /></label></div><label>Message<textarea value={message} onChange={(event) => setMessage(event.target.value)} rows={4} placeholder="Explain briefly why the new time works better." /></label></div>{error && <div className="form-error large"><Icon name="x" size={17}/><span>{error}</span></div>}<div className="form-submit-row"><span className="submit-hint">Nothing is confirmed yet. The request stays Pending.</span><button className="primary-button" type="submit">Send suggestion <Icon name="arrowRight" size={15}/></button></div></section><aside className="form-summary"><span className="eyebrow">Request summary</span><h2>{request.studentName}</h2><p>{request.subject}</p><div className="summary-line"><span>Original</span><strong>{request.date} · {request.time}</strong></div><div className="summary-line"><span>New proposal</span><strong>{date} · {time}</strong></div></aside></form>

      <ConfirmDialog
        open={Boolean(review)}
        tone="default"
        title="Send this suggestion?"
        description={review ? (
          <>
            <p>{request.studentName} is not told anything until you confirm.</p>
            <div className="confirm-summary">
              <div className="summary-line"><span>Student</span><strong>{request.studentName}</strong></div>
              <div className="summary-line"><span>Subject</span><strong>{request.subject}</strong></div>
              <div className="summary-line"><span>Was</span><strong>{request.date} · {request.time}</strong></div>
              <div className="summary-line"><span>New time</span><strong>{review.date} · {review.time}</strong></div>
              {review.alternative && <div className="summary-line"><span>Backup</span><strong>{review.alternative}</strong></div>}
              {review.suggestion && <div className="summary-line"><span>Message</span><strong>{review.suggestion}</strong></div>}
            </div>
            <p className="inline-note">The request stays Pending until the student accepts.</p>
          </>
        ) : ''}
        confirmLabel="Send suggestion"
        onConfirm={sendSuggestion}
        onCancel={() => setReview(null)}
      />
      </div>;
}

function ReviewSuggestionForm({ requestId, requests, onRequestAction }) {
  const navigate = useNavigate();
  // Exact match only, for the same reason as the tutor form: accepting must never
  // resolve to a different suggestion than the one the student was shown.
  const request = requests.find((item) => item.id === requestId);
  const [confirming, setConfirming] = useState(false);
  if (!request) return <div className="form-page"><div className="empty-state large"><strong>Suggestion not found</strong><span>The request may already have been decided, or it belongs to a different account.</span><button className="ghost-button" onClick={() => navigate('/requests')}>Back to requests</button></div></div>;
  const accept = () => { onRequestAction(request.id, 'confirmed'); navigate('/'); };
  return <div className="form-page"><div className="form-header"><div><span className="eyebrow">Suggested time</span><h1>Review the tutor's new time.</h1><p>{request.tutorName || 'Your tutor'} proposed a different schedule. Review it before the session is confirmed.</p></div><button className="back-button" onClick={() => navigate('/')}><Icon name="arrowLeft" size={16}/> Back</button></div><div className="booking-layout"><section className="form-card"><div className="form-section"><div className="form-section-head"><span className="form-step">01</span><div><h2>{request.subject}</h2><p>{request.topic}</p></div></div><div className="detail-note"><strong>Suggested: {request.date} · {request.time}</strong><p>{request.suggestion || 'The tutor suggested another time for this request.'}</p></div>{request.message && <div className="inline-note"><Icon name="users" size={15} /><span>Your original request is kept: <strong>{request.message}</strong></span></div>}{request.alternative && <div className="inline-note"><Icon name="calendar" size={15}/><span>Optional backup time: <strong>{request.alternative}</strong></span></div>}</div><div className="form-submit-row"><span className="submit-hint">Accepting this suggestion changes the request and matching session to Confirmed.</span><div className="success-actions"><button className="ghost-button" type="button" onClick={() => navigate('/')}>Keep open</button><button className="primary-button" type="button" onClick={() => setConfirming(true)}>Accept new time <Icon name="check" size={15}/></button></div></div></section><aside className="form-summary"><span className="eyebrow">Tutor response</span><h2>{request.tutorName}</h2><p>{request.subject}</p><div className="summary-line"><span>New time</span><strong>{request.date} · {request.time}</strong></div><div className="summary-line"><span>Mode</span><strong>{request.mode}</strong></div></aside></div>

      <ConfirmDialog
        open={confirming}
        tone="default"
        title="Accept this new time?"
        description={(
          <>
            <p>Accepting confirms the request and its session. This time replaces the one you originally asked for.</p>
            <div className="confirm-summary">
              <div className="summary-line"><span>Tutor</span><strong>{request.tutorName}</strong></div>
              <div className="summary-line"><span>Subject</span><strong>{request.subject}</strong></div>
              <div className="summary-line"><span>Confirmed time</span><strong>{request.date} · {request.time}</strong></div>
              <div className="summary-line"><span>Mode</span><strong>{request.mode}</strong></div>
              {request.location && <div className="summary-line"><span>Location</span><strong>{request.location}</strong></div>}
              {request.alternative && <div className="summary-line"><span>Dropped backup</span><strong>{request.alternative}</strong></div>}
            </div>
            <p className="inline-note">Both sides move to Confirmed. There is no further step.</p>
          </>
        )}
        confirmLabel="Accept new time"
        onConfirm={accept}
        onCancel={() => setConfirming(false)}
      />
    </div>;
}

function AvailabilityForm({ onAddAvailability, availability = {}, tutorId }) {
  const navigate = useNavigate();
  const [date, setDate] = useState(() => Object.keys(availability?.[tutorId] || {}).sort()[0] || '');
  const [time, setTime] = useState('09:00');
  const [duration, setDuration] = useState('60');
  const [mode, setMode] = useState('Online');
  const [location, setLocation] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  // Switching format clears a room typed for the other one, so an in-person place
  // cannot be attached to an online slot.
  const chooseMode = (next) => {
    setMode(next);
    if (next === 'Online') setLocation('');
    setError('');
  };

  const submit = (event) => {
    event.preventDefault();
    if (!date || !time) return setError('Choose a date and start time.');
    if (mode === 'Offline' && !location.trim()) return setError('Add a meeting room for an in-person slot.');
    const slot = makeSlot({ time, mode, location: location.trim(), duration: Number(duration) });
    // App ignores a slot that is already published, so report it instead of silently
    // doing nothing when the tutor presses the button twice.
    if ((availability[tutorId]?.[date] || []).some((item) => slotKey(item) === slotKey(slot))) {
      return setError(`You already have ${indefiniteArticle(mode)} ${mode.toLowerCase()} slot at ${time} on ${date}.`);
    }
    onAddAvailability(tutorId, date, slot);
    setSaved(true);
  };

  if (saved) return <div className="form-page"><div className="form-success"><div className="success-mark"><Icon name="check" size={24} /></div><span className="eyebrow">Availability updated</span><h1>Your new slot is ready.</h1><p>The slot has been added to the tutor workspace.</p><div className="success-summary"><div><span>Date</span><strong>{date}</strong></div><div><span>Time</span><strong>{time} · {duration} minutes</strong></div><div><span>Mode</span><strong>{mode}</strong></div>{mode === 'Offline' && <div><span>Room</span><strong>{location.trim()}</strong></div>}</div><button className="primary-button" onClick={() => navigate('/')}>Back to tutor dashboard</button></div></div>;

  return (
    <div className="form-page">
      <div className="form-header"><div><span className="eyebrow">Form page · tutor flow</span><h1>Add an availability slot.</h1><p>Publish one more time that students can discover from your profile.</p></div><button className="back-button" onClick={() => navigate(-1)}><Icon name="arrowLeft" size={16} /> Back</button></div>
      <form className="availability-form card-surface" onSubmit={submit} onKeyDown={blockImplicitSubmit}><div className="form-section"><div className="form-section-head"><span className="form-step">01</span><div><h2>Schedule</h2><p>Choose when the slot opens.</p></div></div><div className="field-grid"><label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><label>Start time<input type="time" value={time} onChange={(event) => setTime(event.target.value)} /></label><SelectField label="Duration" value={duration} onChange={setDuration} options={[{ value: '30', label: '30 minutes' }, { value: '60', label: '60 minutes' }, { value: '90', label: '90 minutes' }]} /></div></div><div className="form-section"><div className="form-section-head"><span className="form-step">02</span><div><h2>Mode</h2><p>Tell students how this slot works.</p></div></div><div className="mode-toggle wide">{['Online', 'Offline'].map((item) => <button type="button" className={mode === item ? 'selected' : ''} key={item} onClick={() => chooseMode(item)}>{item}</button>)}</div>{mode === 'Offline' && <label className="field-block">Meeting room<input list="campus-spots" value={location} onChange={(event) => setLocation(event.target.value)} placeholder="e.g. Library study zone, 2nd floor" /><datalist id="campus-spots">{CAMPUS_SPOTS.map((spot) => <option value={spot} key={spot} />)}</datalist></label>}</div>{error && <div className="form-error large"><Icon name="x" size={17} /><span>{error}</span></div>}<div className="form-submit-row"><span className="submit-hint">This new slot will be added to your availability list.</span><button className="primary-button" type="submit">Publish slot <Icon name="arrowRight" size={16} /></button></div></form>
    </div>
  );
}
