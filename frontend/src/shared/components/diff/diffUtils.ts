/**
 * frontend/src/shared/components/diff/diffUtils.ts
 *
 * Shared utilities for diff display, extracted from ObjectDiffModal.
 * Contains types and functions for merging and comparing diff lines.
 */

import type { DiffLine, DiffLineType } from '@shared/components/diff/lineDiff';

// Re-export DiffLineType for consumers of this module.
export type { DiffLineType };

// A DiffLine extended with explicit left/right column type annotations,
// used to drive side-by-side diff rendering.
export type DisplayDiffLine = DiffLine & {
  leftType: DiffLineType;
  rightType: DiffLineType;
};

// Maps a line index to whether its left and right columns are truncated.
export type TruncationMap = Record<number, { left: boolean; right: boolean }>;

// Returns true if two TruncationMaps have the same keys and values.
export const areTruncationMapsEqual = (left: TruncationMap, right: TruncationMap) => {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) => {
    const index = Number(key);
    const leftValue = left[index];
    const rightValue = right[index];
    if (!rightValue) {
      return false;
    }
    return leftValue.left === rightValue.left && leftValue.right === rightValue.right;
  });
};

interface DiffChangeBlock {
  removed: DiffLine[];
  added: DiffLine[];
  nextIndex: number;
}

const collectDiffChangeBlock = (lines: DiffLine[], startIndex: number): DiffChangeBlock => {
  const removed: DiffLine[] = [];
  const added: DiffLine[] = [];
  let nextIndex = startIndex;
  while (nextIndex < lines.length && lines[nextIndex].type !== 'context') {
    if (lines[nextIndex].type === 'removed') {
      removed.push(lines[nextIndex]);
    } else {
      added.push(lines[nextIndex]);
    }
    nextIndex += 1;
  }
  return { removed, added, nextIndex };
};

const mergeDiffChangePair = (
  removedLine: DiffLine | undefined,
  addedLine: DiffLine | undefined
): DisplayDiffLine | null => {
  if (removedLine && addedLine) {
    return {
      type: 'context',
      value: '',
      leftLineNumber: removedLine.leftLineNumber,
      rightLineNumber: addedLine.rightLineNumber,
      leftType: 'removed',
      rightType: 'added',
    };
  }
  if (removedLine) {
    return {
      ...removedLine,
      leftType: 'removed',
      rightType: 'context',
    };
  }
  if (addedLine) {
    return {
      ...addedLine,
      leftType: 'context',
      rightType: 'added',
    };
  }
  return null;
};

const mergeDiffChangeBlock = ({ removed, added }: DiffChangeBlock): DisplayDiffLine[] => {
  const merged: DisplayDiffLine[] = [];
  const rowCount = Math.max(removed.length, added.length);
  for (let index = 0; index < rowCount; index += 1) {
    const row = mergeDiffChangePair(removed[index], added[index]);
    if (row) {
      merged.push(row);
    }
  }
  return merged;
};

const displayContextLine = (line: DiffLine): DisplayDiffLine => ({
  ...line,
  leftType: 'context',
  rightType: 'context',
});

// Merge adjacent remove/add blocks so modifications display on a single row.
export const mergeDiffLines = (lines: DiffLine[]): DisplayDiffLine[] => {
  const merged: DisplayDiffLine[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.type === 'context') {
      merged.push(displayContextLine(line));
      index += 1;
      continue;
    }

    const block = collectDiffChangeBlock(lines, index);
    merged.push(...mergeDiffChangeBlock(block));
    index = block.nextIndex;
  }
  return merged;
};

export const countVisibleDiffRows = (lines: DisplayDiffLine[], showDiffOnly: boolean): number => {
  if (!showDiffOnly) {
    return lines.length;
  }
  return lines.filter((line) => line.leftType !== 'context' || line.rightType !== 'context').length;
};

export const formatTooLargeDiffMessage = (actualLines: number, limit: number): string =>
  `The diff is too large to display in the current view (${actualLines.toLocaleString()} lines exceed the limit of ${limit.toLocaleString()}).`;
