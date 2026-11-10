import React, { useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import SelectField from '../components/SelectField';
import TutorCard from '../components/TutorCard';
import { Icon } from '../components/icons';
import { SUBJECTS } from '../data/catalog';
import {
  describeStudyPlan,
  PLAN_TIMEFRAMES,
  PLAN_LEVELS,
  PLAN_GOALS,
  PLAN_CADENCES,
} from '../lib/studyPlan';
import { generateStudyPlan } from '../lib/studyPlanApi';

// Everything that feeds the plan has a sensible default, so only "subject" is
// genuinely required. The rest just shape the preview once one is chosen.
const DEFAULTS = {
  weeks: '2',
  level: 'Intermediate',
  goal: 'Understand the concepts',
  cadence: 'Moderate (~5 h/week)',
};

export default function StudyPlanPage({ tutors = [] }) {
  const [subject, setSubject] = useState('');
  const [topic, setTopic] = useState('');
  const [weeks, setWeeks] = useState(DEFAULTS.weeks);
  const [level, setLevel] = useState(DEFAULTS.level);
  const [goal, setGoal] = useState(DEFAULTS.goal);
  const [cadence, setCadence] = useState(DEFAULTS.cadence);

  // 'idle' -> empty prompt, 'loading' -> skeleton, 'ready' -> the plan card.
  const [status, setStatus] = useState('idle');
  const [plan, setPlan] = useState(null);
  const [error, setError] = useState(null);
  // AI-unavailable message, surfaced in the result area with a Try-again action.
  const [aiError, setAiError] = useState(null);
  const [copied, setCopied] = useState(false);
  // A generation is a short local setTimeout; bumping seq on Clear/unmount makes a
  // stale callback no-op instead of overwriting newer state.
  const seq = useRef(0);
  // Guards against a second submit landing before the button's disabled re-render.
  const inFlight = useRef(false);

  const recommended = useMemo(() => {
    if (!subject) return [];
    return tutors
      .filter((tutor) => (tutor.subjects || []).includes(subject))
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 3);
  }, [tutors, subject]);

  const generate = async (event) => {
    event?.preventDefault();
    if (inFlight.current) return; // a generation is already running — ignore rapid re-submits
    if (!subject) {
      setError('Choose a subject to build the plan around.');
      setStatus('idle');
      return;
    }
    inFlight.current = true;
    setError(null);
    setAiError(null);
    const prevPlan = plan; // preserved and restored if this request fails
    const mine = ++seq.current;
    setStatus('loading');
    setPlan(null);
    setCopied(false);
    try {
      const result = await generateStudyPlan({ subject, topic, weeks, level, goal, cadence });
      if (seq.current !== mine) return; // a newer generation or Clear won the race
      setPlan(result);
      setAiError(null);
      setStatus('ready');
    } catch (err) {
      if (seq.current !== mine) return;
      setPlan(prevPlan); // keep the previously generated plan, if one exists
      setAiError(err?.message || 'AI generation is currently unavailable. Please try again.');
      setStatus(prevPlan ? 'ready' : 'error');
    } finally {
      inFlight.current = false;
    }
  };

  const copyPlan = async () => {
    if (!plan) return;
    try {
      await navigator.clipboard.writeText(describeStudyPlan(plan));
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  const clear = () => {
    seq.current += 1;
    setStatus('idle');
    setPlan(null);
    setError(null);
    setAiError(null);
    setCopied(false);
  };

  const loading = status === 'loading';

  return (
    <div className="study-plan-page">
      <header className="workspace-header">
        <div>
          <span className="eyebrow">AI study plan · preview</span>
          <h1>Sketch a study path before you book a session.</h1>
          <p>Pick a subject and a few settings, then preview a structured plan you can bring to a tutor or follow on your own. The plan is built by a live AI model.</p>
        </div>
        {status === 'ready' && (
          <div className="workspace-header-actions">
            <button type="button" className="ghost-button" onClick={clear}><Icon name="close" size={15} /> Clear</button>
          </div>
        )}
      </header>

      <div className="study-plan-grid">
        <form className="form-card study-plan-form" onSubmit={generate} noValidate>
          <div className="form-section">
            <div className="form-section-head"><span className="form-step">1</span><div><h2>Set up your plan</h2><p>These choices shape the preview.</p></div></div>
            <div className="field-grid">
              <SelectField label="Subject" value={subject} onChange={setSubject} options={SUBJECTS} placeholder="Choose a subject" />
              <SelectField label="Timeframe" value={weeks} onChange={setWeeks} options={PLAN_TIMEFRAMES} />
            </div>
            <div className="field-grid">
              <SelectField label="Current level" value={level} onChange={setLevel} options={PLAN_LEVELS} />
              <SelectField label="Goal" value={goal} onChange={setGoal} options={PLAN_GOALS} />
            </div>
            <SelectField label="Weekly time" value={cadence} onChange={setCadence} options={PLAN_CADENCES} />
            <div className="field-block">
              <span className="field-label">Topic focus <span className="optional">(optional)</span></span>
              <input aria-label="Topic focus" value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="e.g. eigenvectors, backprop, pointers…" />
            </div>
            {error && <div className="form-error" role="alert"><Icon name="close" size={14} /> {error}</div>}
            <button type="submit" className="primary-button study-plan-generate" disabled={loading}>
              <Icon name="spark" size={16} /> {loading ? 'Building preview…' : 'Generate study plan'}
            </button>
          </div>
        </form>

        <div className="study-plan-result">
          {status === 'idle' && (
            <div className="study-plan-empty">
              <Icon name="plan" size={26} />
              <strong>{subject ? `Ready to preview ${subject}.` : 'Your study plan appears here.'}</strong>
              <p>Choose a subject on the left and press Generate. You get a phased plan, a quick-start list, and tutor matches you can book — built with a live AI model.</p>
            </div>
          )}

          {loading && (
            <div className="study-plan-skeleton" aria-busy="true" aria-live="polite">
              <div className="sk"><div className="sk-line w1" /><div className="sk-line w2" /><div className="sk-line w3" /></div>
              <div className="sk"><div className="sk-line w2" /><div className="sk-line w1" /></div>
              <div className="sk"><div className="sk-line w3" /></div>
            </div>
          )}

          {!loading && aiError && (
            <div className="study-plan-error" role="alert">
              <div className="study-plan-error-head">
                <Icon name="close" size={16} />
                <div>
                  <strong>AI study plans are currently unavailable.</strong>
                  <p>{aiError}</p>
                </div>
              </div>
              <button type="button" className="primary-button" onClick={() => generate()}>
                <Icon name="spark" size={15} /> Try again
              </button>
            </div>
          )}

          {status === 'ready' && plan && (
            <div className="study-plan-card">
              <div className="study-plan-card-head">
                <div><span className="eyebrow">Preview plan</span><h2>{plan.subject}</h2></div>
                <div className="study-plan-actions">
                  <button type="button" className="secondary-button small" onClick={copyPlan}><Icon name={copied ? 'check' : 'mail'} size={14} /> {copied ? 'Copied' : 'Copy plan'}</button>
                  <Link className="ghost-button small" to={`/find?subject=${encodeURIComponent(plan.subject)}`}><Icon name="search" size={14} /> Find a tutor</Link>
                </div>
                <div className="study-plan-disclaimer"><Icon name="eye" size={15} /><span>{plan.source !== 'local-fallback' ? (<><strong>Live preview.</strong> Generated with {plan.model || 'OpenRouter'} from your settings.</>) : (<><strong>Sample preview.</strong> Generated locally on this page from your settings — demo data, not a result from a live AI model.</>)}</span></div>
              </div>
              <div className="study-plan-summary">
                <div><span>Timeframe</span><strong>{plan.weeks} week{plan.weeks > 1 ? 's' : ''}</strong></div>
                <div><span>Level</span><strong>{plan.level}</strong></div>
                <div><span>Goal</span><strong>{plan.goal}</strong></div>
                <div><span>Weekly time</span><strong>{plan.cadence.split(' (')[0]}</strong></div>
              </div>
              <div className="study-plan-phases">
                {plan.firstSteps.length > 0 && (
                  <div className="study-plan-firststeps">
                    <h3>Quick start</h3>
                    {plan.firstSteps.map((step, index) => <div key={index} className="study-plan-firststep"><span className="idx">{index + 1}</span><span>{step}</span></div>)}
                  </div>
                )}
                {plan.phases.map((phase) => (
                  <article className="study-plan-week" key={phase.index}>
                    <div className="study-plan-week-head"><h3>{phase.title}</h3><span className="study-plan-phase-tag">Week {phase.index + 1}</span></div>
                    <div className="study-plan-topics">{phase.topics.map((topicItem) => <span className="study-plan-topic" key={topicItem}>{topicItem}</span>)}</div>
                    <div className="study-plan-activities">{phase.activities.map((activity, index) => (
                      <div className="study-plan-activity" key={index}><span className="idx">{index + 1}</span><span>{activity}</span></div>
                    ))}</div>
                    <div className="study-plan-milestone"><Icon name="check" size={15} /><span><strong>By the end:</strong> {phase.milestone}</span></div>
                  </article>
                ))}
              </div>
              <div className="study-plan-tip"><Icon name="spark" size={15} /><span>{plan.tip}</span></div>
            </div>
          )}
        </div>
      </div>

      {subject && (
        <section className="study-plan-recommend">
          <div className="section-head-inline">
            <div>
              <span className="eyebrow">Recommended tutors</span>
              <h2>Bring this plan to someone who teaches {subject}.</h2>
              <p>These tutors already list {subject}. Open a profile to see their open slots, then book.</p>
            </div>
            <Link className="text-link" to={`/find?subject=${encodeURIComponent(subject)}`}>Browse all {subject} tutors <Icon name="arrowRight" size={14} /></Link>
          </div>
          {recommended.length ? (
            <div className="tutor-grid">{recommended.map((tutor) => <TutorCard tutor={tutor} key={tutor.id} />)}</div>
          ) : (
            <div className="empty-state large"><Icon name="users" size={24} /><strong>No tutors list {subject} yet.</strong><span>Try another subject, or check back after a tutor updates their profile.</span></div>
          )}
        </section>
      )}
    </div>
  );
}
