import React, { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import TutorCard from '../components/TutorCard';
import SelectField from '../components/SelectField';
import { Icon } from '../components/icons';
import { SUBJECTS } from '../data/catalog';

export default function FindTutorPage({ tutors = [] }) {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('q') || '');
  const [subject, setSubject] = useState(params.get('subject') || 'All subjects');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [mode, setMode] = useState('All formats');
  const [sort, setSort] = useState('Recommended');

  const filteredTutors = useMemo(() => {
    const q = search.trim().toLowerCase();
    const results = tutors.filter((tutor) => {
      const matchText = !q || tutor.name.toLowerCase().includes(q) || tutor.subjects.some((item) => item.toLowerCase().includes(q));
      const matchSubject = subject === 'All subjects' || tutor.subjects.includes(subject);
      const matchMode = mode === 'All formats' || tutor.modes.includes(mode);
      return matchText && matchSubject && matchMode;
    });
    return [...results].sort((a, b) => {
      if (sort === 'Rating') return b.rating - a.rating;
      if (sort === 'Sessions') return b.sessions - a.sessions;
      return Number(b.rating) - Number(a.rating) || b.sessions - a.sessions;
    });
  }, [search, subject, mode, sort, tutors]);

  const activeSearch = Boolean(search.trim() || subject !== 'All subjects' || mode !== 'All formats');

  const updateParams = (nextSearch = search, nextSubject = subject) => {
    const next = new URLSearchParams();
    if (nextSearch) next.set('q', nextSearch);
    if (nextSubject !== 'All subjects') next.set('subject', nextSubject);
    setParams(next, { replace: true });
  };

  const reset = () => {
    setSearch('');
    setSubject('All subjects');
    setMode('All formats');
    setSort('Recommended');
    setParams({}, { replace: true });
  };

  return (
    <div className="find-page">
      <header className="page-intro find-intro">
        <div><span className="eyebrow">Tutor discovery</span><h1>Find the right person to help it click.</h1><p>Start with your course, then compare tutor experience, availability, and format before you request a session.</p></div>
        <div className="find-summary"><strong>{filteredTutors.length}</strong><span>tutors available</span></div>
      </header>

      {!activeSearch && (
        <section className="find-featured">
          <div className="find-featured-art"><span>Practice centered learning</span><strong>Choose the subject.<br />The tutor comes next.</strong></div>
          <div className="find-featured-copy"><span className="eyebrow">How it works</span><h2>Less hunting. More learning.</h2><p>Search one subject, open the profiles that feel right, and use their availability as your decision point.</p><div className="process-row"><span><b>01</b> Choose subject</span><span><b>02</b> Compare tutor</span><span><b>03</b> Request slot</span></div></div>
        </section>
      )}

      <section className="finder-toolbar">
        <div className="finder-search"><Icon name="search" size={19} /><input aria-label="Search tutors" value={search} onChange={(event) => { setSearch(event.target.value); updateParams(event.target.value, subject); }} placeholder="Search tutor or subject…" /><button type="button" onClick={() => { setSearch(''); updateParams('', subject); }} aria-label="Clear search"><Icon name="close" size={15} /></button></div>
        {/* A panel, not chips: the toolbar is a tight auto-sized column, and three
            chips side by side would push Filters off the row on a narrow screen. */}
        <SelectField label="Sort tutors" value={sort} onChange={setSort} options={['Recommended', 'Rating', 'Sessions']} />
        <button className={`ghost-button ${filtersOpen ? 'selected-control' : ''}`} type="button" onClick={() => setFiltersOpen((value) => !value)}><Icon name="filter" size={15} /> Filters</button>
        {activeSearch && <button className="ghost-button" type="button" onClick={reset}>Reset</button>}
      </section>

      {filtersOpen && (
        <section className="finder-filters">
          <div><SelectField label="Subject" value={subject} onChange={(next) => { setSubject(next); updateParams(search, next); }} options={['All subjects', ...SUBJECTS]} placeholder="All subjects" /></div>
          <div><span className="field-label">Format</span><div className="filter-toggle-row">{['All formats', 'Online', 'Offline'].map((item) => <button type="button" key={item} className={mode === item ? 'selected' : ''} onClick={() => setMode(item)}>{item}</button>)}</div></div>
          <div><span className="field-label">Availability</span><div className="filter-note"><Icon name="calendar" size={15} /><span>Every tutor card shows their current open slots. Use the profile for the full calendar.</span></div></div>
        </section>
      )}

      <div className="subject-browse-row"><span className="muted-label">Browse subjects</span>{SUBJECTS.slice(0, 7).map((item) => <button className={`filter-chip ${subject === item ? 'selected' : ''}`} type="button" key={item} onClick={() => { setSubject(item); updateParams(search, item); }}>{item}</button>)}<button className="filter-chip more" type="button" onClick={() => { setFiltersOpen(true); }}>More filters</button></div>

      <section className="tutor-results">
        <div className="section-head-inline"><div><span className="eyebrow">Tutor library</span><h2>{activeSearch ? 'Your matches' : 'Recommended tutors'}</h2><p>{activeSearch ? `${filteredTutors.length} result${filteredTutors.length !== 1 ? 's' : ''} based on your current search.` : 'A compact starting point. Open a profile only when you want the details.'}</p></div></div>
        {tutors.length === 0 ? <div className="empty-state large"><Icon name="users" size={24} /><strong>No tutors have registered yet.</strong><span>Tutor profiles will appear here after they register.</span></div> : filteredTutors.length ? <div className="tutor-grid">{filteredTutors.map((tutor) => <TutorCard tutor={tutor} key={tutor.id} />)}</div> : <div className="empty-state large"><Icon name="search" size={24} /><strong>No tutor matches that search.</strong><span>Try another subject or reset the filters.</span><button className="ghost-button" onClick={reset}>Reset search</button></div>}
      </section>
    </div>
  );
}
