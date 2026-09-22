/**
 * Design tokens.
 *
 * Colours follow the BICI palette (bici.mg): green accent #4CD436, night
 * #000A14. Two schemes share the same keys - `lightPalette` (white surfaces)
 * and `darkPalette` (the black / blue-night look of the BICI site). `palette`
 * is the live object every screen reads: `theme/scheme.ts` copies the active
 * scheme into it, so a key must mean a role, never a literal colour.
 *
 * The handoff mocks are drawn in a 300 x 700 canvas that stands in for a phone
 * screen (~375-390pt wide), so every size below is the mock value scaled by ~1.25
 * and rounded to a value that respects platform touch-target minimums.
 */

export type PaletteKey =
  // Brand
  | 'night'
  | 'onNight'
  | 'onNightAccent'
  | 'brandNight'
  | 'lime'
  | 'onLime'
  | 'limeShadow'
  // Text
  | 'ink'
  | 'inkBody'
  | 'inkMuted'
  | 'inkSubtle'
  | 'inkPlaceholder'
  | 'inkFaint'
  | 'inkDisabled'
  | 'inkGhost'
  | 'inkAvatar'
  // Surfaces & lines
  | 'white'
  | 'background'
  | 'surface'
  | 'surfaceMuted'
  | 'surfaceChip'
  | 'border'
  | 'borderStrong'
  | 'divider'
  | 'dividerSoft'
  | 'track'
  | 'trackAlt'
  | 'skeleton'
  | 'skeletonAlt'
  | 'backdrop'
  // States
  | 'danger'
  | 'dangerFill'
  | 'dangerText'
  | 'dangerBorder'
  | 'dangerBg'
  | 'dangerSurface'
  | 'dangerSurfaceSoft'
  | 'warning'
  | 'warningText'
  | 'warningBorder'
  | 'warningBg'
  | 'warningSurface'
  | 'successText'
  | 'successBorder'
  | 'successBg'
  | 'successSurface'
  | 'info'
  | 'infoText'
  | 'infoBorder'
  | 'infoBg'
  | 'tabActiveBg'
  // Social
  | 'facebookBg'
  | 'facebookFg'
  | 'instagramBg'
  | 'instagramFg';

export type Palette = Record<PaletteKey, string>;

export const lightPalette: Palette = {
  // Brand. `night` is the emphasis fill (primary button, selected chip, toast)
  // and `onNight` the text drawn on it; `lime` is the accent and `onLime` its text.
  night: '#000A14',
  onNight: '#FFFFFF',
  onNightAccent: '#4CD436',
  /** Fixed brand background (splash), identical in both schemes. */
  brandNight: '#000A14',
  lime: '#4CD436',
  onLime: '#020700',
  limeShadow: 'rgba(76, 212, 54, 0.4)',

  // Neutrals - text
  ink: '#000A14',
  inkBody: '#3F4653',
  inkMuted: '#6B7280',
  inkSubtle: '#7C8595',
  inkPlaceholder: '#A2A8B3',
  inkFaint: '#9AA1AD',
  inkDisabled: '#B3B9C4',
  inkGhost: '#C3C8D1',
  inkAvatar: '#8B93A0',

  // Neutrals - surfaces & lines. `white` is always white (text on a coloured
  // fill); screens use `background`, cards and fields use `surface`.
  white: '#FFFFFF',
  background: '#FFFFFF',
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
  backdrop: 'rgba(0, 10, 20, 0.45)',

  // Danger / negative
  danger: '#F9736B',
  /** Solid fill carrying white text (error toast). */
  dangerFill: '#C2493F',
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

  // Success / positive (green family)
  successText: '#237A15',
  successBorder: '#CBF1C4',
  successBg: '#EEFBEB',
  successSurface: '#F8FEF6',

  // Info (scheduled / cyan family)
  info: '#6FD0E8',
  infoText: '#1C6F85',
  infoBorder: '#D6ECF3',
  infoBg: '#EEF8FB',

  // Active tab pill
  tabActiveBg: '#E9F9E5',

  // Social
  facebookBg: '#EEF2FB',
  facebookFg: '#3B5998',
  instagramBg: '#FDEEF4',
  instagramFg: '#C13584',
};

export const darkPalette: Palette = {
  night: '#F1F5F9',
  onNight: '#000A14',
  onNightAccent: '#1E8C10',
  brandNight: '#000A14',
  lime: '#4CD436',
  onLime: '#020700',
  limeShadow: 'rgba(76, 212, 54, 0.35)',

  ink: '#FFFFFF',
  inkBody: '#C4C8CE',
  inkMuted: '#98A2B3',
  inkSubtle: '#8A94A6',
  inkPlaceholder: '#6B7688',
  inkFaint: '#7D8799',
  inkDisabled: '#5A6475',
  inkGhost: '#3E4757',
  inkAvatar: '#7D8799',

  white: '#FFFFFF',
  background: '#020509',
  surface: '#0A1019',
  surfaceMuted: '#0F1722',
  surfaceChip: '#141D29',
  border: '#1C2530',
  borderStrong: '#28323E',
  divider: '#141D29',
  dividerSoft: '#111A26',
  track: '#1A2330',
  trackAlt: '#222C39',
  skeleton: '#141D29',
  skeletonAlt: '#101924',
  backdrop: 'rgba(0, 0, 0, 0.6)',

  danger: '#F9736B',
  dangerFill: '#C2493F',
  dangerText: '#FF9A92',
  dangerBorder: '#5A2521',
  dangerBg: '#2A1416',
  dangerSurface: '#1C1013',
  dangerSurfaceSoft: '#160D10',

  warning: '#F6C453',
  warningText: '#F6C453',
  warningBorder: '#4D3B12',
  warningBg: '#261E0C',
  warningSurface: '#1A150A',

  successText: '#6FE35C',
  successBorder: '#1F4A1A',
  successBg: '#0F2410',
  successSurface: '#0B1A0C',

  info: '#6FD0E8',
  infoText: '#7FD8EE',
  infoBorder: '#16404D',
  infoBg: '#0C2129',

  tabActiveBg: '#12301A',

  facebookBg: '#141E33',
  facebookFg: '#8FA8E0',
  instagramBg: '#2A1422',
  instagramFg: '#F07AB8',
};

/** Live palette - mutated in place by `applyColorScheme`, never reassigned. */
export const palette: Palette = { ...lightPalette };

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
    shadowColor: '#000A14',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 3,
  },
  fab: {
    shadowColor: '#3BA82A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.42,
    shadowRadius: 16,
    elevation: 8,
  },
  sheet: {
    shadowColor: '#000A14',
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
