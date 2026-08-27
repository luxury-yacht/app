import { describe, expect, it } from 'vitest';
import { applyClusterNavigationTarget, resolveNavigationWorkspace } from './ViewStateContext';

describe('applyClusterNavigationTarget', () => {
  it('covers applyClusterNavigationTarget scenarios', async () => {
    // Scenario: prepares only the requested cluster while preserving its other tab state
    expect(
      applyClusterNavigationTarget(
        {
          'cluster-a': {
            viewType: 'cluster',
            previousView: 'overview',
            activeNamespaceView: 'workloads',
            activeClusterView: 'browse',
          },
          'cluster-b': {
            viewType: 'namespace',
            previousView: 'overview',
            activeNamespaceView: 'network',
            activeClusterView: 'nodes',
          },
        },
        'cluster-b',
        { viewType: 'cluster', activeClusterView: 'storage' }
      )
    ).toEqual({
      'cluster-a': {
        viewType: 'cluster',
        previousView: 'overview',
        activeNamespaceView: 'workloads',
        activeClusterView: 'browse',
      },
      'cluster-b': {
        viewType: 'cluster',
        previousView: 'namespace',
        activeNamespaceView: 'network',
        activeClusterView: 'storage',
      },
    });
    // Scenario: prepares a namespace destination without changing another cluster
    expect(
      applyClusterNavigationTarget(
        {
          'cluster-a': {
            viewType: 'cluster',
            previousView: 'overview',
            activeNamespaceView: 'workloads',
            activeClusterView: 'browse',
          },
        },
        'cluster-b',
        { viewType: 'namespace', activeNamespaceView: 'browse' }
      )
    ).toEqual({
      'cluster-a': {
        viewType: 'cluster',
        previousView: 'overview',
        activeNamespaceView: 'workloads',
        activeClusterView: 'browse',
      },
      'cluster-b': {
        viewType: 'namespace',
        previousView: 'overview',
        activeNamespaceView: 'browse',
        activeClusterView: null,
      },
    });
  });
});

describe('resolveNavigationWorkspace', () => {
  it('covers resolveNavigationWorkspace scenarios', async () => {
    // Scenario: keeps Global active while multiple clusters remain open
    expect(resolveNavigationWorkspace('global', 3)).toBe('global');
    expect(resolveNavigationWorkspace('global', 2)).toBe('global');
    // Scenario: falls back to the cluster workspace when Global is no longer available
    expect(resolveNavigationWorkspace('global', 1)).toBe('cluster');
    expect(resolveNavigationWorkspace('global', 0)).toBe('cluster');
    expect(resolveNavigationWorkspace('cluster', 2)).toBe('cluster');
  });
});
