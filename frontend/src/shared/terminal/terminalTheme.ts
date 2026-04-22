export interface TerminalThemeColors {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  scrollbarSlider: string;
  scrollbarSliderHover: string;
  scrollbarSliderActive: string;
  scrollbarWidth: number;
  overviewRulerBorder: string;
  ansi: readonly string[];
}

export interface XtermThemeDefinition {
  background: string;
  foreground: string;
  cursor: string;
  selectionBackground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
  scrollbarSliderBackground: string;
  scrollbarSliderHoverBackground: string;
  scrollbarSliderActiveBackground: string;
  overviewRulerBorder: string;
}

type CssVariableReader = Pick<CSSStyleDeclaration, 'getPropertyValue'> | null | undefined;

const DEFAULT_SCROLLBAR_WIDTH = 6;
const DEFAULT_TERMINAL_ANSI_PALETTE = Object.freeze([
  '#14191e',
  '#b43c2a',
  '#00c200',
  '#c7c400',
  '#2744c7',
  '#c040be',
  '#00c5c7',
  '#c7c7c7',
  '#686868',
  '#dd7975',
  '#58e790',
  '#ece100',
  '#a7abf2',
  '#e17ee1',
  '#60fdff',
  '#ffffff',
]);

const TERMINAL_ANSI_VARIABLES = [
  '--terminal-ansi-black',
  '--terminal-ansi-red',
  '--terminal-ansi-green',
  '--terminal-ansi-yellow',
  '--terminal-ansi-blue',
  '--terminal-ansi-magenta',
  '--terminal-ansi-cyan',
  '--terminal-ansi-white',
  '--terminal-ansi-bright-black',
  '--terminal-ansi-bright-red',
  '--terminal-ansi-bright-green',
  '--terminal-ansi-bright-yellow',
  '--terminal-ansi-bright-blue',
  '--terminal-ansi-bright-magenta',
  '--terminal-ansi-bright-cyan',
  '--terminal-ansi-bright-white',
] as const;

const readCssVar = (styles: CssVariableReader, variableName: string, fallback: string): string => {
  const value = styles?.getPropertyValue(variableName).trim();
  return value || fallback;
};

const readScrollbarWidth = (styles: CssVariableReader): number => {
  const rawValue = styles?.getPropertyValue('--scrollbar-width').trim();
  const parsedValue = rawValue ? Number.parseInt(rawValue, 10) : Number.NaN;
  return Number.isFinite(parsedValue) ? parsedValue : DEFAULT_SCROLLBAR_WIDTH;
};

const readAnsiPalette = (styles: CssVariableReader): readonly string[] =>
  DEFAULT_TERMINAL_ANSI_PALETTE.map((fallback, index) =>
    readCssVar(styles, TERMINAL_ANSI_VARIABLES[index], fallback)
  );

export const DEFAULT_TERMINAL_THEME: TerminalThemeColors = Object.freeze({
  background: '#15191f',
  foreground: '#dcdcdc',
  cursor: '#dcdcdc',
  selectionBackground: '#3f638b66',
  scrollbarSlider: '#64748b66',
  scrollbarSliderHover: '#64748b99',
  scrollbarSliderActive: '#64748bcc',
  scrollbarWidth: DEFAULT_SCROLLBAR_WIDTH,
  overviewRulerBorder: 'transparent',
  ansi: DEFAULT_TERMINAL_ANSI_PALETTE,
});

export const resolveTerminalTheme = (styles: CssVariableReader): TerminalThemeColors => ({
  background: readCssVar(styles, '--terminal-theme-background', DEFAULT_TERMINAL_THEME.background),
  foreground: readCssVar(styles, '--terminal-theme-foreground', DEFAULT_TERMINAL_THEME.foreground),
  cursor: readCssVar(styles, '--terminal-theme-cursor', DEFAULT_TERMINAL_THEME.cursor),
  selectionBackground: readCssVar(
    styles,
    '--terminal-theme-selection',
    DEFAULT_TERMINAL_THEME.selectionBackground
  ),
  scrollbarSlider: readCssVar(
    styles,
    '--terminal-theme-scrollbar-slider',
    DEFAULT_TERMINAL_THEME.scrollbarSlider
  ),
  scrollbarSliderHover: readCssVar(
    styles,
    '--terminal-theme-scrollbar-slider-hover',
    DEFAULT_TERMINAL_THEME.scrollbarSliderHover
  ),
  scrollbarSliderActive: readCssVar(
    styles,
    '--terminal-theme-scrollbar-slider-active',
    DEFAULT_TERMINAL_THEME.scrollbarSliderActive
  ),
  scrollbarWidth: readScrollbarWidth(styles),
  overviewRulerBorder: readCssVar(
    styles,
    '--terminal-theme-overview-ruler-border',
    DEFAULT_TERMINAL_THEME.overviewRulerBorder
  ),
  ansi: readAnsiPalette(styles),
});

export const toXtermThemeDefinition = (
  theme: Pick<
    TerminalThemeColors,
    | 'background'
    | 'foreground'
    | 'cursor'
    | 'selectionBackground'
    | 'scrollbarSlider'
    | 'scrollbarSliderHover'
    | 'scrollbarSliderActive'
    | 'overviewRulerBorder'
    | 'ansi'
  >
): XtermThemeDefinition => ({
  background: theme.background,
  foreground: theme.foreground,
  cursor: theme.cursor,
  selectionBackground: theme.selectionBackground,
  black: theme.ansi[0] ?? DEFAULT_TERMINAL_THEME.ansi[0],
  red: theme.ansi[1] ?? DEFAULT_TERMINAL_THEME.ansi[1],
  green: theme.ansi[2] ?? DEFAULT_TERMINAL_THEME.ansi[2],
  yellow: theme.ansi[3] ?? DEFAULT_TERMINAL_THEME.ansi[3],
  blue: theme.ansi[4] ?? DEFAULT_TERMINAL_THEME.ansi[4],
  magenta: theme.ansi[5] ?? DEFAULT_TERMINAL_THEME.ansi[5],
  cyan: theme.ansi[6] ?? DEFAULT_TERMINAL_THEME.ansi[6],
  white: theme.ansi[7] ?? DEFAULT_TERMINAL_THEME.ansi[7],
  brightBlack: theme.ansi[8] ?? DEFAULT_TERMINAL_THEME.ansi[8],
  brightRed: theme.ansi[9] ?? DEFAULT_TERMINAL_THEME.ansi[9],
  brightGreen: theme.ansi[10] ?? DEFAULT_TERMINAL_THEME.ansi[10],
  brightYellow: theme.ansi[11] ?? DEFAULT_TERMINAL_THEME.ansi[11],
  brightBlue: theme.ansi[12] ?? DEFAULT_TERMINAL_THEME.ansi[12],
  brightMagenta: theme.ansi[13] ?? DEFAULT_TERMINAL_THEME.ansi[13],
  brightCyan: theme.ansi[14] ?? DEFAULT_TERMINAL_THEME.ansi[14],
  brightWhite: theme.ansi[15] ?? DEFAULT_TERMINAL_THEME.ansi[15],
  scrollbarSliderBackground: theme.scrollbarSlider,
  scrollbarSliderHoverBackground: theme.scrollbarSliderHover,
  scrollbarSliderActiveBackground: theme.scrollbarSliderActive,
  overviewRulerBorder: theme.overviewRulerBorder,
});

export const resolveAnsi256Color = (
  index: number,
  palette: readonly string[] = DEFAULT_TERMINAL_THEME.ansi
): string => {
  if (index < 0) {
    return '#000000';
  }

  if (index < 16) {
    return palette[index] ?? '#000000';
  }

  if (index >= 232) {
    const gray = 8 + (index - 232) * 10;
    const hex = gray.toString(16).padStart(2, '0');
    return `#${hex}${hex}${hex}`;
  }

  const value = index - 16;
  const red = Math.floor(value / 36);
  const green = Math.floor((value % 36) / 6);
  const blue = value % 6;
  const steps = [0, 95, 135, 175, 215, 255];

  return `#${steps[red].toString(16).padStart(2, '0')}${steps[green]
    .toString(16)
    .padStart(2, '0')}${steps[blue].toString(16).padStart(2, '0')}`;
};
