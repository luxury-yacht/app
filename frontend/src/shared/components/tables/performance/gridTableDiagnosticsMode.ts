import type { GridTableDiagnosticsMode } from '../GridTable.types';
import type { GridTablePerformanceEntry } from './gridTablePerformanceStore';

export type GridTablePerformanceSignalSeverity = 'warning' | 'info';

export interface GridTablePerformanceSignal {
  label: string;
  title: string;
  severity: GridTablePerformanceSignalSeverity;
}

export type GridTableDiagnosticsRowCountKind = 'input' | 'source' | 'displayed';

export interface GridTableDiagnosticsModeContract {
  mode: GridTableDiagnosticsMode;
  label: string;
  title: string;
  rowCountTitles: Record<GridTableDiagnosticsRowCountKind, string>;
  classifyReferenceChurn: (params: {
    inputReferenceChanges: number;
    updates: number;
  }) => GridTablePerformanceSignal | null;
}

const formatPercent = (value: number) => `${(value * 100).toFixed(0)}%`;

const buildWarningBroadReplacementSignal = (
  replacementRatio: number,
  inputReferenceChanges: number,
  updates: number,
  description: string
): GridTablePerformanceSignal => ({
  label: 'Broad replacement',
  severity: 'warning',
  title: `Input rows were replaced on ${inputReferenceChanges} of ${updates} updates (${formatPercent(replacementRatio)}). ${description}`,
});

const GRID_TABLE_DIAGNOSTICS_MODE_CONTRACTS: Record<
  GridTableDiagnosticsMode,
  GridTableDiagnosticsModeContract
> = {
  local: {
    mode: 'local',
    label: 'Local',
    title: 'Local table behavior: search/filter/sort run over the loaded row set.',
    rowCountTitles: {
      input: 'Local table: Input is the incoming row count before the shared cap is applied.',
      source:
        'Local table: Capped is the post-cap row count that GridTable works over before local filtering.',
      displayed:
        'Local table: Displayed is the post-cap row count after local filters run in GridTable.',
    },
    classifyReferenceChurn: ({ inputReferenceChanges, updates }) => {
      if (updates < 3) {
        return null;
      }
      const replacementRatio = inputReferenceChanges / updates;
      if (replacementRatio < 0.8) {
        return null;
      }
      return buildWarningBroadReplacementSignal(
        replacementRatio,
        inputReferenceChanges,
        updates,
        'Local tables should usually reuse the input array when the effective row set is unchanged.'
      );
    },
  },
  query: {
    mode: 'query',
    label: 'Query',
    title:
      'Query-backed table behavior: search and/or filtering narrow the upstream dataset before it reaches the table.',
    rowCountTitles: {
      input:
        'Query-backed table: Input is the upstream query result size before the shared cap is applied.',
      source:
        'Query-backed table: Capped is the query result size after the shared max-row cap is applied.',
      displayed:
        'Query-backed table: Displayed is the post-cap row count after any remaining local filters run in GridTable.',
    },
    classifyReferenceChurn: ({ inputReferenceChanges, updates }) => {
      if (updates < 3) {
        return null;
      }
      const replacementRatio = inputReferenceChanges / updates;
      if (replacementRatio < 0.8) {
        return null;
      }
      return buildWarningBroadReplacementSignal(
        replacementRatio,
        inputReferenceChanges,
        updates,
        'Query-backed tables replace input rows when upstream query results change, so this is only suspicious when the query itself is stable.'
      );
    },
  },
  live: {
    mode: 'live',
    label: 'Live',
    title:
      'Live table behavior: rows are expected to update frequently because key fields are time-varying or stream-driven.',
    rowCountTitles: {
      input:
        'Live table: Input is the incoming row count before the shared cap is applied. Frequent updates are expected.',
      source:
        'Live table: Capped is the post-cap row count that GridTable works over before local filtering.',
      displayed:
        'Live table: Displayed is the post-cap row count after local filters run in GridTable.',
    },
    classifyReferenceChurn: ({ inputReferenceChanges, updates }) => {
      if (updates < 3) {
        return null;
      }
      const replacementRatio = inputReferenceChanges / updates;
      if (replacementRatio < 0.8) {
        return null;
      }
      return {
        label: 'Live churn',
        severity: 'info',
        title: `Input rows were replaced on ${inputReferenceChanges} of ${updates} updates (${formatPercent(replacementRatio)}). Live tables are expected to churn; prioritize sort and render warnings before treating this as a feed bug.`,
      };
    },
  },
};

export const getGridTableDiagnosticsModeContract = (
  mode: GridTableDiagnosticsMode
): GridTableDiagnosticsModeContract => GRID_TABLE_DIAGNOSTICS_MODE_CONTRACTS[mode];

export const getGridTableModeLabel = (mode: GridTableDiagnosticsMode): string =>
  getGridTableDiagnosticsModeContract(mode).label;

export const getGridTableModeTitle = (mode: GridTableDiagnosticsMode): string =>
  getGridTableDiagnosticsModeContract(mode).title;

export const getGridTableRowCountTitle = (
  mode: GridTableDiagnosticsMode,
  kind: GridTableDiagnosticsRowCountKind
): string => getGridTableDiagnosticsModeContract(mode).rowCountTitles[kind];

export const buildGridTableReferenceChurnSignal = (
  row: Pick<GridTablePerformanceEntry, 'mode' | 'inputReferenceChanges' | 'updates'>
): GridTablePerformanceSignal | null =>
  getGridTableDiagnosticsModeContract(row.mode).classifyReferenceChurn({
    inputReferenceChanges: row.inputReferenceChanges,
    updates: row.updates,
  });
