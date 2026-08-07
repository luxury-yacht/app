import { describe, expect, it } from 'vitest';
import {
  areTruncationMapsEqual,
  countVisibleDiffRows,
  formatTooLargeDiffMessage,
  mergeDiffLines,
} from './diffUtils';
import type { DiffLine } from './lineDiff';

describe('diffUtils', () => {
  it('keeps context rows aligned on both sides', () => {
    expect(
      mergeDiffLines([{ type: 'context', value: 'same', leftLineNumber: 1, rightLineNumber: 1 }])
    ).toEqual([
      {
        type: 'context',
        value: 'same',
        leftLineNumber: 1,
        rightLineNumber: 1,
        leftType: 'context',
        rightType: 'context',
      },
    ]);
  });

  it('pairs remove/add blocks and preserves unbalanced line numbers', () => {
    const lines: DiffLine[] = [
      { type: 'context', value: 'before', leftLineNumber: 1, rightLineNumber: 1 },
      { type: 'removed', value: 'old-a', leftLineNumber: 2 },
      { type: 'removed', value: 'old-b', leftLineNumber: 3 },
      { type: 'added', value: 'new-a', rightLineNumber: 2 },
      { type: 'context', value: 'after', leftLineNumber: 4, rightLineNumber: 3 },
    ];

    expect(mergeDiffLines(lines)).toEqual([
      {
        ...lines[0],
        leftType: 'context',
        rightType: 'context',
      },
      {
        type: 'context',
        value: '',
        leftLineNumber: 2,
        rightLineNumber: 2,
        leftType: 'removed',
        rightType: 'added',
      },
      {
        type: 'removed',
        value: 'old-b',
        leftLineNumber: 3,
        leftType: 'removed',
        rightType: 'context',
      },
      {
        ...lines[4],
        leftType: 'context',
        rightType: 'context',
      },
    ]);
  });

  it('pairs change blocks by side order even when additions arrive first', () => {
    const lines: DiffLine[] = [
      { type: 'added', value: 'new-a', rightLineNumber: 1 },
      { type: 'added', value: 'new-b', rightLineNumber: 2 },
      { type: 'removed', value: 'old-a', leftLineNumber: 1 },
    ];

    expect(mergeDiffLines(lines)).toEqual([
      {
        type: 'context',
        value: '',
        leftLineNumber: 1,
        rightLineNumber: 1,
        leftType: 'removed',
        rightType: 'added',
      },
      {
        type: 'added',
        value: 'new-b',
        rightLineNumber: 2,
        leftType: 'context',
        rightType: 'added',
      },
    ]);
  });

  it('compares truncation maps by row and side', () => {
    expect(
      areTruncationMapsEqual(
        { 1: { left: true, right: false } },
        { 1: { left: true, right: false } }
      )
    ).toBe(true);
    expect(
      areTruncationMapsEqual(
        { 1: { left: true, right: false } },
        { 1: { left: false, right: false } }
      )
    ).toBe(false);
    expect(areTruncationMapsEqual({}, { 1: { left: false, right: false } })).toBe(false);
  });

  it('counts full and changed-only rows', () => {
    const lines = mergeDiffLines([
      { type: 'context', value: 'same', leftLineNumber: 1, rightLineNumber: 1 },
      { type: 'removed', value: 'old', leftLineNumber: 2 },
      { type: 'added', value: 'new', rightLineNumber: 2 },
    ]);

    expect(countVisibleDiffRows(lines, false)).toBe(2);
    expect(countVisibleDiffRows(lines, true)).toBe(1);
  });

  it('formats the render-budget message with localized counts', () => {
    expect(formatTooLargeDiffMessage(12_345, 8_000)).toContain(
      `${(12_345).toLocaleString()} lines exceed the limit of ${(8_000).toLocaleString()}`
    );
  });
});
