import { describe, expect, it } from 'vitest';

import {
  DEFAULT_LOG_API_TIMESTAMP_FORMAT,
  DEFAULT_LOCAL_LOG_API_TIMESTAMP_FORMAT,
  formatDefaultLogApiTimestamp,
  formatLogApiTimestamp,
  getLogApiTimestampFormatValidationError,
  normalizeLogApiTimestampFormat,
} from './logApiTimestampFormat';

describe('logApiTimestampFormat', () => {
  it('accepts supported Day.js patterns used for log API timestamps', () => {
    expect(getLogApiTimestampFormatValidationError('YYYY-MM-DDTHH:mm:ss.SSS[Z]')).toBeNull();
    expect(getLogApiTimestampFormatValidationError('HH:mm:ss.SSS')).toBeNull();
    expect(getLogApiTimestampFormatValidationError('[ts=]HH:mm:ss.SSS')).toBeNull();
  });

  it('rejects unsupported tokens and malformed literals', () => {
    expect(getLogApiTimestampFormatValidationError('')).toContain('Enter a Day.js format pattern');
    expect(getLogApiTimestampFormatValidationError('foo')).toContain('Unsupported token');
    expect(getLogApiTimestampFormatValidationError('YYYY-QQ')).toContain('Unsupported token');
    expect(getLogApiTimestampFormatValidationError('[UTC')).toContain('matching [brackets]');
  });

  it('falls back to the default pattern when hydrating invalid values', () => {
    expect(normalizeLogApiTimestampFormat(undefined)).toBe(DEFAULT_LOG_API_TIMESTAMP_FORMAT);
    expect(normalizeLogApiTimestampFormat('foo')).toBe(DEFAULT_LOG_API_TIMESTAMP_FORMAT);
    expect(normalizeLogApiTimestampFormat(' HH:mm:ss.SSS ')).toBe('HH:mm:ss.SSS');
  });

  it('formats Kubernetes API timestamps in UTC using the provided pattern', () => {
    expect(formatLogApiTimestamp('2024-05-01T10:00:00.123456Z', 'HH:mm:ss.SSS')).toBe(
      '10:00:00.123'
    );
    expect(formatDefaultLogApiTimestamp('2024-05-01T10:00:00.123456Z')).toBe(
      '2024-05-01T10:00:00.123Z'
    );
  });

  it('formats Kubernetes API timestamps in the local timezone when enabled', () => {
    const timestamp = '2024-05-01T10:00:00.123456Z';
    const localDate = new Date(timestamp);
    const pad = (value: number, size = 2) => String(value).padStart(size, '0');
    const offsetMinutes = -localDate.getTimezoneOffset();
    const offsetSign = offsetMinutes >= 0 ? '+' : '-';
    const absoluteOffsetMinutes = Math.abs(offsetMinutes);
    const offsetHours = Math.floor(absoluteOffsetMinutes / 60);
    const offsetRemainderMinutes = absoluteOffsetMinutes % 60;
    const expectedDefault = [
      `${localDate.getFullYear()}-${pad(localDate.getMonth() + 1)}-${pad(localDate.getDate())}`,
      `T${pad(localDate.getHours())}:${pad(localDate.getMinutes())}:${pad(localDate.getSeconds())}.${pad(localDate.getMilliseconds(), 3)}`,
      `${offsetSign}${pad(offsetHours)}:${pad(offsetRemainderMinutes)}`,
    ].join('');

    expect(formatDefaultLogApiTimestamp(timestamp, true)).toBe(expectedDefault);
    expect(formatLogApiTimestamp(timestamp, 'HH:mm:ss.SSS Z', true)).toBe(
      `${pad(localDate.getHours())}:${pad(localDate.getMinutes())}:${pad(localDate.getSeconds())}.${pad(localDate.getMilliseconds(), 3)} ${offsetSign}${pad(offsetHours)}:${pad(offsetRemainderMinutes)}`
    );
    expect(DEFAULT_LOCAL_LOG_API_TIMESTAMP_FORMAT).toBe('YYYY-MM-DDTHH:mm:ss.SSSZ');
  });
});
