// Local, deterministic study-plan generator for the AI Study Plan page.
//
// This is intentionally a pure, seeded-style module with NO network calls: it turns
// the form settings (subject, timeframe, level, goal, weekly time) into a phased
// preview plan built from a small local topic pool. The page labels the output as
// sample/preview data, not a live AI result. Keeping the logic pure and
// deterministic makes it easy to unit test and keeps the demo reproducible.

// Option lists the form renders through SelectField. Exported so the page and the
// generator share one source of truth for labels and default values.
export const PLAN_TIMEFRAMES = [
  { value: '1', label: '1 week' },
  { value: '2', label: '2 weeks' },
  { value: '4', label: '4 weeks' },
];

export const PLAN_LEVELS = ['Beginner', 'Intermediate', 'Advanced'];

export const PLAN_GOALS = [
  'Understand the concepts',
  'Prepare for an exam',
  'Practice more problems',
  'Prepare for a project',
];

export const PLAN_CADENCES = [
  'Light (~2 h/week)',
  'Moderate (~5 h/week)',
  'Intensive (~8 h/week)',
];

// Short topic pools per subject. This is sample preview data, not a real syllabus,
// so each stays compact. Unknown subjects fall back to the generic pool below.
const TOPICS = {
  'Linear Algebra': ['Vector spaces, bases and dimension', 'Linear transformations and matrix–vector products', 'Determinants, rank and invertibility', 'Eigenvalues, eigenvectors and diagonalisation', 'Matrix decompositions: LU, QR and SVD'],
  'Deep Learning': ['Tensors, backpropagation and the loss landscape', 'CNNs, RNNs and attention', 'Regularisation, batch norm and optimisers', 'Data pipelines, overfitting and generalisation', 'Fine-tuning and evaluating a model end to end'],
  'Calculus': ['Limits, continuity and derivatives', 'The integral and the fundamental theorem', 'Multivariable calculus and gradients', 'Series, convergence and Taylor expansion', 'Differential equations and modelling'],
  'Human Computer Interaction': ['User research and task analysis', 'Design heuristics and usability testing', 'Prototyping and rapid iteration', 'Accessibility and inclusive design', 'Measuring UX: metrics and studies'],
  'Web Development': ['HTML, CSS and responsive layouts', 'JavaScript fundamentals and the DOM', 'Frameworks, components and state', 'HTTP, APIs and data fetching', 'Performance, testing and deployment'],
  'Data Communication and Network System': ['The OSI and TCP/IP models', 'Switching, routing and the IP layer', 'Transport: TCP vs UDP, flow and congestion', 'Network programming and sockets', 'Security, monitoring and QoS'],
  'Discrete Math': ['Logic, proof techniques and sets', 'Relations, functions and partial orders', 'Graphs, trees and graph invariants', 'Counting, permutations and combinations', 'Recurrence relations and induction'],
  'Computer Architecture Organization and Operating System': ['The CPU, memory hierarchy and pipelines', 'Instruction sets and assembly', 'Processes, threads and scheduling', 'Memory management and virtual memory', 'File systems, I/O and system calls'],
  'Programming Fundamentals': ['Variables, types and control flow', 'Functions, scope and return values', 'Data structures: arrays, lists, maps', 'Debugging and unit testing basics', 'Writing clean, readable code'],
  'C': ['Pointers, references and memory layout', 'Arrays, strings and the stack vs heap', 'Memory ownership and safe patterns', 'Templates and the standard library', 'Exception handling and RAII'],
  'Advanced C++': ['Move semantics and the rule of five', 'Smart pointers and modern memory safety', 'Concurrency: threads, atomics and executors', 'C++20: concepts, ranges and coroutines', 'Profiling and optimisation'],
  'Visual Perception': ['Retinal signals and early cortical processing', 'Feature and object recognition', 'Depth, motion and shape from context', 'Attention and perceptual illusions', 'Deep models of visual perception'],
  'Algorithm and Data Structure': ['Complexity and amortised analysis', 'Heaps, trees and balanced structures', 'Graph traversal, Dijkstra and shortest paths', 'Dynamic programming and greedy', 'Hashing, sorting and backtracking'],
  'Probability & Statistics': ['Probability spaces and conditional probability', 'Random variables and expectation', 'Common distributions and the CLT', 'Estimation and confidence intervals', 'Hypothesis testing and inference'],
};

const GENERIC_TOPICS = [
  'Foundations and key definitions',
  'Core techniques with worked examples',
  'Practice problems and common pitfalls',
  'Review and consolidate what you know',
  'Apply it to a small project or problem set',
];

// The page surfaces this on every result so it is never mistaken for a live model.
const DISCLAIMER = 'Sample preview — generated locally on this page from your settings. It is demo data, not output from a live AI model.';
const TIP = 'This is a structured study path, not a live AI answer. Use it to scope a session, then book a tutor to review the plan with you.';

function phaseTopics(pool, total) {
  const per = Math.ceil(pool.length / total);
  const out = [];
  for (let i = 0; i < total; i += 1) {
    const slice = pool.slice(i * per, i * per + per);
    out.push(slice.length ? slice : ['Review and consolidate everything so far']);
  }
  return out;
}

function phaseTitle(index, total) {
  if (total === 1) return 'Focused sprint';
  if (index === 0) return 'Foundations';
  if (index === total - 1) return 'Mastery & review';
  return 'Build & apply';
}

function milestoneFor(index, total, subject) {
  if (total === 1) return `Can walk through a ${subject} problem end to end and explain each step.`;
  if (index === 0) return `Can state the ${subject} basics without looking at notes.`;
  if (index === total - 1) return 'Can solve a full practice set and explain the reasoning behind it.';
  return 'Can apply this week\'s topics to unfamiliar problems.';
}

function activitiesFor(level, goal, cadence) {
  const list = [
    'Skim the week\u2019s topics and note what you already understand.',
    'Work through 3\u20135 practice problems, checking the solution after each.',
    'Explain one key idea out loud or in your own words.',
  ];
  if (level === 'Beginner') list.push('Watch a short explainer and keep guided notes.');
  if (level === 'Advanced') list.push('Take one extension problem and record the edge cases.');
  if (goal === 'Prepare for an exam') list.push('Finish with a short, timed mock question set.');
  if (goal === 'Prepare for a project') list.push('Sketch how this topic maps onto your project.');
  if (cadence.startsWith('Intensive')) list.push('Add a second practice set or one deeper dive.');
  if (cadence.startsWith('Light')) list.push('Keep the session short — 30 focused minutes is enough.');
  return list;
}

function firstStepsFor(subject, level) {
  return [
    `Gather your ${subject} notes or textbook before you start.`,
    level === 'Beginner'
      ? 'Open each session with a 10-minute review of the last topic.'
      : 'Anchor everything to one example you already understand.',
    'Time-box each study block and write down where you got stuck.',
  ];
}

export function buildStudyPlan({
  subject = 'General',
  topic = '',
  weeks,
  level = 'Intermediate',
  goal = 'Understand the concepts',
  cadence = 'Moderate (~5 h/week)',
} = {}) {
  const total = Math.max(1, Math.min(4, parseInt(weeks, 10) || 2));
  const pool = TOPICS[subject] || GENERIC_TOPICS;
  const topicsByPhase = phaseTopics(pool, total);
  const activities = activitiesFor(level, goal, cadence);

  const phases = topicsByPhase.map((topics, index) => ({
    index,
    title: phaseTitle(index, total),
    topics,
    activities,
    milestone: milestoneFor(index, total, subject),
  }));

  return {
    subject,
    topic: String(topic || '').trim(),
    weeks: total,
    level,
    goal,
    cadence,
    disclaimer: DISCLAIMER,
    tip: TIP,
    firstSteps: firstStepsFor(subject, level),
    phases,
  };
}

// Plain-text rendering used by the "Copy plan" action, so the clipboard gets a
// readable outline instead of raw JSON.
export function describeStudyPlan(plan) {
  const lines = [];
  lines.push(`Study plan (preview) — ${plan.subject}${plan.topic ? ` · ${plan.topic}` : ''}`);
  lines.push(`${plan.weeks} week${plan.weeks > 1 ? 's' : ''} · ${plan.level} · Goal: ${plan.goal} · ${plan.cadence}`);
  lines.push('');
  if (plan.firstSteps?.length) {
    lines.push('Quick start:');
    plan.firstSteps.forEach((step, index) => lines.push(`  ${index + 1}. ${step}`));
    lines.push('');
  }
  plan.phases.forEach((phase) => {
    lines.push(`Week ${phase.index + 1} — ${phase.title}`);
    phase.topics.forEach((topic) => lines.push(`  • ${topic}`));
    lines.push('  Focus:');
    phase.activities.forEach((activity) => lines.push(`    – ${activity}`));
    lines.push(`  By the end: ${phase.milestone}`);
    lines.push('');
  });
  lines.push(plan.disclaimer);
  return lines.join('\n');
}
