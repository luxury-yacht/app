/**
 * frontend/src/shared/components/diff/diffUtils.ts
 *
 * Shared utilities for diff display, extracted from ObjectDiffModal.
 * Contains types and functions for merging and comparing diff lines.
 */

import {
  type DiffLine,
  type DiffLineType,
} from '@modules/object-panel/components/ObjectPanel/Yaml/yamlDiff';

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

// Merge adjacent remove/add blocks so modifications display on a single row.
export const mergeDiffLines = (lines: DiffLine[]): DisplayDiffLine[] => {
  const merged: DisplayDiffLine[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.type === 'context') {
      merged.push({
        ...line,
        leftType: 'context',
        rightType: 'context',
      });
      continue;
    }

    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (i < lines.length && lines[i].type !== 'context') {
      if (lines[i].type === 'removed') {
        removed.push(lines[i]);
      } else {
        added.push(lines[i]);
      }
      i += 1;
    }

    const maxCount = Math.max(removed.length, added.length);
    for (let idx = 0; idx < maxCount; idx += 1) {
      const removedLine = removed[idx];
      const addedLine = added[idx];
      if (removedLine && addedLine) {
        merged.push({
          type: 'context',
          value: '',
          leftLineNumber: removedLine.leftLineNumber,
          rightLineNumber: addedLine.rightLineNumber,
          leftType: 'removed',
          rightType: 'added',
        });
      } else if (removedLine) {
        merged.push({
          ...removedLine,
          leftType: 'removed',
          rightType: 'context',
        });
      } else if (addedLine) {
        merged.push({
          ...addedLine,
          leftType: 'context',
          rightType: 'added',
        });
      }
    }

    if (i < lines.length && lines[i].type === 'context') {
      i -= 1;
    }
  }

  return merged;
};
