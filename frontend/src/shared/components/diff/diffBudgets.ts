/**
 * frontend/src/shared/components/diff/diffBudgets.ts
 *
 * Shared budget definitions for line-based diff surfaces.
 */

export interface LineDiffBudgets {
  maxLinesPerSide: number;
  maxComputeWork: number;
  maxRenderableRows: number;
}

export const OBJECT_DIFF_BUDGETS: LineDiffBudgets = {
  maxLinesPerSide: 10_000,
  maxComputeWork: 3_000_000,
  maxRenderableRows: 20_000,
};

export const ROLLBACK_DIFF_BUDGETS: LineDiffBudgets = {
  maxLinesPerSide: 10_000,
  maxComputeWork: 3_000_000,
  maxRenderableRows: 20_000,
};

export const YAML_TAB_DIFF_BUDGETS: LineDiffBudgets = {
  maxLinesPerSide: 10_000,
  maxComputeWork: 3_000_000,
  maxRenderableRows: 4_000,
};
