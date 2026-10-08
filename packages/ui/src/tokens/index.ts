/** Axiom Foundation design tokens as JS constants.
 *
 * Accessibility note: every text/fill ↔ surface pair documented in
 * `contrastPairs` below clears its declared WCAG minimum. The matrix is
 * asserted in `__tests__/contrast.test.ts` so a token edit that drops below
 * AA (4.5:1 normal text, 3:1 non-text) fails CI before publish.
 */

export const colors = {
  // Surfaces
  paper: "#faf9f6",
  paperElevated: "#ffffff",

  // Ink (body text + foreground roles)
  ink: "#1c1917",
  inkSecondary: "#57534e",
  inkMuted: "#78716c",

  // Borders. `rule` is for decorative hairlines (1.19:1 on paper — fine,
  // SC 1.4.11 does not require 3:1 for purely decorative rules).
  // `ruleStrong` is for *interactive* component boundaries — form input
  // borders, dividers between actionable regions — and clears 3:1 against
  // paper (4.56:1 on #faf9f6). Use `ruleStrong` on inputs.
  rule: "#e7e5e4",
  ruleSubtle: "#f5f5f4",
  ruleStrong: "#78716c",

  // Brand accent — primary actions, links, focus indicators.
  accent: "#92400e",
  accentHover: "#7c2d12",
  accentLight: "rgba(146, 64, 14, 0.06)",

  // Focus ring. Use as the outline color on every interactive element's
  // `:focus-visible` state. Clears SC 1.4.11 (3:1 non-text) against paper
  // at 6.73:1.
  focusRing: "#92400e",

  // Code surfaces (high-contrast white-on-near-black; independent palette).
  codeBg: "#1c1917",
  codeText: "#e7e5e4",
  codeSelection: "#755b1c",

  // Status fill colors. All AA on paper when used as text. Bumped warning
  // from #b45309 (4.77:1, no margin) to #92400e (6.73:1) to give small-text
  // and low-DPI displays headroom — same hex as accent, since the brand's
  // amber-warning vocabulary is intentional.
  success: "#166534",
  warning: "#92400e",
  error: "#991b1b",
} as const;

export const easings = {
  out: "cubic-bezier(0.16, 1, 0.3, 1)",
  spring: "cubic-bezier(0.34, 1.56, 0.64, 1)",
} as const;

/** Documented WCAG contrast guarantees. Asserted in
 * `__tests__/contrast.test.ts`; drift fails CI. */
export type ContrastPair = {
  description: string;
  fg: string;
  bg: string;
  /** WCAG SC 1.4.3 normal-text minimum is 4.5; 1.4.11 non-text is 3.0. */
  minRatio: number;
};

export const contrastPairs: readonly ContrastPair[] = [
  // Body text and editorial copy on paper
  {
    description: "ink on paper (body text)",
    fg: colors.ink,
    bg: colors.paper,
    minRatio: 4.5,
  },
  {
    description: "ink-secondary on paper (subhead/caption)",
    fg: colors.inkSecondary,
    bg: colors.paper,
    minRatio: 4.5,
  },
  {
    description: "ink-muted on paper (small text limit)",
    fg: colors.inkMuted,
    bg: colors.paper,
    minRatio: 4.5,
  },
  // Same trio against the elevated surface used by cards / palettes
  {
    description: "ink on paperElevated",
    fg: colors.ink,
    bg: colors.paperElevated,
    minRatio: 4.5,
  },
  {
    description: "ink-secondary on paperElevated",
    fg: colors.inkSecondary,
    bg: colors.paperElevated,
    minRatio: 4.5,
  },
  {
    description: "ink-muted on paperElevated",
    fg: colors.inkMuted,
    bg: colors.paperElevated,
    minRatio: 4.5,
  },
  // Brand accent — links and primary actions
  {
    description: "accent on paper (link text)",
    fg: colors.accent,
    bg: colors.paper,
    minRatio: 4.5,
  },
  {
    description: "accent-hover on paper",
    fg: colors.accentHover,
    bg: colors.paper,
    minRatio: 4.5,
  },
  // Status colors as text (consumer code uses them this way)
  {
    description: "success on paper (status text)",
    fg: colors.success,
    bg: colors.paper,
    minRatio: 4.5,
  },
  {
    description: "warning on paper (status text)",
    fg: colors.warning,
    bg: colors.paper,
    minRatio: 4.5,
  },
  {
    description: "error on paper (status text)",
    fg: colors.error,
    bg: colors.paper,
    minRatio: 4.5,
  },
  // Code block — white on near-black
  {
    description: "codeText on codeBg",
    fg: colors.codeText,
    bg: colors.codeBg,
    minRatio: 4.5,
  },
  {
    description: "codeText on codeSelection (selected code)",
    fg: colors.codeText,
    bg: colors.codeSelection,
    minRatio: 4.5,
  },
  // SC 1.4.11 non-text — focus rings and form input borders
  {
    description: "focusRing on paper (SC 1.4.11 non-text)",
    fg: colors.focusRing,
    bg: colors.paper,
    minRatio: 3,
  },
  {
    description: "focusRing on paperElevated (SC 1.4.11 non-text)",
    fg: colors.focusRing,
    bg: colors.paperElevated,
    minRatio: 3,
  },
  {
    description: "ruleStrong on paper (input border, SC 1.4.11)",
    fg: colors.ruleStrong,
    bg: colors.paper,
    minRatio: 3,
  },
  {
    description: "ruleStrong on paperElevated (input border, SC 1.4.11)",
    fg: colors.ruleStrong,
    bg: colors.paperElevated,
    minRatio: 3,
  },
];
