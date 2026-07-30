/**
 * Design tokens - extracted from the validated "Hootly" direction:
 * white cards, rounded corners, lime accent #C4F04A, night text #0F172A, soft shadows.
 *
 * The handoff mocks are drawn in a 300 x 700 canvas that stands in for a phone
 * screen (~375-390pt wide), so every size below is the mock value scaled by ~1.25
 * and rounded to a value that respects platform touch-target minimums.
 */

export const palette = {
  // Brand
  night: '#0F172A',
  lime: '#C4F04A',
  limeShadow: 'rgba(150, 196, 40, 0.42)',

  // Neutrals - text
  ink: '#0F172A',
  inkBody: '#3F4653',
  inkMuted: '#6B7280',
  inkSubtle: '#7C8595',
  inkPlaceholder: '#A2A8B3',
  inkFaint: '#9AA1AD',
  inkDisabled: '#B3B9C4',
  inkGhost: '#C3C8D1',
  inkAvatar: '#8B93A0',

  // Neutrals - surfaces & lines
  white: '#FFFFFF',
  surface: '#FFFFFF',
  surfaceMuted: '#F8F9FA',
  surfaceChip: '#F4F5F6',
  border: '#ECEDEF',
  borderStrong: '#DFE3E8',
  divider: '#F4F5F6',
  dividerSoft: '#F2F3F5',
  track: '#F1F2F4',
  trackAlt: '#E9EAEC',
  skeleton: '#EEF0F3',
  skeletonAlt: '#F7F8F9',

  // Danger / negative
  danger: '#F9736B',
  dangerText: '#C2493F',
  dangerBorder: '#FFDEDB',
  dangerBg: '#FFF0EE',
  dangerSurface: '#FFF8F7',
  dangerSurfaceSoft: '#FFFAFA',

  // Warning / token expiring
  warning: '#F6C453',
  warningText: '#8A5B12',
  warningBorder: '#FFE6BD',
  warningBg: '#FFF8EC',
  warningSurface: '#FFFCF6',

  // Success / positive (lime family)
  successText: '#4D6414',
  successBorder: '#E4F4BF',
  successBg: '#F6FBE9',
  successSurface: '#FCFFF5',

  // Info (scheduled / cyan family)
  info: '#6FD0E8',
  infoText: '#1C6F85',
  infoBorder: '#D6ECF3',
  infoBg: '#EEF8FB',

  // Active tab pill
  tabActiveBg: '#F4FAE4',

  // Social
  facebookBg: '#EEF2FB',
  facebookFg: '#3B5998',
  instagramBg: '#FDEEF4',
  instagramFg: '#C13584',
} as const;

/** 4pt-based spacing scale. */
export const spacing = {
  xxs: 2,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 10,
  xl: 12,
  '2xl': 14,
  '3xl': 16,
  '4xl': 20,
  '5xl': 24,
  '6xl': 28,
  '7xl': 32,
} as const;

export const radius = {
  xs: 7,
  sm: 11,
  md: 14,
  lg: 16,
  xl: 20,
  '2xl': 26,
  pill: 999,
} as const;

/** Font sizes. Keys read as roles, not as raw numbers. */
export const fontSize = {
  micro: 11,
  caption: 12,
  footnote: 13,
  body: 14,
  bodyLg: 15,
  callout: 16,
  title3: 18,
  title2: 19,
  title1: 21,
  display: 24,
  displayLg: 28,
} as const;

export const lineHeight = {
  micro: 15,
  caption: 17,
  footnote: 19,
  body: 20,
  bodyLg: 22,
  callout: 23,
  title3: 24,
  title2: 25,
  title1: 27,
  display: 30,
  displayLg: 34,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
  extrabold: '800',
} as const;

export type FontWeight = keyof typeof fontWeight;

/** Plus Jakarta Sans families, keyed by the weight role they implement. */
export const fontFamily: Record<FontWeight, string> = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
};

/** Minimum height for anything tappable (iOS HIG 44pt / Android 48dp). */
export const hitSlop = { top: 8, bottom: 8, left: 8, right: 8 } as const;

export const control = {
  /** Text inputs and select rows. */
  inputHeight: 52,
  /** Full-width primary actions. */
  buttonHeight: 54,
  /** Secondary / paired actions. */
  buttonHeightSm: 46,
  /** Square icon buttons in headers. */
  iconButton: 38,
  /** Filter and choice chips. */
  chipHeight: 34,
  /** Floating action button. */
  fab: 58,
  /** Minimum tappable size. */
  minTouch: 44,
} as const;

export const shadow = {
  card: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 3,
  },
  fab: {
    shadowColor: '#96C428',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.42,
    shadowRadius: 16,
    elevation: 8,
  },
  sheet: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: -6 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 16,
  },
} as const;

/**
 * Caps on OS font scaling. Accessibility scaling stays enabled everywhere, but
 * dense UI (badges, tab labels, metric numbers) is capped so it cannot overflow.
 */
export const fontScaleCap = {
  dense: 1.2,
  standard: 1.4,
  prose: 1.8,
} as const;
