/// <reference types="jest" />

import { SUBJECTS } from '../src/data/subjects';
import { filterSubjects } from '../src/lib/subjects';

describe('subject catalog', () => {
  it('is a non-empty list of unique subjects', () => {
    expect(SUBJECTS.length).toBe(14);
    const seen = new Set<string>();
    for (const subject of SUBJECTS) {
      expect(subject.trim().length).toBeGreaterThan(0);
      expect(seen.has(subject.toLowerCase())).toBe(false);
      seen.add(subject.toLowerCase());
    }
  });

  it('includes the core subjects used across the app', () => {
    expect(SUBJECTS).toContain('Linear Algebra');
    expect(SUBJECTS).toContain('Deep Learning');
    expect(SUBJECTS).toContain('Web Development');
  });
});

describe('filterSubjects', () => {
  it('returns the full catalog for an empty query', () => {
    expect(filterSubjects('')).toEqual([...SUBJECTS]);
    expect(filterSubjects('   ')).toEqual([...SUBJECTS]);
  });

  it('matches case-insensitively as a substring', () => {
    expect(filterSubjects('linear')).toContain('Linear Algebra');
    expect(filterSubjects('WEB dev')).toContain('Web Development');
    expect(filterSubjects('C++')).toEqual(['Advanced C++']);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterSubjects('does-not-exist')).toEqual([]);
  });

  it('respects a custom catalog override', () => {
    const custom = ['Astro 101', 'Astro 102'];
    expect(filterSubjects('astro', custom)).toEqual(['Astro 101', 'Astro 102']);
    expect(filterSubjects('nope', custom)).toEqual([]);
  });
});
