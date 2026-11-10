import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Avatar from '../components/Avatar';
import SelectField from '../components/SelectField';
import { Icon } from '../components/icons';
import { blockImplicitSubmit } from '../lib/forms';

export default function ProfilePage({ user, onSave }) {
  const navigate = useNavigate();
  const [name, setName] = useState(user.name);
  const [major, setMajor] = useState(user.major || 'Artificial Intelligence');
  const [semester, setSemester] = useState(String(user.semester || 1));
  const [bio, setBio] = useState(user.bio || (user.role === 'tutor' ? 'Peer tutor focused on clear, practical study sessions.' : 'Student looking for focused peer tutoring support.'));
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setName(user.name);
    setMajor(user.major || 'Artificial Intelligence');
    setSemester(String(user.semester || 1));
    setBio(user.bio || (user.role === 'tutor' ? 'Peer tutor focused on clear, practical study sessions.' : 'Student looking for focused peer tutoring support.'));
  }, [user]);

  const submit = (event) => {
    event.preventDefault();
    onSave({ name, initials: name.split(' ').filter(Boolean).slice(0, 2).map((item) => item[0]).join('').toUpperCase(), major, semester: Number(semester), bio });
    setSaved(true);
  };

  return (
    <div className="profile-page">
      <header className="workspace-header"><div><span className="eyebrow">Your account</span><h1>Profile.</h1><p>A real profile surface even in a hardcoded prototype. Changes are saved locally so your demo feels like a real app.</p></div><div className="workspace-header-actions"><button className="ghost-button" onClick={() => navigate(-1)}><Icon name="arrowLeft" size={15} /> Back</button></div></header>

      <form className="profile-settings-grid" onSubmit={submit} onKeyDown={blockImplicitSubmit}>
        <section className="profile-identity-card card-surface"><div className="profile-identity-cover"><span>PCL Tutor</span><span>{user.role === 'tutor' ? 'Tutor / Mentor' : 'Student / Mentee'}</span></div><div className="profile-identity-body"><Avatar initials={name.split(' ').filter(Boolean).slice(0, 2).map((item) => item[0]).join('').toUpperCase() || user.initials} accent={user.role === 'tutor' ? '#3568C8' : '#0B8F68'} size="lg" /><h2>{name || user.name}</h2>{user.role === 'student' && (<p>{major} · Semester {semester}</p>)}<div className="profile-role-badge"><Icon name="check" size={14} /> Demo account · role locked</div></div></section>
        <section className="profile-form-card card-surface"><div className="section-head-inline"><div><span className="eyebrow">Profile details</span><h2>Edit your profile</h2><p>Everything here is local demo state. No backend or real authentication is used.</p></div></div><div className="profile-form-grid"><label>Full name<input value={name} onChange={(event) => { setName(event.target.value); setSaved(false); }} /></label>{user.role === 'student' && (<label>Major<input value={major} onChange={(event) => { setMajor(event.target.value); setSaved(false); }} /></label>)}{user.role === 'student' && (<SelectField label="Semester" value={semester} onChange={(next) => { setSemester(next); setSaved(false); }} options={Array.from({ length: 8 }, (_, i) => String(i + 1))} />)}<label>Role<input value={user.role === 'tutor' ? 'Tutor / Mentor' : 'Student / Mentee'} disabled /></label></div><label>Short bio<textarea rows="6" value={bio} onChange={(event) => { setBio(event.target.value); setSaved(false); }} /></label><div className="profile-form-footer">{saved ? <span className="save-confirm"><Icon name="check" size={14} /> Saved locally for this demo</span> : <span className="submit-hint">Changes update the header and dashboard immediately.</span>}<button className="primary-button" type="submit">Save changes <Icon name="check" size={15} /></button></div></section>
      </form>

      <section className="profile-shortcuts"><div><span className="eyebrow">Shortcuts</span><h2>Go somewhere useful.</h2></div><div className="profile-shortcut-grid">{user.role === 'student' ? <><button onClick={() => navigate('/find')}><Icon name="search" size={18} /><strong>Find a tutor</strong><span>Start a subject search.</span><Icon name="arrowRight" size={15} /></button><button onClick={() => navigate('/sessions')}><Icon name="calendar" size={18} /><strong>My sessions</strong><span>See your schedule.</span><Icon name="arrowRight" size={15} /></button><button onClick={() => navigate('/requests')}><Icon name="users" size={18} /><strong>My requests</strong><span>Review pending bookings.</span><Icon name="arrowRight" size={15} /></button></> : <><button onClick={() => navigate('/availability')}><Icon name="clock" size={18} /><strong>Availability</strong><span>Publish an open slot.</span><Icon name="arrowRight" size={15} /></button><button onClick={() => navigate('/requests')}><Icon name="users" size={18} /><strong>Requests</strong><span>Respond to students.</span><Icon name="arrowRight" size={15} /></button><button onClick={() => navigate('/subjects')}><Icon name="book" size={18} /><strong>Subjects</strong><span>Manage your teaching list.</span><Icon name="arrowRight" size={15} /></button></>}</div></section>
    </div>
  );
}
