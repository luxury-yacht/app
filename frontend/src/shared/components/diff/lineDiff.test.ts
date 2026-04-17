import { describe, expect, it } from 'vitest';

import type { LineDiffBudgets } from './diffBudgets';
import { computeBudgetedLineDiff } from './lineDiff';

const TEST_BUDGETS: LineDiffBudgets = {
  maxLinesPerSide: 15_000,
  maxComputeWork: 3_000_000,
  maxRenderableRows: 8_000,
};

describe('computeBudgetedLineDiff', () => {
  it('produces context, added, and removed lines', () => {
    const before = ['apiVersion: v1', 'kind: Pod', 'metadata:', '  name: demo'].join('\n');
    const after = ['apiVersion: v1', 'kind: Deployment', 'metadata:', '  name: demo'].join('\n');

    const result = computeBudgetedLineDiff(before, after, TEST_BUDGETS);

    expect(result.tooLarge).toBe(false);
    expect(result.tooLargeReason).toBeNull();
    expect(result.lines.some((line) => line.type === 'removed' && line.value === 'kind: Pod')).toBe(
      true
    );
    expect(
      result.lines.some((line) => line.type === 'added' && line.value === 'kind: Deployment')
    ).toBe(true);
    expect(result.lines[0]).toMatchObject({
      type: 'context',
      value: 'apiVersion: v1',
    });
  });

  it('fails early when the input line budget is exceeded', () => {
    const before = new Array(15_001).fill('before').join('\n');
    const after = new Array(15_000).fill('after').join('\n');

    const result = computeBudgetedLineDiff(before, after, TEST_BUDGETS);

    expect(result.tooLarge).toBe(true);
    expect(result.tooLargeReason).toBe('input');
    expect(result.lines).toHaveLength(0);
  });

  it('fails when compute work exceeds the configured budget', () => {
    const before = ['a', 'b', 'c', 'd', 'e', 'f'].join('\n');
    const after = ['u', 'v', 'w', 'x', 'y', 'z'].join('\n');

    const result = computeBudgetedLineDiff(before, after, {
      ...TEST_BUDGETS,
      maxComputeWork: 5,
    });

    expect(result.tooLarge).toBe(true);
    expect(result.tooLargeReason).toBe('compute');
    expect(result.lines).toHaveLength(0);
  });

  it('handles large mostly-identical inputs near the target size', () => {
    const shared = Array.from({ length: 9_999 }, (_, index) => `line-${index + 1}`);
    const before = shared.join('\n');
    const after = [...shared.slice(0, -1), 'line-9999-updated'].join('\n');

    const result = computeBudgetedLineDiff(before, after, TEST_BUDGETS);

    expect(result.tooLarge).toBe(false);
    expect(result.leftLineCount).toBe(9_999);
    expect(result.rightLineCount).toBe(9_999);
    expect(result.lines.some((line) => line.type === 'removed' && line.value === 'line-9999')).toBe(
      true
    );
    expect(
      result.lines.some((line) => line.type === 'added' && line.value === 'line-9999-updated')
    ).toBe(true);
  });
});
