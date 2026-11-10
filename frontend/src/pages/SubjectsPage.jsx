import React, { useState } from 'react';
import { SUBJECTS } from '../data/catalog';
import { Icon } from '../components/icons';

export default function SubjectsPage({ user, onUpdateTutor }) {
  // The draft mirrors the signed-in tutor's record. Nothing persists until
  // "Save subjects" routes the list through onUpdateTutor, so the local db stays
  // the source of truth for every other page.
  const [subjects, setSubjects] = useState(user?.subjects || []);
  const [saved, setSaved] = useState(false);
  if (!user || user.role !== 'tutor') return <div className="empty-state large"><strong>Subject management is tutor-only.</strong><span>Students discover subjects through the Find a Tutor page.</span></div>;
  const toggle = (subject) => { setSaved(false); setSubjects((current) => current.includes(subject) ? current.filter((item) => item !== subject) : [...current, subject]); };
  const save = () => {
    if (typeof onUpdateTutor !== 'function') return;
    onUpdateTutor({ subjects });
    setSaved(true);
  };
  return (
    <div className="workspace-page">
      <header className="workspace-header"><div><span className="eyebrow">Tutor profile</span><h1>Subjects you teach.</h1><p>Keep this list short and accurate so students can find you for the right course.</p></div><button className="primary-button" onClick={save}><Icon name="check" size={16} /> Save subjects</button></header>
      <section className="subjects-manager-card"><div className="section-head-inline"><div><span className="eyebrow">Current teaching list</span><h2>{subjects.length} subject{subjects.length !== 1 ? 's' : ''}</h2><p>Tap a subject to include or remove it from your tutor profile.</p></div>{saved && <span className="save-confirm"><Icon name="check" size={14} /> Subjects saved</span>}</div><div className="subjects-manager-grid">{SUBJECTS.map((subject) => <button type="button" key={subject} className={`subject-manager-item ${subjects.includes(subject) ? 'selected' : ''}`} onClick={() => toggle(subject)}><span>{subjects.includes(subject) ? <Icon name="check" size={15} /> : <span className="subject-empty-mark" />}</span><strong>{subject}</strong></button>)}</div></section>
    </div>
  );
}
