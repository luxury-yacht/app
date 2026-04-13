import { stripAnsi } from './ansi';

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
