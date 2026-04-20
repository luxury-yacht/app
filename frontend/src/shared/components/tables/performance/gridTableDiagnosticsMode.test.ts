import { describe, expect, it } from 'vitest';

import {
  buildGridTableReferenceChurnSignal,
  getGridTableDiagnosticsModeContract,
  getGridTableModeLabel,
  getGridTableModeTitle,
  getGridTableRowCountTitle,
} from './gridTableDiagnosticsMode';

describe('gridTableDiagnosticsMode', () => {
  it('exposes stable labels and titles for each diagnostics mode', () => {
    expect(getGridTableModeLabel('local')).toBe('Local');
    expect(getGridTableModeLabel('query')).toBe('Query');
    expect(getGridTableModeLabel('live')).toBe('Live');
    expect(getGridTableModeTitle('query')).toContain('Query-backed table behavior');
    expect(getGridTableModeTitle('live')).toContain('Live table behavior');
  });

  it('provides mode-specific row count semantics', () => {
    expect(getGridTableRowCountTitle('local', 'source')).toContain(
      'Post-Cap is the row count after the shared cap is applied'
    );
    expect(getGridTableRowCountTitle('query', 'input')).toContain('upstream query result size');
    expect(getGridTableRowCountTitle('live', 'input')).toContain('Frequent updates are expected');
  });

  it('treats broad replacement as a warning for local and query tables', () => {
    expect(
      buildGridTableReferenceChurnSignal({
        mode: 'local',
        inputReferenceChanges: 8,
        updates: 10,
      })
    ).toEqual(
      expect.objectContaining({
        label: 'Broad replacement',
        severity: 'warning',
      })
    );

    expect(
      buildGridTableReferenceChurnSignal({
        mode: 'query',
        inputReferenceChanges: 8,
        updates: 10,
      })
    ).toEqual(
      expect.objectContaining({
        label: 'Broad replacement',
        severity: 'warning',
      })
    );
  });

  it('downgrades broad replacement to informational churn for live tables', () => {
    expect(
      buildGridTableReferenceChurnSignal({
        mode: 'live',
        inputReferenceChanges: 8,
        updates: 10,
      })
    ).toEqual(
      expect.objectContaining({
        label: 'Live churn',
        severity: 'info',
      })
    );
  });

  it('only raises churn signals after the shared warning threshold', () => {
    expect(
      buildGridTableReferenceChurnSignal({
        mode: 'local',
        inputReferenceChanges: 2,
        updates: 2,
      })
    ).toBeNull();
    expect(
      buildGridTableReferenceChurnSignal({
        mode: 'local',
        inputReferenceChanges: 7,
        updates: 10,
      })
    ).toBeNull();
  });

  it('returns a full shared contract for consumers that need the mode metadata', () => {
    expect(getGridTableDiagnosticsModeContract('local')).toEqual(
      expect.objectContaining({
        mode: 'local',
        label: 'Local',
      })
    );
  });
});
