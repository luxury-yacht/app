import { compareUtf16Strings } from '@/shared/utils/sort';
import { stripAnsi } from './ansi';
import type { ParsedLogEntry } from './logOptionsReducer';

export const formatParsedValue = (value: unknown): string => {
  if (value === undefined || value === null) {
    return '-';
  }
  if (typeof value === 'object') {
    return JSON.stringify(value);
  }
  if (typeof value === 'string') {
    return value.length > 0 ? value : '-';
  }
  const stringified = String(value);
  return stringified.length > 0 ? stringified : '-';
};

// Only text whose first visible character is "{" can parse to an object;
// checking first keeps plain-text lines from throwing in JSON.parse.
const OBJECT_START = /^\s*\{/;

export const tryParseJSONObject = (line: string): Record<string, unknown> | null => {
  const text = stripAnsi(line);
  if (!OBJECT_START.test(text)) {
    return null;
  }
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return Object.keys(parsed).length > 0 ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
};

export const deriveParsedLogFieldKeys = (entries: ParsedLogEntry[]): string[] => {
  if (entries.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  for (const entry of entries) {
    for (const key of Object.keys(entry.data)) {
      seen.add(key);
    }
  }
  return Array.from(seen).sort(compareUtf16Strings);
};

/**
 * The line as a view shows it. Only the JSON views parse it; a caller that has
 * already parsed the line passes the result as `parsedJson`.
 */
export const formatRawOrPrettyJsonLine = (
  line: string,
  displayMode: 'raw' | 'pretty' | 'structured' | 'parsed',
  showAnsiColors: boolean,
  parsedJson?: Record<string, unknown> | null
): string => {
  const normalizedLine = showAnsiColors ? line : stripAnsi(line);
  if (displayMode !== 'structured' && displayMode !== 'pretty') {
    return normalizedLine;
  }
  const parsed = parsedJson === undefined ? tryParseJSONObject(line) : parsedJson;
  if (!parsed) {
    return normalizedLine;
  }
  return displayMode === 'pretty' ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed);
};

export const getParsedLogRowKey = (
  entry: Partial<ParsedLogEntry>,
  fallbackIndex?: number
): string => `log-${entry.seq ?? entry.lineNumber ?? fallbackIndex ?? 0}`;
