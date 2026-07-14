import { describe, expect, it } from 'vitest';
import { applyClusterNavigationTarget } from './ViewStateContext';

describe('applyClusterNavigationTarget', () => {
  it('prepares only the requested cluster while preserving its other tab state', () => {
    expect(
      applyClusterNavigationTarget(
        {
          'cluster-a': {
            viewType: 'cluster',
            previousView: 'overview',
            activeNamespaceView: 'pods',
            activeClusterView: 'fleet',
          },
          'cluster-b': {
            viewType: 'namespace',
            previousView: 'overview',
            activeNamespaceView: 'network',
            activeClusterView: 'nodes',
          },
        },
        'cluster-b',
        { viewType: 'cluster', activeClusterView: 'attention' }
      )
    ).toEqual({
      'cluster-a': {
        viewType: 'cluster',
        previousView: 'overview',
        activeNamespaceView: 'pods',
        activeClusterView: 'fleet',
      },
      'cluster-b': {
        viewType: 'cluster',
        previousView: 'namespace',
        activeNamespaceView: 'network',
        activeClusterView: 'attention',
      },
    });
  });
});
