import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

export const DEFAULT_LOG_API_TIMESTAMP_FORMAT = 'YYYY-MM-DDTHH:mm:ss.SSS[Z]';
export const DEFAULT_LOCAL_LOG_API_TIMESTAMP_FORMAT = 'YYYY-MM-DDTHH:mm:ss.SSSZ';

const SUPPORTED_DAYJS_TOKENS = [
  'YYYY',
  'YY',
  'MMMM',
  'MMM',
  'MM',
  'M',
  'DD',
  'D',
  'dddd',
  'ddd',
  'dd',
  'd',
  'HH',
  'H',
  'hh',
  'h',
  'mm',
  'm',
  'ss',
  's',
  'SSS',
  'A',
  'a',
  'ZZ',
  'Z',
].sort((a, b) => b.length - a.length);

const truncateLogApiTimestampToMillis = (timestamp: string): string => {
  const match = timestamp.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d+)(.*)$/);
  if (match) {
    const [, dateTime, nanos, rest] = match;
    const millis = nanos.substring(0, 3).padEnd(3, '0');
    return `${dateTime}.${millis}${rest}`;
  }
  return timestamp;
};

const isAsciiLetter = (value: string): boolean => /[A-Za-z]/.test(value);

export const getLogApiTimestampFormatValidationError = (format: string): string | null => {
  const trimmed = format.trim();
  if (trimmed.length === 0) {
    return 'Enter a Day.js format pattern.';
  }

  let cursor = 0;
  let sawToken = false;

  while (cursor < trimmed.length) {
    if (trimmed[cursor] === '[') {
      const closing = trimmed.indexOf(']', cursor + 1);
      if (closing === -1) {
        return 'Literal text must use matching [brackets].';
      }
      cursor = closing + 1;
      continue;
    }

    const token = SUPPORTED_DAYJS_TOKENS.find((candidate) => trimmed.startsWith(candidate, cursor));
    if (token) {
      sawToken = true;
      cursor += token.length;
      continue;
    }

    const char = trimmed[cursor];
    if (char === 'T') {
      cursor += 1;
      continue;
    }
    if (isAsciiLetter(char)) {
      return 'Unsupported token. Use Day.js tokens and wrap literal text in [brackets].';
    }
    cursor += 1;
  }

  if (!sawToken) {
    return 'Include at least one Day.js date/time token.';
  }

  return null;
};

export const isValidLogApiTimestampFormat = (format: string): boolean =>
  getLogApiTimestampFormatValidationError(format) === null;

export const normalizeLogApiTimestampFormat = (format: string | null | undefined): string => {
  if (typeof format !== 'string') {
    return DEFAULT_LOG_API_TIMESTAMP_FORMAT;
  }
  const trimmed = format.trim();
  return isValidLogApiTimestampFormat(trimmed) ? trimmed : DEFAULT_LOG_API_TIMESTAMP_FORMAT;
};

export const formatLogApiTimestamp = (
  timestamp: string,
  format: string,
  useLocalTimeZone: boolean = false
): string => {
  if (!timestamp) {
    return '';
  }

  const normalizedFormat = normalizeLogApiTimestampFormat(format);
  if (normalizedFormat === DEFAULT_LOG_API_TIMESTAMP_FORMAT && !useLocalTimeZone) {
    return truncateLogApiTimestampToMillis(timestamp);
  }

  const parsed = dayjs.utc(timestamp);
  if (!parsed.isValid()) {
    return truncateLogApiTimestampToMillis(timestamp);
  }

  if (normalizedFormat === DEFAULT_LOG_API_TIMESTAMP_FORMAT && useLocalTimeZone) {
    return parsed.local().format(DEFAULT_LOCAL_LOG_API_TIMESTAMP_FORMAT);
  }

  return (useLocalTimeZone ? parsed.local() : parsed).format(normalizedFormat);
};

export const formatDefaultLogApiTimestamp = (
  timestamp: string,
  useLocalTimeZone: boolean = false
): string => formatLogApiTimestamp(timestamp, DEFAULT_LOG_API_TIMESTAMP_FORMAT, useLocalTimeZone);
