import { describe, expect, it } from 'vitest';

import {
  DEFAULT_OBJ_PANEL_LOGS_API_TIMESTAMP_FORMAT,
  DEFAULT_LOCAL_OBJ_PANEL_LOGS_API_TIMESTAMP_FORMAT,
  formatDefaultObjPanelLogsApiTimestamp,
  formatObjPanelLogsApiTimestamp,
  getObjPanelLogsApiTimestampFormatValidationError,
  normalizeObjPanelLogsApiTimestampFormat,
} from './objPanelLogsApiTimestampFormat';

describe('objPanelLogsApiTimestampFormat', () => {
  it('accepts supported Day.js patterns used for Object Panel Logs Tab API timestamps', () => {
    expect(
      getObjPanelLogsApiTimestampFormatValidationError('YYYY-MM-DDTHH:mm:ss.SSS[Z]')
    ).toBeNull();
    expect(getObjPanelLogsApiTimestampFormatValidationError('HH:mm:ss.SSS')).toBeNull();
    expect(getObjPanelLogsApiTimestampFormatValidationError('[ts=]HH:mm:ss.SSS')).toBeNull();
  });

  it('rejects unsupported tokens and malformed literals', () => {
    expect(getObjPanelLogsApiTimestampFormatValidationError('')).toContain(
      'Enter a Day.js format pattern'
    );
    expect(getObjPanelLogsApiTimestampFormatValidationError('foo')).toContain('Unsupported token');
    expect(getObjPanelLogsApiTimestampFormatValidationError('YYYY-QQ')).toContain(
      'Unsupported token'
    );
    expect(getObjPanelLogsApiTimestampFormatValidationError('[UTC')).toContain(
      'matching [brackets]'
    );
  });

  it('falls back to the default pattern when hydrating invalid values', () => {
    expect(normalizeObjPanelLogsApiTimestampFormat(undefined)).toBe(
      DEFAULT_OBJ_PANEL_LOGS_API_TIMESTAMP_FORMAT
    );
    expect(normalizeObjPanelLogsApiTimestampFormat('foo')).toBe(
      DEFAULT_OBJ_PANEL_LOGS_API_TIMESTAMP_FORMAT
    );
    expect(normalizeObjPanelLogsApiTimestampFormat(' HH:mm:ss.SSS ')).toBe('HH:mm:ss.SSS');
  });

  it('formats Kubernetes API timestamps in UTC using the provided pattern', () => {
    expect(formatObjPanelLogsApiTimestamp('2024-05-01T10:00:00.123456Z', 'HH:mm:ss.SSS')).toBe(
      '10:00:00.123'
    );
    expect(formatDefaultObjPanelLogsApiTimestamp('2024-05-01T10:00:00.123456Z')).toBe(
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

    expect(formatDefaultObjPanelLogsApiTimestamp(timestamp, true)).toBe(expectedDefault);
    expect(formatObjPanelLogsApiTimestamp(timestamp, 'HH:mm:ss.SSS Z', true)).toBe(
      `${pad(localDate.getHours())}:${pad(localDate.getMinutes())}:${pad(localDate.getSeconds())}.${pad(localDate.getMilliseconds(), 3)} ${offsetSign}${pad(offsetHours)}:${pad(offsetRemainderMinutes)}`
    );
    expect(DEFAULT_LOCAL_OBJ_PANEL_LOGS_API_TIMESTAMP_FORMAT).toBe('YYYY-MM-DDTHH:mm:ss.SSSZ');
  });
});
