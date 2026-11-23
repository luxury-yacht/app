import { describe, expect, it } from 'vitest';
import { decodeClusterViewState, readSavedClusterViewState } from './clusterViewState';

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

  // A window-to-window transfer is live state: a view id this build does not
  // have is invalid, including one it retired.
  it('rejects a transferred id of a retired view', () => {
    const retired = { ...state, navigation: { ...state.navigation, activeClusterView: 'crds' } };
    expect(() => decodeClusterViewState(JSON.stringify(retired), 'production')).toThrow();
  });
});

describe('saved workspace view state', () => {
  // A saved workspace outlives the build that saved it. The CRDs view was
  // folded into API Resources, so a workspace saved on it reopens there.
  it('reopens a workspace saved on the retired CRDs view on API Resources', () => {
    const saved = {
      ...state,
      navigation: { ...state.navigation, viewType: 'cluster', activeClusterView: 'crds' },
    };

    expect(readSavedClusterViewState(saved, 'production').navigation).toMatchObject({
      viewType: 'cluster',
      activeClusterView: 'api-resources',
    });
  });
});
