/**
 * Responsive layout breakpoints shared by JavaScript and CSS.
 */
export const BREAKPOINTS = {
  wide: '(width >= 48rem)',
  compactHeight: '(height < 30rem) and (width >= 32rem) and (pointer: coarse)',
  sidePanels: '(width > 70.25rem)',
  settingsStack: '42rem',
  compactContent: '32rem',
} as const;
