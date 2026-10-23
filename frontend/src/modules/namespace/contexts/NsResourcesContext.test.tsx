/**
 * frontend/src/modules/namespace/contexts/NsResourcesContext.test.tsx
 *
 * NamespaceResourcesProvider, the effects wrapper around the namespace views:
 * it asks the backend for the permissions of the namespace the view shows, in
 * the visible cluster, so the views' actions are decided before the user opens
 * them; it reads no namespace resources of its own (the query-backed tables
 * own their rows). Runs inside the production shell with the real kubeconfig,
 * namespace, and permission owners over a faked backend (test-utils/appState).
 */

import { describe, expect, it } from 'vitest';
import { installAppStateHarness, type TestCluster } from '@/test-utils/appState/harness';
import { NamespaceResourcesProvider } from './NsResourcesContext';

const app = installAppStateHarness();

/** The namespaces the backend was asked permissions for, per cluster. */
const queriedNamespaces = (cluster: TestCluster) =>
  new Set(
    app.backend
      .calls('QueryPermissions')
      .flatMap(([queries]) => queries ?? [])
      .filter((query) => query.clusterId === cluster.clusterId && query.namespace)
      .map((query) => query.namespace)
  );

const start = async () => {
  const dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a', 'team-b']);
  const view = await app.render(null);
  const show = (namespace: string) =>
    view.show(
      <NamespaceResourcesProvider namespace={namespace}>
        <div />
      </NamespaceResourcesProvider>
    );
  return { dev, show };
};

describe('NamespaceResourcesProvider', () => {
  it('asks for the shown namespace’s permissions in the visible cluster and reads nothing itself', async () => {
    const { dev, show } = await start();
    app.snapshots.clearReads();
    const streamsBefore = app.streams.active();

    await show('team-a');

    expect(queriedNamespaces(dev)).toEqual(new Set(['team-a']));
    // Field evidence for the cut: this wrapper once fetched a namespace-workloads
    // copy per metric tick that no view rendered.
    expect(app.snapshots.reads()).toEqual([]);
    expect(app.streams.active()).toEqual(streamsBefore);
  });

  it('asks for no single namespace’s permissions under All Namespaces', async () => {
    const { dev, show } = await start();

    await show('namespace:all');

    expect(queriedNamespaces(dev)).toEqual(new Set());
  });

  it('asks for the next namespace’s permissions when the user switches namespace', async () => {
    const { dev, show } = await start();

    await show('team-a');
    await show('team-b');

    expect(queriedNamespaces(dev)).toEqual(new Set(['team-a', 'team-b']));
  });
});
