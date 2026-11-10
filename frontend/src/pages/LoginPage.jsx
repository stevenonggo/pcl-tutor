import React, { useState, useRef } from 'react';
import Brand from '../components/Brand';
import { Icon } from '../components/icons';
import { SUBJECTS } from '../data/catalog.js';

// Brand marks for the social sign-in buttons are inlined so the page has no external
// image dependency: the Google mark uses the official four-color paths, the Apple mark
// is a monochrome silhouette that follows the text color.
function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}

function AppleMark() {
  return (
    <svg width="16" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
    </svg>
  );
}

// Split-screen auth: the left panel is the fixed brand illustration, the right panel
// holds one card that swaps between sign-in and register. The card has a stable
// width, so switching views never reflows the panel grid.
export default function LoginPage({ onLogin, onRegister }) {
  const [view, setView] = useState('signin');
  const [signInRole, setSignInRole] = useState('student');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [registerRole, setRegisterRole] = useState('student');
  const [registerName, setRegisterName] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');
  const [registerMajor, setRegisterMajor] = useState('');
  const [registerSubjects, setRegisterSubjects] = useState([]);
  const [subjectQuery, setSubjectQuery] = useState('');
  const subjectInputRef = useRef(null);
  const [showRegisterPassword, setShowRegisterPassword] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const switchView = (nextView) => {
    setView(nextView);
    setError('');
    setNotice('');
  };

  const submitSignIn = (event) => {
    event.preventDefault();
    if (typeof onLogin !== 'function') return;
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setError('');
    // App validates against the local database; on success it sets the session and the
    // login route redirects straight into the dashboard.
    const result = onLogin({ email, password, role: signInRole });
    if (result && !result.ok) setError(result.error || 'That email or password is not correct.');
  };

  const submitRegister = (event) => {
    event.preventDefault();
    if (typeof onRegister !== 'function') return;
    setError('');
    // App validates the payload, appends the account to the versioned db, and creates
    // the session in the same step, so signup is also immediate sign-in.
    const result = onRegister({ role: registerRole, name: registerName, email: registerEmail, password: registerPassword, major: registerMajor, subjects: registerSubjects });
    if (result && !result.ok) setError(result.error || 'Something went wrong while creating the account.');
  };

  // Social sign-in and password reset have no backend in this local build, so those
  // controls answer with an honest notice instead of doing nothing.
  const showNotice = (message) => setNotice(message);

  const isRegister = view === 'register';
  const activeRole = isRegister ? registerRole : signInRole;
  const chooseRole = (role) => {
    if (isRegister) {
      setRegisterRole(role);
      // Leaving the tutor role clears the subject input so no suggestions linger.
      if (role !== 'tutor') setSubjectQuery('');
    }
    else setSignInRole(role);
  };

  const toggleRegisterSubject = (subject) => {
    setRegisterSubjects((current) => current.includes(subject)
      ? current.filter((item) => item !== subject)
      : [...current, subject]);
  };

  // Autocomplete subject picker: suggestions appear only while typing (non-empty
  // query) and match the catalog case-insensitively. Free text is never stored —
  // only official catalog names are chosen, so the exact name is saved regardless
  // of the input's capitalization.
  const subjectQueryText = subjectQuery.trim().toLowerCase();
  const visibleSubjects = subjectQueryText
    ? SUBJECTS.filter((subject) => subject.toLowerCase().includes(subjectQueryText))
    : [];

  const selectSuggestion = (subject) => {
    setRegisterSubjects((current) => current.includes(subject) ? current : [...current, subject]);
    setSubjectQuery('');
    if (subjectInputRef.current) subjectInputRef.current.focus();
  };

  // A true outside blur discards the free text so only chosen subjects remain; a
  // click on a suggestion keeps focus (mousedown is prevented on the list), so it
  // is handled by selectSuggestion instead of this.
  const handleSubjectBlur = () => setSubjectQuery('');

  return (
    <div className="login-screen">
      <div className="login-grid">
        <section className="login-visual">
          <Brand />
          <div className="login-visual-copy">
            <span className="eyebrow">Campus peer tutoring</span>
            <h1>Find the person who can make the hard part click.</h1>
            <p>PCL Tutor helps students discover peer tutors, compare availability, and request a focused study session without digging through a crowded course platform.</p>
          </div>
        </section>

        <section className="login-panel">
          <div className="auth-card">
            <div className="auth-head">
              <h1>{isRegister ? 'Create your account.' : 'Welcome Back!'}</h1>
              <p>{isRegister ? 'Pick a role and set up your profile. You are signed in the moment the account is created.' : 'Sign in to access your dashboard and continue your tutoring sessions.'}</p>
            </div>

            <div className="role-switch" aria-label={isRegister ? 'Choose your role' : 'Choose your account role'}>
              {['student', 'tutor'].map((role) => <button key={role} type="button" className={activeRole === role ? 'selected' : ''} onClick={() => chooseRole(role)}><span className="role-switch-title">{role === 'student' ? 'Student / Mentee' : 'Tutor / Mentor'}</span><span className="role-switch-caption">{role === 'student' ? 'Find and book a tutor' : 'Manage requests and availability'}</span></button>)}
            </div>

            {isRegister ? (
              <form className="login-form register-form" onSubmit={submitRegister}>
                <label>Full Name<span className="input-shell"><Icon name="profile" size={15} /><input value={registerName} onChange={(event) => setRegisterName(event.target.value)} autoComplete="name" placeholder="Enter your full name" /></span></label>
                {registerRole === 'student' && (
                  <label>Major<span className="input-shell"><Icon name="book" size={15} /><input value={registerMajor} onChange={(event) => setRegisterMajor(event.target.value)} autoComplete="off" placeholder="Enter your major" /></span></label>
                )}
                <label>Email<span className="input-shell"><Icon name="mail" size={15} /><input type="email" value={registerEmail} onChange={(event) => setRegisterEmail(event.target.value)} autoComplete="email" placeholder="Enter your email" /></span></label>
                <label><span className="field-row"><span>Password</span></span><span className="input-shell"><Icon name="lock" size={15} /><input type={showRegisterPassword ? 'text' : 'password'} value={registerPassword} onChange={(event) => setRegisterPassword(event.target.value)} autoComplete="new-password" placeholder="Enter your password" /><button type="button" className="input-action" aria-label={showRegisterPassword ? 'Hide password' : 'Show password'} onClick={() => setShowRegisterPassword((value) => !value)}><Icon name={showRegisterPassword ? 'eye' : 'eyeOff'} size={15} /></button></span></label>
                {registerRole === 'tutor' && (
                  <div className="reg-subject">
                    <span className="field-label">Subjects you teach<span className="optional"> pick at least one</span></span>
                    <div className="reg-subject-trigger">
                      {registerSubjects.map((subject) => (
                        <span className="reg-subject-chip" key={subject}>
                          <span className="reg-subject-chip-name">{subject}</span>
                          <button type="button" className="reg-subject-chip-remove" aria-label={`Remove ${subject}`} onClick={() => toggleRegisterSubject(subject)}>
                            <Icon name="x" size={12} />
                          </button>
                        </span>
                      ))}
                      <input
                        ref={subjectInputRef}
                        className="reg-subject-input"
                        type="text"
                        role="combobox"
                        aria-expanded={subjectQueryText !== ''}
                        aria-controls="reg-subject-suggestions"
                        aria-autocomplete="list"
                        aria-label="Search subjects to teach"
                        value={subjectQuery}
                        onChange={(event) => setSubjectQuery(event.target.value)}
                        onBlur={handleSubjectBlur}
                        onKeyDown={(event) => { if (event.key === 'Escape') setSubjectQuery(''); }}
                        placeholder={registerSubjects.length === 0 ? 'Type to search subjects' : 'Add another subject'}
                        autoComplete="off"
                      />
                    </div>
                    {subjectQueryText !== '' && (
                      <div className="reg-subject-body" id="reg-subject-suggestions">
                        <div className="reg-subject-list" role="listbox" aria-label="Matching subjects" onMouseDown={(event) => event.preventDefault()}>
                          {visibleSubjects.length === 0
                            ? <span className="reg-subject-empty">No subjects match "{subjectQuery}"</span>
                            : visibleSubjects.map((subject) => {
                                const selected = registerSubjects.includes(subject);
                                return (
                                  <button type="button" key={subject} role="option" aria-selected={selected} className={`reg-subject-option ${selected ? 'selected' : ''}`} onClick={() => selectSuggestion(subject)}>
                                    <span className="reg-subject-option-name">{subject}</span>
                                    {selected ? <Icon name="check" size={14} /> : <span className="reg-subject-option-mark" />}
                                  </button>
                                );
                              })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {error && <div className="form-error"><Icon name="x" size={16} /><span>{error}</span></div>}
                <button className="primary-button full" type="submit">Create account <Icon name="arrowRight" size={16} /></button>
              </form>
            ) : (
              <form className="login-form" onSubmit={submitSignIn}>
                <label>Email<span className="input-shell"><Icon name="mail" size={15} /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="Enter your email" /></span></label>
                <div className="password-block"><div className="field-row"><span>Password</span><button type="button" className="forgot-link" onClick={() => showNotice('Password reset is not available in this offline build — register a new account if you cannot sign in.')}>Forgot Password?</button></div><span className="input-shell"><Icon name="lock" size={15} /><input type={showPassword ? 'text' : 'password'} aria-label="Password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" placeholder="Enter your password" /><button type="button" className="input-action" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)}><Icon name={showPassword ? 'eye' : 'eyeOff'} size={15} /></button></span></div>
                {error && <div className="form-error"><Icon name="x" size={16} /><span>{error}</span></div>}
                <button className="primary-button full" type="submit">Sign In</button>
              </form>
            )}

            {notice && <div className="auth-note"><Icon name="spark" size={14} /><span>{notice}</span></div>}

            {!isRegister && (
              <div className="social-block">
                <div className="social-divider"><span>OR</span></div>
                <button type="button" className="social-button" onClick={() => showNotice('Social sign-in is not available in this local build — use your email and password instead.')}><GoogleMark /> Continue with Google</button>
                <button type="button" className="social-button" onClick={() => showNotice('Social sign-in is not available in this local build — use your email and password instead.')}><AppleMark /> Continue with Apple</button>
              </div>
            )}

            <div className="login-toggle-link">
              {isRegister
                ? <><span>Already registered?</span><button type="button" onClick={() => switchView('signin')}>Sign In</button></>
                : <><span>Don't have an Account?</span><button type="button" onClick={() => switchView('register')}>Sign Up</button></>}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
