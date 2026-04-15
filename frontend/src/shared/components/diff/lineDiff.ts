/**
 * frontend/src/shared/components/diff/lineDiff.ts
 *
 * Budget-aware Myers line diff implementation for large YAML surfaces.
 */

import type { LineDiffBudgets } from './diffBudgets';

export type DiffLineType = 'context' | 'added' | 'removed';

export interface DiffLine {
  type: DiffLineType;
  value: string;
  leftLineNumber?: number | null;
  rightLineNumber?: number | null;
}

export type LineDiffTooLargeReason = 'input' | 'compute';

export interface LineDiffResult {
  lines: DiffLine[];
  tooLarge: boolean;
  tooLargeReason: LineDiffTooLargeReason | null;
  leftLineCount: number;
  rightLineCount: number;
  computeWork: number;
}

const splitLines = (value: string): string[] => {
  const trimmed = value.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (trimmed === '') {
    return [];
  }
  return trimmed.split('\n');
};

const makeTooLargeResult = (
  reason: LineDiffTooLargeReason,
  leftLineCount: number,
  rightLineCount: number,
  computeWork: number
): LineDiffResult => ({
  lines: [],
  tooLarge: true,
  tooLargeReason: reason,
  leftLineCount,
  rightLineCount,
  computeWork,
});

const buildMyersTrace = (
  left: string[],
  right: string[],
  maxComputeWork: number
): {
  trace: number[][];
  computeWork: number;
} | null => {
  const max = left.length + right.length;
  const offset = max;
  const frontier = new Array<number>(2 * max + 1).fill(0);
  const trace: number[][] = [];
  let computeWork = 0;

  for (let distance = 0; distance <= max; distance += 1) {
    trace.push(frontier.slice());
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      computeWork += 1;
      if (computeWork > maxComputeWork) {
        return null;
      }

      let x: number;
      if (
        diagonal === -distance ||
        (diagonal !== distance && frontier[offset + diagonal - 1] < frontier[offset + diagonal + 1])
      ) {
        x = frontier[offset + diagonal + 1];
      } else {
        x = frontier[offset + diagonal - 1] + 1;
      }
      let y = x - diagonal;

      while (x < left.length && y < right.length && left[x] === right[y]) {
        computeWork += 1;
        if (computeWork > maxComputeWork) {
          return null;
        }
        x += 1;
        y += 1;
      }

      frontier[offset + diagonal] = x;
      if (x >= left.length && y >= right.length) {
        return {
          trace,
          computeWork,
        };
      }
    }
  }

  return {
    trace,
    computeWork,
  };
};

const backtrackMyersTrace = (left: string[], right: string[], trace: number[][]): DiffLine[] => {
  const max = left.length + right.length;
  const offset = max;
  const lines: DiffLine[] = [];
  let x = left.length;
  let y = right.length;

  for (let distance = trace.length - 1; distance >= 0; distance -= 1) {
    const frontier = trace[distance];
    const diagonal = x - y;

    let previousDiagonal: number;
    if (
      diagonal === -distance ||
      (diagonal !== distance && frontier[offset + diagonal - 1] < frontier[offset + diagonal + 1])
    ) {
      previousDiagonal = diagonal + 1;
    } else {
      previousDiagonal = diagonal - 1;
    }

    const previousX = frontier[offset + previousDiagonal];
    const previousY = previousX - previousDiagonal;

    while (x > previousX && y > previousY) {
      lines.push({
        type: 'context',
        value: left[x - 1],
        leftLineNumber: x,
        rightLineNumber: y,
      });
      x -= 1;
      y -= 1;
    }

    if (distance === 0) {
      break;
    }

    if (x === previousX) {
      lines.push({
        type: 'added',
        value: right[y - 1],
        rightLineNumber: y,
      });
      y -= 1;
    } else {
      lines.push({
        type: 'removed',
        value: left[x - 1],
        leftLineNumber: x,
      });
      x -= 1;
    }
  }

  return lines.reverse();
};

export const computeBudgetedLineDiff = (
  before: string,
  after: string,
  budgets: LineDiffBudgets
): LineDiffResult => {
  const left = splitLines(before);
  const right = splitLines(after);
  const leftLineCount = left.length;
  const rightLineCount = right.length;

  if (Math.max(leftLineCount, rightLineCount) > budgets.maxLinesPerSide) {
    return makeTooLargeResult('input', leftLineCount, rightLineCount, 0);
  }

  const trace = buildMyersTrace(left, right, budgets.maxComputeWork);
  if (!trace) {
    return makeTooLargeResult('compute', leftLineCount, rightLineCount, budgets.maxComputeWork);
  }

  return {
    lines: backtrackMyersTrace(left, right, trace.trace),
    tooLarge: false,
    tooLargeReason: null,
    leftLineCount,
    rightLineCount,
    computeWork: trace.computeWork,
  };
};
