/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelLogsCapability.test.tsx
 *
 * The Logs tab gate of an opened object panel, through the real panel, its
 * namespace permission query, the capability hook, and the permission store.
 * A pod's `view-logs` check names the pod and is answered by QueryPermissions;
 * a workload's is Pod-level and resolves from the panel's namespace query
 * (ObjectPanel.tsx), so the suite mounts the full app and opens the panel.
 * Only the backend boundary is faked (test-utils/appState).
 */

import { act } from 'react';
import { describe, expect, it } from 'vitest';
import type { ObjectDetail } from '@/core/refresh/types';
import {
  installAppStateHarness,
  type ObjectIdentity,
  type PermissionQuery,
} from '@/test-utils/appState/harness';
import { objectDetailOf } from '@/test-utils/objectDetail';

const app = installAppStateHarness();

const isPodLogs = (query: PermissionQuery) =>
  query.resourceKind === 'Pod' && query.subresource === 'log';

const podLogQueries = () =>
  app.backend
    .calls('QueryPermissions')
    .flatMap(([queries]) => queries ?? [])
    .filter(isPodLogs);

const openPanel = async (identity: ObjectIdentity, detail: ObjectDetail) => {
  const dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['team-a']);
  app.startScreen(dev);
  // The panel's reads, including its metrics collector's base table scope (test-utils/appState).
  const panel = app.servePanel(dev, identity, detail as never);
  // backend/autoscaling_details.go IsWorkloadHPAManaged: no HPA targets the workload.
  app.backend.answer('IsWorkloadHPAManaged', () => false);
  const view = await app.mountApp();
  await act(async () => {
    view.owners().objectPanel.openWithObject(panel.ref);
  });
  await app.settle();
  // The tab strip owns its tabs by id (aria-owns), as assistive technology reads them.
  const tablist = document.querySelector('[role="tablist"][aria-label="Object Panel Tabs"]');
  const tabLabels = (tablist?.getAttribute('aria-owns') ?? '')
    .split(' ')
    .map((id) => document.getElementById(id)?.textContent?.trim().toLowerCase());
  return { dev, tabLabels };
};

const pod: ObjectIdentity = {
  group: '',
  version: 'v1',
  kind: 'Pod',
  namespace: 'team-a',
  name: 'web-0',
};
const podDetail = objectDetailOf('pod', { name: 'web-0', namespace: 'team-a' });

describe('Logs tab gate', () => {
  it("shows a pod's Logs tab when the user may read that pod's logs by name only", async () => {
    // Pod logs are denied namespace-wide but granted for this pod.
    app.permissions((query) => !isPodLogs(query) || query.name === 'web-0');

    const { dev, tabLabels } = await openPanel(pod, podDetail);

    expect(podLogQueries()).toContainEqual(
      expect.objectContaining({
        clusterId: dev.clusterId,
        namespace: 'team-a',
        name: 'web-0',
        verb: 'get',
      })
    );
    expect(tabLabels).toContain('logs');
  });

  it("hides a pod's Logs tab once its named pod-logs check is denied", async () => {
    app.permissions((query) => !isPodLogs(query));

    const { tabLabels } = await openPanel(pod, podDetail);

    expect(tabLabels).toContain('details');
    expect(tabLabels).not.toContain('logs');
  });

  it("hides a workload's Logs tab when pod logs are denied in its namespace", async () => {
    app.permissions((query) => !(isPodLogs(query) && query.namespace === 'team-a'));

    const { tabLabels } = await openPanel(
      { group: 'apps', version: 'v1', kind: 'Deployment', namespace: 'team-a', name: 'web' },
      objectDetailOf('deployment', { name: 'web', namespace: 'team-a' })
    );

    expect(tabLabels).toContain('details');
    expect(tabLabels).not.toContain('logs');
  });
});
