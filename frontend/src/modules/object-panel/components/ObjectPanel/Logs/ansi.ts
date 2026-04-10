/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/ansi.ts
 *
 * Helpers for detecting, stripping, and parsing ANSI SGR color/style
 * sequences embedded in log lines.
 */

export interface AnsiTextStyle {
  color?: string;
  backgroundColor?: string;
  fontWeight?: string;
  opacity?: string;
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

const ANSI_COLORS = [
  '#111827',
  '#b91c1c',
  '#047857',
  '#b45309',
  '#1d4ed8',
  '#7c3aed',
  '#0f766e',
  '#6b7280',
];
const ANSI_BRIGHT_COLORS = [
  '#374151',
  '#ef4444',
  '#22c55e',
  '#f59e0b',
  '#3b82f6',
  '#a855f7',
  '#14b8a6',
  '#e5e7eb',
];

const cloneStyle = (style: AnsiTextStyle): AnsiTextStyle => ({ ...style });

export const containsAnsi = (text: string): boolean => ANSI_TEST_PATTERN.test(text);

export const stripAnsi = (text: string): string => text.replace(ANSI_PATTERN, '');

const setForeground = (code: number, style: AnsiTextStyle): void => {
  if (code >= 30 && code <= 37) {
    style.color = ANSI_COLORS[code - 30];
    return;
  }
  if (code >= 90 && code <= 97) {
    style.color = ANSI_BRIGHT_COLORS[code - 90];
  }
};

const setBackground = (code: number, style: AnsiTextStyle): void => {
  if (code >= 40 && code <= 47) {
    style.backgroundColor = ANSI_COLORS[code - 40];
    return;
  }
  if (code >= 100 && code <= 107) {
    style.backgroundColor = ANSI_BRIGHT_COLORS[code - 100];
  }
};

const ansi256ToHex = (index: number): string => {
  if (index < 0) {
    return '#000000';
  }
  if (index < 16) {
    const palette = [...ANSI_COLORS, ...ANSI_BRIGHT_COLORS];
    return palette[index] ?? '#000000';
  }
  if (index >= 232) {
    const gray = 8 + (index - 232) * 10;
    const hex = gray.toString(16).padStart(2, '0');
    return `#${hex}${hex}${hex}`;
  }

  const value = index - 16;
  const r = Math.floor(value / 36);
  const g = Math.floor((value % 36) / 6);
  const b = value % 6;
  const steps = [0, 95, 135, 175, 215, 255];
  return `#${steps[r].toString(16).padStart(2, '0')}${steps[g]
    .toString(16)
    .padStart(2, '0')}${steps[b].toString(16).padStart(2, '0')}`;
};

const applyExtendedColor = (
  codes: number[],
  index: number,
  style: AnsiTextStyle,
  target: 'fg' | 'bg'
): number => {
  const mode = codes[index + 1];
  if (mode === 5) {
    const paletteIndex = codes[index + 2];
    if (typeof paletteIndex === 'number') {
      if (target === 'fg') {
        style.color = ansi256ToHex(paletteIndex);
      } else {
        style.backgroundColor = ansi256ToHex(paletteIndex);
      }
    }
    return index + 2;
  }
  if (mode === 2) {
    const r = codes[index + 2];
    const g = codes[index + 3];
    const b = codes[index + 4];
    if ([r, g, b].every((value) => typeof value === 'number')) {
      const color = `rgb(${r}, ${g}, ${b})`;
      if (target === 'fg') {
        style.color = color;
      } else {
        style.backgroundColor = color;
      }
    }
    return index + 4;
  }
  return index;
};

const applySgrCodes = (codes: number[], currentStyle: AnsiTextStyle): AnsiTextStyle => {
  const style = cloneStyle(currentStyle);
  const normalizedCodes = codes.length > 0 ? codes : [0];

  for (let i = 0; i < normalizedCodes.length; i += 1) {
    const code = normalizedCodes[i];
    switch (code) {
      case 0:
        delete style.color;
        delete style.backgroundColor;
        delete style.fontWeight;
        delete style.opacity;
        delete style.fontStyle;
        delete style.textDecoration;
        break;
      case 1:
        style.fontWeight = '600';
        break;
      case 2:
        style.opacity = '0.7';
        break;
      case 3:
        style.fontStyle = 'italic';
        break;
      case 4:
        style.textDecoration = 'underline';
        break;
      case 22:
        delete style.fontWeight;
        delete style.opacity;
        break;
      case 23:
        delete style.fontStyle;
        break;
      case 24:
        delete style.textDecoration;
        break;
      case 39:
        delete style.color;
        break;
      case 49:
        delete style.backgroundColor;
        break;
      case 38:
        i = applyExtendedColor(normalizedCodes, i, style, 'fg');
        break;
      case 48:
        i = applyExtendedColor(normalizedCodes, i, style, 'bg');
        break;
      default:
        if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
          setForeground(code, style);
        } else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
          setBackground(code, style);
        }
        break;
    }
  }

  return style;
};

export const parseAnsiTextSegments = (text: string): AnsiTextSegment[] => {
  if (!text) {
    return [];
  }

  const segments: AnsiTextSegment[] = [];
  let activeStyle: AnsiTextStyle = {};
  let lastIndex = 0;

  for (const match of text.matchAll(ANSI_CAPTURE_PATTERN)) {
    const matchIndex = match.index ?? -1;
    if (matchIndex < 0) {
      continue;
    }
    if (matchIndex > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, matchIndex),
        style: cloneStyle(activeStyle),
      });
    }

    const rawCodes = (match[1] ?? '')
      .split(';')
      .filter((value) => value.length > 0)
      .map((value) => Number.parseInt(value, 10))
      .filter((value) => !Number.isNaN(value));
    activeStyle = applySgrCodes(rawCodes, activeStyle);
    lastIndex = matchIndex + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      style: cloneStyle(activeStyle),
    });
  }

  return segments.filter((segment) => segment.text.length > 0);
};
