/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/overviewLinks.test.tsx
 *
 * A related-object link inside an open object panel opens that object's own
 * panel, in the panel's cluster, with complete identity. Runs the real app
 * shell, object panel, Details tab, and Overview descriptors; only the
 * backend boundary is faked (test-utils/appState).
 */

import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { makePodSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import { buildRefreshScope } from '@/core/refresh/scopeSelector';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';

const app = installAppStateHarness();

const configMap = {
  group: '',
  version: 'v1',
  kind: 'ConfigMap',
  namespace: 'default',
  name: 'app-config',
};

const podRef = (cluster: TestCluster, name: string) => ({
  clusterId: cluster.clusterId,
  group: '',
  version: 'v1',
  kind: 'Pod',
  resource: 'pods',
  namespace: 'default',
  name,
});

const linkNamed = (view: MountedApp, text: string) =>
  Array.from(view.container.querySelectorAll<HTMLElement>('.object-panel-link')).find(
    (element) => element.textContent?.trim() === text
  );

describe('a related-object link in an open panel', () => {
  it('opens the related object’s panel in the same cluster with complete identity', async () => {
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['default']);
    app.startScreen(dev);
    const configMapPanel = app.object(dev, configMap);
    app.snapshots.serve('object-details', configMapPanel.scopes.detailScope ?? '', {
      detailType: 'configmap',
      details: {
        name: 'app-config',
        namespace: 'default',
        data: { key: 'value' },
        binaryData: {},
        usedBy: [podRef(dev, 'pod-a')],
        labels: {},
        annotations: {},
      },
    } as never);
    // The pod panel the link opens reads its own details and its pods window.
    const podPanel = app.object(dev, { ...configMap, kind: 'Pod', name: 'pod-a' });
    app.snapshots.serve('object-details', podPanel.scopes.detailScope ?? '', {
      detailType: 'pod',
      details: { name: 'pod-a', namespace: 'default' },
    } as never);
    app.snapshots.serve(
      'pods',
      buildRefreshScope('pods', {
        clusterId: dev.clusterId,
        selector: { kind: 'namespace', namespace: 'default' },
      }),
      makePodSnapshotPayload({ clusterId: dev.clusterId, clusterName: dev.clusterName })
    );
    const view = await app.mountApp();

    await act(async () => {
      view.owners().objectPanel.openWithObject(configMapPanel.ref);
    });
    await app.settle();
    const podLink = linkNamed(view, 'pod-a');
    expect(podLink).toBeDefined();

    await act(async () => {
      podLink?.click();
    });
    await app.settle();

    expect(view.openPanels()).toContainEqual({
      clusterId: dev.clusterId,
      clusterName: dev.clusterName,
      group: '',
      version: 'v1',
      kind: 'Pod',
      namespace: 'default',
      name: 'pod-a',
    });
  });
});
