/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlDiff.ts
 *
 * UI component for yamlDiff.
 * Handles rendering and interactions for the object panel feature.
 */

export type DiffLineType = 'context' | 'added' | 'removed';

export interface DiffLine {
  type: DiffLineType;
  value: string;
  leftLineNumber?: number | null;
  rightLineNumber?: number | null;
}

export interface DiffResult {
  lines: DiffLine[];
  truncated: boolean;
}

const MAX_DIFF_LINES = 800;

const buildMatrix = (left: string[], right: string[]) => {
  const rows = left.length + 1;
  const cols = right.length + 1;
  const dp = Array.from({ length: rows }, () => new Array<number>(cols).fill(0));

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      if (left[i] === right[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
  }

  return dp;
};

export const computeLineDiff = (before: string, after: string): DiffResult => {
  const left = before.split(/\r?\n/);
  const right = after.split(/\r?\n/);

  if (left.length + right.length > MAX_DIFF_LINES) {
    return {
      lines: [],
      truncated: true,
    };
  }

  const dp = buildMatrix(left, right);
  const lines: DiffLine[] = [];
  let i = 0;
  let j = 0;
  let leftLineNumber = 1;
  let rightLineNumber = 1;

  const pushLine = (type: DiffLineType, value: string) => {
    lines.push({
      type,
      value,
      leftLineNumber: type === 'added' ? null : leftLineNumber,
      rightLineNumber: type === 'removed' ? null : rightLineNumber,
    });
  };

  while (i < left.length && j < right.length) {
    if (left[i] === right[j]) {
      pushLine('context', left[i]);
      i += 1;
      j += 1;
      leftLineNumber += 1;
      rightLineNumber += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      pushLine('removed', left[i]);
      i += 1;
      leftLineNumber += 1;
    } else {
      pushLine('added', right[j]);
      j += 1;
      rightLineNumber += 1;
    }
  }

  while (i < left.length) {
    pushLine('removed', left[i]);
    i += 1;
    leftLineNumber += 1;
  }

  while (j < right.length) {
    pushLine('added', right[j]);
    j += 1;
    rightLineNumber += 1;
  }

  return {
    lines,
    truncated: false,
  };
};
