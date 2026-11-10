/**
 * Design tokens ported from the PCL Tutor web app (frontend/src/styles.css
 * :root). Colors mirror the site palette; radii and spacing follow the web
 * scale, adapted where noted for compact mobile layouts.
 */
export const colors = {
  primary: '#0B8F68', // web --accent
  primaryDark: '#09755A', // deeper accent for selected text / pressed states
  primarySoft: 'rgba(11, 143, 104, 0.09)', // web --accent-soft (9% mix)
  background: '#ECEEEF', // web --bg
  surface: '#FFFFFF', // web --surface
  surfaceSoft: '#F5F6F7', // web --surface-soft
  text: '#12151A', // web --ink
  muted: '#58616D', // web --ink-2
  faint: '#9299A4', // web --ink-3
  border: '#DCE0E3', // web --line
  borderStrong: '#C9CED4', // web --line-strong
  danger: '#B42318', // web --danger
  dangerSoft: 'rgba(180, 35, 24, 0.05)',
  success: '#15803D', // web --success
};

/** Brand fonts bundled under assets/fonts (loaded in app/_layout.tsx). */
export const fonts = {
  body: 'Inter',
  heading: 'Plus Jakarta Sans',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

/** Web scale: xl 26, lg 18, md 12, sm 8; input 9 and button 10 from the CSS. */
export const radii = {
  xl: 26,
  lg: 18,
  md: 12,
  sm: 8,
  input: 9,
  button: 10,
} as const;

/**
 * Card and button shadows translated from the web's box-shadows into
 * React Native shadow properties (iOS shadow* + Android elevation).
 */
export const shadows = {
  card: {
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.04,
    shadowRadius: 12,
    elevation: 2,
  },
  soft: {
    shadowColor: colors.text,
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.06,
    shadowRadius: 19,
    elevation: 3,
  },
  accent: {
    shadowColor: colors.primary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.22,
    shadowRadius: 10,
    elevation: 6,
  },
} as const;
