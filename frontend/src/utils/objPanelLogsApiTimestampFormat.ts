import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

export const DEFAULT_OBJ_PANEL_LOGS_API_TIMESTAMP_FORMAT = 'YYYY-MM-DDTHH:mm:ss.SSS[Z]';
export const DEFAULT_LOCAL_OBJ_PANEL_LOGS_API_TIMESTAMP_FORMAT = 'YYYY-MM-DDTHH:mm:ss.SSSZ';

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

const truncateObjPanelLogsApiTimestampToMillis = (timestamp: string): string => {
  const dateTimeLength = 19;
  const separatorByIndex: Record<number, string> = { 4: '-', 7: '-', 10: 'T', 13: ':', 16: ':' };
  let hasDateTimeShape = timestamp.length > dateTimeLength && timestamp[dateTimeLength] === '.';
  for (let index = 0; hasDateTimeShape && index < dateTimeLength; index += 1) {
    const separator = separatorByIndex[index];
    const character = timestamp[index];
    hasDateTimeShape = separator
      ? character === separator
      : character !== undefined && character >= '0' && character <= '9';
  }
  if (hasDateTimeShape) {
    let nanosEnd = dateTimeLength + 1;
    while (
      timestamp[nanosEnd] !== undefined &&
      timestamp[nanosEnd] >= '0' &&
      timestamp[nanosEnd] <= '9'
    ) {
      nanosEnd += 1;
    }
    const nanos = timestamp.slice(dateTimeLength + 1, nanosEnd);
    if (!nanos) {
      return timestamp;
    }
    const dateTime = timestamp.slice(0, dateTimeLength);
    const rest = timestamp.slice(nanosEnd);
    const millis = nanos.substring(0, 3).padEnd(3, '0');
    return `${dateTime}.${millis}${rest}`;
  }
  return timestamp;
};

const isAsciiLetter = (value: string): boolean => /[A-Za-z]/.test(value);

export const getObjPanelLogsApiTimestampFormatValidationError = (format: string): string | null => {
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

const isValidObjPanelLogsApiTimestampFormat = (format: string): boolean =>
  getObjPanelLogsApiTimestampFormatValidationError(format) === null;

export const normalizeObjPanelLogsApiTimestampFormat = (
  format: string | null | undefined
): string => {
  if (typeof format !== 'string') {
    return DEFAULT_OBJ_PANEL_LOGS_API_TIMESTAMP_FORMAT;
  }
  const trimmed = format.trim();
  return isValidObjPanelLogsApiTimestampFormat(trimmed)
    ? trimmed
    : DEFAULT_OBJ_PANEL_LOGS_API_TIMESTAMP_FORMAT;
};

// Log views format every line with the same format; validate it once.
let lastFormat: string | undefined;
let lastNormalizedFormat = DEFAULT_OBJ_PANEL_LOGS_API_TIMESTAMP_FORMAT;
const normalizeFormatOnce = (format: string): string => {
  if (format !== lastFormat) {
    lastFormat = format;
    lastNormalizedFormat = normalizeObjPanelLogsApiTimestampFormat(format);
  }
  return lastNormalizedFormat;
};

export const formatObjPanelLogsApiTimestamp = (
  timestamp: string,
  format: string,
  useLocalTimeZone: boolean = false
): string => {
  if (!timestamp) {
    return '';
  }

  const normalizedFormat = normalizeFormatOnce(format);
  if (normalizedFormat === DEFAULT_OBJ_PANEL_LOGS_API_TIMESTAMP_FORMAT && !useLocalTimeZone) {
    return truncateObjPanelLogsApiTimestampToMillis(timestamp);
  }

  const parsed = dayjs.utc(timestamp);
  if (!parsed.isValid()) {
    return truncateObjPanelLogsApiTimestampToMillis(timestamp);
  }

  if (normalizedFormat === DEFAULT_OBJ_PANEL_LOGS_API_TIMESTAMP_FORMAT && useLocalTimeZone) {
    return parsed.local().format(DEFAULT_LOCAL_OBJ_PANEL_LOGS_API_TIMESTAMP_FORMAT);
  }

  return (useLocalTimeZone ? parsed.local() : parsed).format(normalizedFormat);
};

export const formatDefaultObjPanelLogsApiTimestamp = (
  timestamp: string,
  useLocalTimeZone: boolean = false
): string =>
  formatObjPanelLogsApiTimestamp(
    timestamp,
    DEFAULT_OBJ_PANEL_LOGS_API_TIMESTAMP_FORMAT,
    useLocalTimeZone
  );
