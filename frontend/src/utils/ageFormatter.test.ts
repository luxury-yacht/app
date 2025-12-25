/**
 * frontend/src/utils/ageFormatter.test.ts
 *
 * Test suite for ageFormatter.
 * Covers key behaviors and edge cases for ageFormatter.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatAge, formatFullDate } from './ageFormatter';

describe('ageFormatter', () => {
  afterEach(() => {
    vi.useRealTimers();
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

  it('falls back to human readable dates when requested', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2025-01-01T12:00:00Z'));

    expect(formatFullDate(null)).toBe('-');
    expect(formatFullDate('invalid')).toBe('-');

    const timestamp = new Date('2024-12-31T23:45:00Z');
    expect(formatFullDate(timestamp)).toBe(timestamp.toLocaleString());
  });
});
