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

  // The buffer also changes in its middle: a deleted pod's lines are dropped,
  // and a line that arrives late is inserted in time order.
  it('drops lines the buffer removed from its middle', () => {
    const [one, two, three, four, five, six] = [1, 2, 3, 4, 5, 6].map((n) => entry(n));
    const current = [one, two, three, four, five];
    const incoming = [one, three, five, six];

    expect(mergeAnchoredLogEntries(current, incoming).map(({ line }) => line)).toEqual([
      'line 1',
      'line 3',
      'line 5',
      'line 6',
    ]);
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
