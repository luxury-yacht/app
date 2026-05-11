import { describe, expect, it } from 'vitest';
import { hasCompleteObjectMapReference, isObjectMapSupportedKind } from './objectMapSupport';

describe('objectMapSupport', () => {
  it('supports pod disruption budgets as object-map seeds', () => {
    expect(isObjectMapSupportedKind('PodDisruptionBudget')).toBe(true);
    expect(
      hasCompleteObjectMapReference({
        clusterId: 'cluster-a',
        group: 'policy',
        version: 'v1',
        kind: 'PodDisruptionBudget',
        namespace: 'default',
        name: 'web',
      })
    ).toBe(true);
  });
});
