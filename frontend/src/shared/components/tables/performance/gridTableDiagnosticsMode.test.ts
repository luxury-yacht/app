import { describe, expect, it } from 'vitest';

import { buildGridTableReferenceChurnSignal } from './gridTableDiagnosticsMode';

describe('gridTableDiagnosticsMode', () => {
  it('treats broad replacement as a warning for local and query tables', () => {
    expect(
      buildGridTableReferenceChurnSignal({
        mode: 'local',
        inputReferenceChanges: 8,
        updates: 10,
      })
    ).toEqual(
      expect.objectContaining({
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
});
