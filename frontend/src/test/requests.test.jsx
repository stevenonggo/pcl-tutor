import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { INITIAL_REQUESTS, INITIAL_SESSIONS } from '../data/mockData';
import { STORAGE_KEYS, writeJson } from '../lib/storage';
import { STUDENT, TUTOR, cancelDialog, confirmDialog, renderApp, signInAs } from './helpers';

// Nathan's own seeded request, read from the data rather than hardcoded so the suite
// survives a change to the schedule seed.
const OWN_REQUEST = INITIAL_REQUESTS.find((item) => item.id === 'sr1');

// Requests used to live in two parallel arrays, so the tutor never saw Nathan's
// own request and "Accept" updated a session id that did not exist.
describe('request decisions', () => {
  beforeEach(() => {
    localStorage.clear();
    // The requests page reads from the local db, so the seeded demo records
    // have to be written where the app reads them.
    writeJson(STORAGE_KEYS.db, {
      students: [],
      tutors: [],
      sessions: INITIAL_SESSIONS,
      requests: INITIAL_REQUESTS,
      availability: {},
    });
  });

  it('shows the tutor all three seeded requests, including the student own', async () => {
    signInAs(TUTOR);
    renderApp('/requests');

    expect(await screen.findByText('Mikaela Putri')).toBeInTheDocument();
    expect(screen.getByText('Jason Tan')).toBeInTheDocument();
    expect(screen.getByText('Nathan Andrew')).toBeInTheDocument();
  });

  it('shows a student only their own request', async () => {
    signInAs(STUDENT);
    renderApp('/requests');

    expect(await screen.findByText('Programming Fundamentals')).toBeInTheDocument();
    expect(screen.queryByText('Mikaela Putri')).not.toBeInTheDocument();
    expect(screen.queryByText('Jason Tan')).not.toBeInTheDocument();
  });

  it('propagates an Accept to the matching session', async () => {
    signInAs(TUTOR);
    const user = userEvent.setup();
    renderApp('/requests');

    const card = (await screen.findByText('Mikaela Putri')).closest('article');
    await user.click(within(card).getByRole('button', { name: 'Accept' }));

    // The request moved into the decided history as Confirmed.
    expect(await screen.findByText('Past decisions')).toBeInTheDocument();
    const history = screen.getByText('Past decisions').closest('section');
    expect(within(history).getByText('Confirmed')).toBeInTheDocument();
  });

  // A decline cannot be undone from either side, so it has to be confirmed first.
  it('asks before declining and keeps the request when cancelled', async () => {
    signInAs(TUTOR);
    const user = userEvent.setup();
    renderApp('/requests');

    const card = (await screen.findByText('Mikaela Putri')).closest('article');
    await user.click(within(card).getByRole('button', { name: 'Decline' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/decline this request/i);
    expect(dialog).toHaveTextContent(/moves to declined/i);

    // Cancelling leaves the request exactly where it was.
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Mikaela Putri')).toBeInTheDocument();
    expect(screen.queryByText('Past decisions')).not.toBeInTheDocument();
  });

  it('declines the request and its session once confirmed', async () => {
    signInAs(TUTOR);
    const user = userEvent.setup();
    renderApp('/requests');

    const card = (await screen.findByText('Mikaela Putri')).closest('article');
    await user.click(within(card).getByRole('button', { name: 'Decline' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: /decline request/i }));

    const history = await screen.findByText('Past decisions');
    expect(within(history.closest('section')).getByText('Rejected')).toBeInTheDocument();
  });

  // Accepting is easy to reverse by asking the student, so it stays a single click.
  it('does not ask for confirmation when accepting', async () => {
    signInAs(TUTOR);
    const user = userEvent.setup();
    renderApp('/requests');

    const card = (await screen.findByText('Mikaela Putri')).closest('article');
    await user.click(within(card).getByRole('button', { name: 'Accept' }));

    expect(await screen.findByText('Past decisions')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  // A student has no Cancel button on a request the tutor has not answered yet, so
  // this locks the current behaviour: only the tutor can decide a pending request.
  it('leaves a pending student request waiting rather than offering a cancel', async () => {
    signInAs(STUDENT);
    renderApp('/requests');

    expect(await screen.findByText(/waiting for tutor/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /cancel request/i })).not.toBeInTheDocument();
  });

  // The whole round trip in one mounted app, because requests live in React state
  // rather than localStorage: tutor suggests, student logs in and accepts.
  it('completes the Suggest time then Review suggestion round trip', async () => {
    signInAs(TUTOR);
    const user = userEvent.setup();
    const app = renderApp('/requests');

    // Suggest a new time on Nathan's request (sr1), the one the student owns.
    const card = (await screen.findByText('Nathan Andrew')).closest('article');
    await user.click(within(card).getByRole('button', { name: /suggest time/i }));

    // The tutor is now on the dedicated suggest form for that exact request.
    expect(await screen.findByText(/Suggest another time/i)).toBeInTheDocument();
    // A time input is driven with a change event; character typing is unreliable.
    fireEvent.change(screen.getByLabelText(/^time$/i), { target: { value: '16:00' } });
    await user.click(screen.getByRole('button', { name: /send suggestion/i }));

    // The proposal is reviewed first, and the student's original ask is shown as the
    // "was" line so the tutor can see exactly what is being rescheduled.
    const suggestDialog = await screen.findByRole('dialog');
    expect(suggestDialog).toHaveTextContent(/send this suggestion/i);
    expect(suggestDialog).toHaveTextContent(`${OWN_REQUEST.date} · 16:00`);
    expect(suggestDialog).toHaveTextContent(OWN_REQUEST.studentName);
    expect(screen.queryByText(/Suggestion sent/i)).not.toBeInTheDocument();

    await confirmDialog(user, /send suggestion/i);
    expect(await screen.findByText(/Suggestion sent/i)).toBeInTheDocument();
    expect(screen.getByText(`${OWN_REQUEST.date} · 16:00`)).toBeInTheDocument();

    // Hand over to the student in the same session. Logging out is destructive, so it
    // waits for a confirmation instead of happening on the first click.
    await user.click(screen.getByRole('button', { name: /back to tutor dashboard/i }));
    await user.click(await screen.findByRole('button', { name: 'Log out' }));
    const logoutDialog = await screen.findByRole('dialog');
    expect(within(logoutDialog).getByText(/log out of pcl tutor/i)).toBeInTheDocument();
    await user.click(within(logoutDialog).getByRole('button', { name: 'Log out' }));

    // Sign-in now goes through the backend email/password form, so the test
    // simulates a successful student sign-in the way the app persists it:
    // write the stored user key, then mount a fresh app. The local db (with
    // the suggested request) survives that handoff — that is the point of
    // this test.
    app.unmount();
    localStorage.setItem(STORAGE_KEYS.legacyUser, JSON.stringify(STUDENT));
    renderApp('/');
    expect(await screen.findByText(/Find help that fits your schedule/i)).toBeInTheDocument();

    // The student now sees the suggested request and can open it by id.
    await user.click(screen.getByRole('link', { name: /requests/i }));
    const review = (await screen.findByRole('button', { name: /review suggestion/i })).closest('article');
    expect(within(review).getByText('Tutor suggested')).toBeInTheDocument();
    await user.click(within(review).getByRole('button', { name: /review suggestion/i }));

    expect(await screen.findByText(/Review the tutor's new time/i)).toBeInTheDocument();
    expect(screen.getByText(`Suggested: ${OWN_REQUEST.date} · 16:00`)).toBeInTheDocument();
    // The tutor's reply used to overwrite the student's own request text, so the
    // original ask disappeared the moment a time was suggested.
    expect(screen.getByText(/your original request is kept/i)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(OWN_REQUEST.message, 'i'))).toBeInTheDocument();

    // Accepting is the one irreversible half of the trip, so it also waits for a
    // confirmation and the exact time is readable before it is agreed to.
    await user.click(screen.getByRole('button', { name: /accept new time/i }));
    const acceptDialog = await screen.findByRole('dialog');
    expect(acceptDialog).toHaveTextContent(/accept this new time/i);
    expect(acceptDialog).toHaveTextContent(`${OWN_REQUEST.date} · 16:00`);
    expect(screen.queryByText('Past decisions')).not.toBeInTheDocument();

    // "Keep open" as the safe route out leaves the request exactly as it was.
    await cancelDialog(user);
    expect(await screen.findByText(/Review the tutor's new time/i)).toBeInTheDocument();
    expect(screen.queryByText('Past decisions')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /accept new time/i }));
    await confirmDialog(user, /accept new time/i);
    expect(await screen.findByText(/Find help that fits your schedule/i)).toBeInTheDocument();

    // Accepting moves it out of the pending list and into the history as Confirmed.
    await user.click(screen.getByRole('link', { name: /requests/i }));
    expect(await screen.findByText('Past decisions')).toBeInTheDocument();
    const history = screen.getByText('Past decisions').closest('section');
    expect(within(history).getByText('Confirmed')).toBeInTheDocument();
  });

  // A wrong or stale ?request= id used to fall back to the first request in the
  // list, which meant editing somebody else's booking.
  it('refuses to act on a request id that is not in the list', async () => {
    signInAs(TUTOR);
    renderApp('/booking?mode=suggest&request=does-not-exist');

    expect(await screen.findByText(/Request not found/i)).toBeInTheDocument();
    expect(screen.queryByText(/Suggest another time/i)).not.toBeInTheDocument();
  });

  it('refuses to review a suggestion that is not the student own', async () => {
    signInAs(STUDENT);
    renderApp('/booking?mode=review&request=r1');

    // r1 belongs to Mikaela, so it is not in the student visible slice at all.
    expect(await screen.findByText(/Suggestion not found/i)).toBeInTheDocument();
  });
});
