/**
 * Design tokens for Cramrade. Screens and components read everything from here.
 * The reasoning behind these values is in DESIGN.md.
 */

import '@/global.css';

import { Platform } from 'react-native';

export const Colors = {
  light: {
    paper: '#F4F6F2',
    surface: '#FFFFFF',
    line: '#D6DBD2',
    ink: '#17202A',
    inkMuted: '#5A6672',
    session: '#148A6A',
    sessionSoft: '#DDEFE8',
    exam: '#D9472F',
    onInk: '#F4F6F2',
    onSession: '#FFFFFF',
  },
  dark: {
    paper: '#111821',
    surface: '#19222D',
    line: '#2B3642',
    ink: '#EDF0EA',
    inkMuted: '#9DA8B3',
    session: '#38B48F',
    sessionSoft: '#1A3A32',
    exam: '#F0735C',
    onInk: '#111821',
    onSession: '#0B1510',
  },
} as const;

export type ColorScheme = keyof typeof Colors;
export type ThemeColors = (typeof Colors)[ColorScheme];
export type ColorName = keyof ThemeColors;

/**
 * Font family names as registered by useFonts in src/app/_layout.tsx.
 * In Expo SDK 57 every weight is its own family, so styles pick a family
 * and never set fontWeight (that would trigger faux bold on web).
 * On web a system stack is appended so text is never invisible while loading.
 */
const webFallbackSans =
  ', ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

function family(name: string) {
  return Platform.OS === 'web' ? `${name}${webFallbackSans}` : name;
}

export const Fonts = {
  display: family('BricolageGrotesque_700Bold'),
  displayHeavy: family('BricolageGrotesque_800ExtraBold'),
  body: family('AtkinsonHyperlegible_400Regular'),
  bodyBold: family('AtkinsonHyperlegible_700Bold'),
} as const;

/** Type scale, ratio about 1.25 from a 16px body. */
export const FontSize = {
  small: 13,
  body: 16,
  lead: 20,
  title: 25,
  headlineNarrow: 31,
  headlineWide: 39,
  displayNarrow: 42,
  displayWide: 61,
} as const;

export const LineHeight = {
  small: 20,
  body: 26,
  lead: 30,
  title: 32,
} as const;

/** 4px grid. */
export const Spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
  section: 64,
  sectionWide: 96,
} as const;

/** Radii carry hierarchy: small chips, buttons and inputs, panels. */
export const Radius = {
  chip: 4,
  control: 8,
  panel: 12,
} as const;

export const Layout = {
  /** Width at which the layout switches from phone to wide. */
  wideBreakpoint: 760,
  contentMaxWidth: 1120,
  /** Max width of a paragraph so lines stay under about 70 characters. */
  proseMaxWidth: 560,
  gutterNarrow: 20,
  gutterWide: 32,
  topBarHeight: 64,
} as const;

export const Focus = {
  width: 3,
  offset: 2,
} as const;
