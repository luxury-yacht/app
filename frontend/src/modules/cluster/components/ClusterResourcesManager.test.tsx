/**
 * frontend/src/modules/cluster/components/ClusterResourcesManager.test.tsx
 *
 * The cluster view route's permission messages: when the cluster definitively
 * denies listing a view's kinds, the view's empty table names the permission
 * denial instead of reporting that the cluster has no such objects. Config
 * reports a denial of any of the kinds it aggregates. Permission answers are
 * scoped to the visible cluster. Runs in the full app, navigated through the
 * sidebar, over a faked backend whose permission answers the test decides
 * (test-utils/appState).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const open = async (clusterView: 'events' | 'config') => {
  view = await app.mountApp();
  await view.goTo({ clusterView });
  return view.container.textContent ?? '';
};

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a']);
  app.startScreen(dev);
  app.serveTable(dev, 'cluster-events');
  app.serveTable(dev, 'cluster-config');
});

describe('ClusterResourcesManager', () => {
  it('shows a permission denial, not an empty cluster, where events may not be listed', async () => {
    app.denyPermissions([{ verb: 'list', resourceKind: 'Event' }]);

    const text = await open('events');

    expect(text).toContain('Insufficient permissions');
    expect(text).not.toContain('No cluster-scoped events found');
    expect(
      app.backend
        .calls('QueryPermissions')
        .flatMap(([queries]) => queries ?? [])
        .filter((query) => query.resourceKind === 'Event' && query.verb === 'list')
        .map((query) => query.clusterId)
    ).toEqual(expect.arrayContaining([dev.clusterId]));
  });

  it('reports an empty cluster where events may be listed', async () => {
    const text = await open('events');

    expect(text).toContain('No cluster-scoped events found');
    expect(text).not.toContain('Insufficient permissions');
  });

  it('shows a permission denial in Config when any of its kinds may not be listed', async () => {
    app.denyPermissions([{ verb: 'list', resourceKind: 'IngressClass' }]);

    const text = await open('config');

    expect(text).toContain('Insufficient permissions');
    expect(text).not.toContain('No cluster-scoped config objects found');
  });
});
