import { describe, expect, it } from 'vitest';
import type { ContainerLogsEntry } from '@/core/refresh/types';
import { mergeAnchoredLogEntries } from './useAnchoredLogEntries';

const entry = (sequence: number, lineNumber = sequence): ContainerLogsEntry => ({
  _seq: sequence,
  timestamp: `2024-05-01T10:00:${String(lineNumber).padStart(2, '0')}Z`,
  pod: 'web-1',
  container: 'app',
  line: `line ${lineNumber}`,
  isInit: false,
});

describe('mergeAnchoredLogEntries', () => {
  it('retains trimmed head entries and appends the new tail', () => {
    const current = [entry(1), entry(2), entry(3)];
    const incoming = [entry(2), entry(3), entry(4)];

    expect(mergeAnchoredLogEntries(current, incoming).map(({ line }) => line)).toEqual([
      'line 1',
      'line 2',
      'line 3',
      'line 4',
    ]);
  });

  it('recognizes fallback snapshot overlap when sequence keys are regenerated', () => {
    const current = [entry(1, 1), entry(2, 2), entry(3, 3)];
    const incoming = [entry(101, 1), entry(102, 2), entry(103, 3), entry(104, 4)];

    expect(mergeAnchoredLogEntries(current, incoming).map(({ line }) => line)).toEqual([
      'line 1',
      'line 2',
      'line 3',
      'line 4',
    ]);
  });

  it('keeps the anchored snapshot when an incoming snapshot is already represented', () => {
    const current = [entry(1), entry(2), entry(3), entry(4)];
    const incoming = [entry(2), entry(3), entry(4)];

    expect(mergeAnchoredLogEntries(current, incoming)).toBe(current);
  });

  // A late line is shown after the rows already shown but sits early in the
  // buffer, so the buffer can evict it first; the paused view keeps it.
  it('keeps a shown late line that the buffer evicts', () => {
    const [a, b, c, late, e, f] = [2, 3, 4, 1, 5, 6].map((n) => entry(n));
    const current = [a, b, c, late, e];
    const incoming = [a, b, c, e, f];

    expect(mergeAnchoredLogEntries(current, incoming).map(({ line }) => line)).toEqual([
      'line 2',
      'line 3',
      'line 4',
      'line 1',
      'line 5',
      'line 6',
    ]);
  });

  it('drops the lines of pods the workload no longer has', () => {
    const shown = entry(1);
    const deleted = { ...entry(2), pod: 'web-2' };
    const next = entry(3);

    expect(
      mergeAnchoredLogEntries([shown, deleted], [shown, deleted, next], new Set(['web-2'])).map(
        ({ line }) => line
      )
    ).toEqual(['line 1', 'line 3']);
  });

  it('adds a line inserted into the middle of the buffer after the rows shown', () => {
    const [one, two, three, five] = [1, 2, 3, 5].map((n) => entry(n));
    const current = [one, three, five];
    const incoming = [one, two, three, five];

    expect(mergeAnchoredLogEntries(current, incoming).map(({ line }) => line)).toEqual([
      'line 1',
      'line 3',
      'line 5',
      'line 2',
    ]);
  });
});
