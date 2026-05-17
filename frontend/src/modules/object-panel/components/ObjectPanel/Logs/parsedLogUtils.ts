import { stripAnsi } from './ansi';
import type { ParsedLogEntry } from './logViewerReducer';

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

export const tryParseJSONObject = (line: string): Record<string, unknown> | null => {
  try {
    const parsed = JSON.parse(stripAnsi(line));
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
  return Array.from(seen).sort();
};

export const formatRawOrPrettyJsonLine = (
  line: string,
  displayMode: 'raw' | 'pretty' | 'structured' | 'parsed',
  showAnsiColors: boolean
): string => {
  const parsed = tryParseJSONObject(line);
  const normalizedLine = showAnsiColors ? line : stripAnsi(line);

  if (displayMode === 'structured') {
    return parsed ? JSON.stringify(parsed) : normalizedLine;
  }
  if (displayMode === 'pretty') {
    return parsed ? JSON.stringify(parsed, null, 2) : normalizedLine;
  }
  return normalizedLine;
};

export const getParsedLogRowKey = (
  entry: Partial<ParsedLogEntry>,
  fallbackIndex?: number
): string => `log-${entry.seq ?? entry.lineNumber ?? fallbackIndex ?? 0}`;
