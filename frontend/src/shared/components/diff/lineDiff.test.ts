import { describe, expect, it } from 'vitest';

import type { LineDiffBudgets } from './diffBudgets';
import { computeBudgetedLineDiff } from './lineDiff';

const TEST_BUDGETS: LineDiffBudgets = {
  maxLinesPerSide: 15_000,
  maxComputeWork: 3_000_000,
  maxRenderableRows: 8_000,
};

describe('computeBudgetedLineDiff', () => {
  it('covers computeBudgetedLineDiff scenarios', async () => {
    {
      // Scenario: preserves identical lines and their line numbers
      const result = computeBudgetedLineDiff('alpha\nbeta', 'alpha\nbeta', TEST_BUDGETS);

      expect(result.lines).toEqual([
        { type: 'context', value: 'alpha', leftLineNumber: 1, rightLineNumber: 1 },
        { type: 'context', value: 'beta', leftLineNumber: 2, rightLineNumber: 2 },
      ]);
    }
    // Scenario: handles empty inputs and one-sided additions or removals
    expect(computeBudgetedLineDiff('', '', TEST_BUDGETS).lines).toEqual([]);
    expect(computeBudgetedLineDiff('', 'alpha\nbeta', TEST_BUDGETS).lines).toEqual([
      { type: 'added', value: 'alpha', rightLineNumber: 1 },
      { type: 'added', value: 'beta', rightLineNumber: 2 },
    ]);
    expect(computeBudgetedLineDiff('alpha\nbeta', '', TEST_BUDGETS).lines).toEqual([
      { type: 'removed', value: 'alpha', leftLineNumber: 1 },
      { type: 'removed', value: 'beta', leftLineNumber: 2 },
    ]);

    {
      // Scenario: normalizes line endings before computing the trace
      const result = computeBudgetedLineDiff(
        'alpha\r\nbeta\rgamma',
        'alpha\nbeta\ngamma',
        TEST_BUDGETS
      );

      expect(result.lines.every((line) => line.type === 'context')).toBe(true);
      expect(result.leftLineCount).toBe(3);
      expect(result.rightLineCount).toBe(3);
    }

    {
      // Scenario: backtracks duplicate lines deterministically
      const result = computeBudgetedLineDiff('same\nleft\nsame', 'same\nright\nsame', TEST_BUDGETS);

      expect(result.lines).toEqual([
        { type: 'context', value: 'same', leftLineNumber: 1, rightLineNumber: 1 },
        { type: 'removed', value: 'left', leftLineNumber: 2 },
        { type: 'added', value: 'right', rightLineNumber: 2 },
        { type: 'context', value: 'same', leftLineNumber: 3, rightLineNumber: 3 },
      ]);
    }

    {
      // Scenario: produces context, added, and removed lines
      const before = ['apiVersion: v1', 'kind: Pod', 'metadata:', '  name: demo'].join('\n');
      const after = ['apiVersion: v1', 'kind: Deployment', 'metadata:', '  name: demo'].join('\n');

      const result = computeBudgetedLineDiff(before, after, TEST_BUDGETS);

      expect(result.tooLarge).toBe(false);
      expect(result.tooLargeReason).toBeNull();
      expect(
        result.lines.some((line) => line.type === 'removed' && line.value === 'kind: Pod')
      ).toBe(true);
      expect(
        result.lines.some((line) => line.type === 'added' && line.value === 'kind: Deployment')
      ).toBe(true);
      expect(result.lines[0]).toMatchObject({
        type: 'context',
        value: 'apiVersion: v1',
      });
    }

    {
      // Scenario: fails early when the input line budget is exceeded
      const before = new Array(15_001).fill('before').join('\n');
      const after = new Array(15_000).fill('after').join('\n');

      const result = computeBudgetedLineDiff(before, after, TEST_BUDGETS);

      expect(result.tooLarge).toBe(true);
      expect(result.tooLargeReason).toBe('input');
      expect(result.lines).toHaveLength(0);
    }

    {
      // Scenario: fails when compute work exceeds the configured budget
      const before = ['a', 'b', 'c', 'd', 'e', 'f'].join('\n');
      const after = ['u', 'v', 'w', 'x', 'y', 'z'].join('\n');

      const result = computeBudgetedLineDiff(before, after, {
        ...TEST_BUDGETS,
        maxComputeWork: 5,
      });

      expect(result.tooLarge).toBe(true);
      expect(result.tooLargeReason).toBe('compute');
      expect(result.lines).toHaveLength(0);
    }

    {
      // Scenario: handles large mostly-identical inputs near the target size
      const shared = Array.from({ length: 9_999 }, (_, index) => `line-${index + 1}`);
      const before = shared.join('\n');
      const after = [...shared.slice(0, -1), 'line-9999-updated'].join('\n');

      const result = computeBudgetedLineDiff(before, after, TEST_BUDGETS);

      expect(result.tooLarge).toBe(false);
      expect(result.leftLineCount).toBe(9_999);
      expect(result.rightLineCount).toBe(9_999);
      expect(
        result.lines.some((line) => line.type === 'removed' && line.value === 'line-9999')
      ).toBe(true);
      expect(
        result.lines.some((line) => line.type === 'added' && line.value === 'line-9999-updated')
      ).toBe(true);
    }
  });
});
