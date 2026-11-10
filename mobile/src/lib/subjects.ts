import { SUBJECTS } from '@/data/subjects';

/**
 * Filter the subject catalog with a free-text query.
 *
 * Case-insensitive substring match on the trimmed query; an empty query
 * returns the full catalog. Pure function so it can be unit-tested without
 * rendering the dropdown UI.
 */
export function filterSubjects(query: string, subjects: readonly string[] = SUBJECTS): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [...subjects];
  }
  return subjects.filter((subject) => subject.toLowerCase().includes(needle));
}
