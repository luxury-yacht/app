import { describe, expect, it } from 'vitest';
import { decodeClusterViewState } from './clusterViewState';

const state = {
  clusterId: 'production',
  navigation: {
    viewType: 'namespace',
    previousView: 'overview',
    activeNamespaceView: 'workloads',
    activeClusterView: null,
  },
  namespace: 'payments',
  sidebar: { type: 'namespace', value: 'payments' },
  tables: {},
};
describe('cluster view transfer state', () => {
  it('carries navigation and namespace for the specified cluster', () => {
    expect(decodeClusterViewState(JSON.stringify(state), 'production')).toEqual(state);
  });
  it.each([
    { ...state, clusterId: 'staging' },
    { ...state, navigation: { ...state.navigation, viewType: 'global' } },
    { ...state, navigation: { ...state.navigation, activeNamespaceView: 'invented' } },
    { ...state, sidebar: { type: 'invented', value: 'oops' } },
  ])('rejects invalid or foreign view state', (invalid) => {
    expect(() => decodeClusterViewState(JSON.stringify(invalid), 'production')).toThrow();
  });
});
