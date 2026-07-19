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
});
