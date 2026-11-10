/**
 * Subject catalog for the PCL Tutor mobile app.
 *
 * Direct port of the shared list used by the web app
 * (frontend/src/data/catalog.js — SUBJECTS). Keep the two lists in sync
 * when the catalog changes.
 */
export const SUBJECTS = [
  'Linear Algebra',
  'Deep Learning',
  'Calculus',
  'Human Computer Interaction',
  'Web Development',
  'Data Communication and Network System',
  'Discrete Math',
  'Computer Architecture Organization and Operating System',
  'Programming Fundamentals',
  'C',
  'Advanced C++',
  'Visual Perception',
  'Algorithm and Data Structure',
  'Probability & Statistics',
] as const;

export type Subject = (typeof SUBJECTS)[number];
