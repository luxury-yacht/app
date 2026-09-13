/**
 * frontend/src/utils/ageFormatter.test.ts
 *
 * Test suite for ageFormatter.
 * Covers key behaviors and edge cases for ageFormatter.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatAge, parseCompactAgeToSeconds } from './ageFormatter';

describe('ageFormatter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses compact Kubernetes ages in one pass', () => {
    expect(parseCompactAgeToSeconds('1y2mo3d4h5m6s')).toBe(
      365 * 86400 + 2 * 30 * 86400 + 3 * 86400 + 4 * 3600 + 5 * 60 + 6
    );
    expect(parseCompactAgeToSeconds('prefix 12h suffix 3m')).toBe(12 * 3600 + 3 * 60);
    expect(parseCompactAgeToSeconds('future')).toBe(0);
    expect(parseCompactAgeToSeconds('-')).toBe(0);
  });

  it('formats durations into compact age strings', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'));

    expect(formatAge(null)).toBe('-');
    expect(formatAge('invalid')).toBe('-');
    expect(formatAge(new Date('2025-01-01T00:00:10Z'))).toBe('future');
    expect(formatAge(new Date('2025-01-01T00:00:00Z'))).toBe('now');
    expect(formatAge(new Date('2024-12-31T23:59:40Z'))).toBe('20s');
    expect(formatAge(new Date('2024-12-31T23:55:00Z'))).toBe('5m');
    expect(formatAge(new Date('2024-12-31T20:00:00Z'))).toBe('4h');
    expect(formatAge(new Date('2024-12-25T00:00:00Z'))).toBe('7d');
    expect(formatAge(new Date('2024-10-01T00:00:00Z'))).toBe('3mo');
    expect(formatAge(new Date('2023-01-01T00:00:00Z'))).toBe('2y');
  });
});
