/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/ansi.ts
 *
 * Helpers for detecting, stripping, and parsing ANSI SGR color/style
 * sequences embedded in log lines.
 */

import {
  DEFAULT_TERMINAL_THEME,
  resolveAnsi256Color,
  type TerminalThemeColors,
} from '@shared/terminal/terminalTheme';

export interface AnsiTextStyle {
  color?: string;
  backgroundColor?: string;
  fontWeight?: string;
  fontStyle?: string;
  textDecoration?: string;
}

export interface AnsiTextSegment {
  text: string;
  style: AnsiTextStyle;
}

const ANSI_TEST_PATTERN = /(?:\u001b\[|\u009b)[0-9;]*m/;
const ANSI_PATTERN = /(?:\u001b\[|\u009b)[0-9;]*m/g;
const ANSI_CAPTURE_PATTERN = /(?:\u001b\[|\u009b)([0-9;]*)m/g;
const DIM_OPACITY = 0.5;

interface ActiveAnsiState {
  color?: string;
  backgroundColor?: string;
  fontWeight?: string;
  fontStyle?: string;
  textDecoration?: string;
  dim?: boolean;
  inverse?: boolean;
}

const HEX_PATTERN = /^#([\da-f]{3,8})$/i;
const RGB_PATTERN =
  /^rgba?\(\s*(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:\s*,\s*|\s+)(\d{1,3})(?:(?:\s*,\s*|\s*\/\s*)([\d.]+))?\s*\)$/i;

const cloneState = (state: ActiveAnsiState): ActiveAnsiState => ({ ...state });

export const containsAnsi = (text: string): boolean => ANSI_TEST_PATTERN.test(text);

export const stripAnsi = (text: string): string => text.replace(ANSI_PATTERN, '');

const normalizeHex = (hex: string): [number, number, number, number] | null => {
  const value = hex.trim();
  const match = value.match(HEX_PATTERN);
  if (!match?.[1]) {
    return null;
  }

  const rawHex = match[1];
  if (rawHex.length === 3 || rawHex.length === 4) {
    const red = Number.parseInt(rawHex[0]!.repeat(2), 16);
    const green = Number.parseInt(rawHex[1]!.repeat(2), 16);
    const blue = Number.parseInt(rawHex[2]!.repeat(2), 16);
    const alpha = rawHex.length === 4 ? Number.parseInt(rawHex[3]!.repeat(2), 16) / 255 : 1;
    return [red, green, blue, alpha];
  }

  if (rawHex.length === 6 || rawHex.length === 8) {
    const red = Number.parseInt(rawHex.slice(0, 2), 16);
    const green = Number.parseInt(rawHex.slice(2, 4), 16);
    const blue = Number.parseInt(rawHex.slice(4, 6), 16);
    const alpha = rawHex.length === 8 ? Number.parseInt(rawHex.slice(6, 8), 16) / 255 : 1;
    return [red, green, blue, alpha];
  }

  return null;
};

const normalizeRgb = (color: string): [number, number, number, number] | null => {
  const match = color.trim().match(RGB_PATTERN);
  if (!match) {
    return null;
  }

  const red = Number.parseInt(match[1] ?? '', 10);
  const green = Number.parseInt(match[2] ?? '', 10);
  const blue = Number.parseInt(match[3] ?? '', 10);
  const alpha = match[4] == null ? 1 : Number.parseFloat(match[4]);
  if ([red, green, blue].some((value) => Number.isNaN(value))) {
    return null;
  }

  return [red, green, blue, Number.isNaN(alpha) ? 1 : alpha];
};

const applyForegroundDim = (color: string): string => {
  const rgba = normalizeHex(color) ?? normalizeRgb(color);
  if (!rgba) {
    return color;
  }

  const [red, green, blue, alpha] = rgba;
  const nextAlpha = Number((alpha * DIM_OPACITY).toFixed(3));
  return `rgba(${red}, ${green}, ${blue}, ${nextAlpha})`;
};

const materializeStyle = (
  state: ActiveAnsiState,
  terminalTheme: Pick<TerminalThemeColors, 'background' | 'foreground'>
): AnsiTextStyle => {
  const style: AnsiTextStyle = {};
  const effectiveForeground = state.color ?? terminalTheme.foreground;
  const effectiveBackground = state.backgroundColor ?? terminalTheme.background;
  const resolvedForeground = state.inverse ? effectiveBackground : effectiveForeground;
  const resolvedBackground = state.inverse ? effectiveForeground : effectiveBackground;
  const finalForeground = state.dim ? applyForegroundDim(resolvedForeground) : resolvedForeground;

  if (state.color || state.dim || state.inverse) {
    style.color = finalForeground;
  }
  if (state.backgroundColor || state.inverse) {
    style.backgroundColor = resolvedBackground;
  }
  if (state.fontWeight) {
    style.fontWeight = state.fontWeight;
  }
  if (state.fontStyle) {
    style.fontStyle = state.fontStyle;
  }
  if (state.textDecoration) {
    style.textDecoration = state.textDecoration;
  }

  return style;
};

const setForeground = (
  code: number,
  state: ActiveAnsiState,
  terminalTheme: Pick<TerminalThemeColors, 'ansi'>
): void => {
  if (code >= 30 && code <= 37) {
    state.color = terminalTheme.ansi[code - 30];
    return;
  }
  if (code >= 90 && code <= 97) {
    state.color = terminalTheme.ansi[code - 82];
  }
};

const setBackground = (
  code: number,
  state: ActiveAnsiState,
  terminalTheme: Pick<TerminalThemeColors, 'ansi'>
): void => {
  if (code >= 40 && code <= 47) {
    state.backgroundColor = terminalTheme.ansi[code - 40];
    return;
  }
  if (code >= 100 && code <= 107) {
    state.backgroundColor = terminalTheme.ansi[code - 92];
  }
};

const applyExtendedColor = (
  codes: number[],
  index: number,
  state: ActiveAnsiState,
  target: 'fg' | 'bg',
  terminalTheme: Pick<TerminalThemeColors, 'ansi'>
): number => {
  const mode = codes[index + 1];
  if (mode === 5) {
    const paletteIndex = codes[index + 2];
    if (typeof paletteIndex === 'number') {
      const color = resolveAnsi256Color(paletteIndex, terminalTheme.ansi);
      if (target === 'fg') {
        state.color = color;
      } else {
        state.backgroundColor = color;
      }
    }
    return index + 2;
  }
  if (mode === 2) {
    const red = codes[index + 2];
    const green = codes[index + 3];
    const blue = codes[index + 4];
    if ([red, green, blue].every((value) => typeof value === 'number')) {
      const color = `rgb(${red}, ${green}, ${blue})`;
      if (target === 'fg') {
        state.color = color;
      } else {
        state.backgroundColor = color;
      }
    }
    return index + 4;
  }
  return index;
};

const applySgrCodes = (
  codes: number[],
  currentState: ActiveAnsiState,
  terminalTheme: Pick<TerminalThemeColors, 'ansi'>
): ActiveAnsiState => {
  const state = cloneState(currentState);
  const normalizedCodes = codes.length > 0 ? codes : [0];

  for (let i = 0; i < normalizedCodes.length; i += 1) {
    const code = normalizedCodes[i];
    switch (code) {
      case 0:
        delete state.color;
        delete state.backgroundColor;
        delete state.fontWeight;
        delete state.fontStyle;
        delete state.textDecoration;
        delete state.dim;
        delete state.inverse;
        break;
      case 1:
        state.fontWeight = '600';
        break;
      case 2:
        state.dim = true;
        break;
      case 3:
        state.fontStyle = 'italic';
        break;
      case 4:
        state.textDecoration = 'underline';
        break;
      case 7:
        state.inverse = true;
        break;
      case 22:
        delete state.fontWeight;
        delete state.dim;
        break;
      case 23:
        delete state.fontStyle;
        break;
      case 24:
        delete state.textDecoration;
        break;
      case 27:
        delete state.inverse;
        break;
      case 39:
        delete state.color;
        break;
      case 49:
        delete state.backgroundColor;
        break;
      case 38:
        i = applyExtendedColor(normalizedCodes, i, state, 'fg', terminalTheme);
        break;
      case 48:
        i = applyExtendedColor(normalizedCodes, i, state, 'bg', terminalTheme);
        break;
      default:
        if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
          setForeground(code, state, terminalTheme);
        } else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
          setBackground(code, state, terminalTheme);
        }
        break;
    }
  }

  return state;
};

export const parseAnsiTextSegments = (
  text: string,
  terminalTheme: Pick<
    TerminalThemeColors,
    'background' | 'foreground' | 'ansi'
  > = DEFAULT_TERMINAL_THEME
): AnsiTextSegment[] => {
  if (!text) {
    return [];
  }

  const segments: AnsiTextSegment[] = [];
  let activeState: ActiveAnsiState = {};
  let lastIndex = 0;

  for (const match of text.matchAll(ANSI_CAPTURE_PATTERN)) {
    const matchIndex = match.index ?? -1;
    if (matchIndex < 0) {
      continue;
    }
    if (matchIndex > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, matchIndex),
        style: materializeStyle(activeState, terminalTheme),
      });
    }

    const rawCodes = (match[1] ?? '')
      .split(';')
      .filter((value) => value.length > 0)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => !Number.isNaN(value));
    activeState = applySgrCodes(rawCodes, activeState, terminalTheme);
    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      style: materializeStyle(activeState, terminalTheme),
    });
  }

  return segments.filter((segment) => segment.text.length > 0);
};
