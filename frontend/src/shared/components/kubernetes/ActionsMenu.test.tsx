/**
 * frontend/src/shared/components/kubernetes/ActionsMenu.test.tsx
 *
 * An object panel's Actions menu, where the app shows it: in the Overview of
 * a real panel opened in the full app. The menu offers what the object's
 * kind, state, and permissions allow; restarts, deletes, scales, triggers,
 * suspends, resumes, and cordons go to the backend's RunObjectAction with the
 * object's complete identity (restart, delete, scale, scale to zero, trigger,
 * and cordon only once confirmed; nothing runs on Cancel); the panel re-reads
 * its object after a change and closes after a delete. Scale
 * choices follow the backend's HPA ownership answer and offer nothing while
 * it is unknown. Open Map switches the panel to its Map tab. Finalizer
 * removal, run by the same action controller from the Details tab, warns when
 * the delete is recent and reports a refused removal. Only the backend
 * boundary is faked (test-utils/appState).
 */

import { OBJECT_ACTION_IDS } from '@shared/actions/objectActionContract';
import { buildNodeMaintenanceAggregateScope } from '@shared/hooks/useNodeMaintenanceActions';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeClusterNodeSnapshotPayload } from '@/core/refresh/refreshContractTestBuilders';
import { buildClusterRefreshScope } from '@/core/refresh/scopeSelector';
import type { DomainPayloadMap, ObjectDetail } from '@/core/refresh/types';
import { objectPanelId } from '@/modules/object-panel/objectPanelRef';
import {
  installAppStateHarness,
  type MountedApp,
  type ObjectIdentity,
  type TestCluster,
  type TestObject,
} from '@/test-utils/appState/harness';
import { objectDetailOf } from '@/test-utils/objectDetail';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const deployment: ObjectIdentity = {
  group: 'apps',
  version: 'v1',
  kind: 'Deployment',
  namespace: 'default',
  name: 'web',
};
const cronJob: ObjectIdentity = {
  group: 'batch',
  version: 'v1',
  kind: 'CronJob',
  namespace: 'default',
  name: 'nightly',
};

/** The panel's object-details payload: a typed detail, and deletion metadata when terminating. */
type Detail = ObjectDetail & Pick<Partial<DomainPayloadMap['object-details']>, 'deletion'>;

/** Opens the object's panel in the full app; its details are `detail`. */
const openPanel = async (identity: ObjectIdentity, detail: Detail): Promise<TestObject> => {
  const object = app.servePanel(
    dev,
    identity,
    detail as Partial<DomainPayloadMap['object-details']>
  );
  view = await app.mountApp();
  await act(async () => {
    view.owners().objectPanel.openWithObject(object.ref);
  });
  await app.settle();
  return object;
};

const deploymentDetail = (
  replicas: { ready: string; desiredReplicas: number } = {
    ready: '3/3',
    desiredReplicas: 3,
  }
): Detail => objectDetailOf('deployment', { name: 'web', namespace: 'default', ...replicas });

const cronJobDetail = (suspend: boolean): Detail =>
  objectDetailOf('cronjob', {
    name: 'nightly',
    namespace: 'default',
    schedule: '0 0 * * *',
    suspend,
  });

const click = async (element: HTMLElement) => {
  await act(async () => element.click());
  await app.settle();
};

const openActions = () =>
  click(
    requireValue(
      view.container.querySelector<HTMLButtonElement>('.object-panel-body .actions-menu-button'),
      'expected the panel’s Actions menu'
    )
  );

const menuItems = () =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>('[role="menu"] .context-menu-item'));
const menuLabels = () =>
  menuItems().map((item) => item.querySelector('.context-menu-label')?.textContent?.trim());
const menuItem = (label: string) =>
  requireValue(
    menuItems().find(
      (item) => item.querySelector('.context-menu-label')?.textContent?.trim() === label
    ),
    `expected the ${label} menu item`
  );

const dialogButton = (label: string) =>
  requireValue(
    Array.from(document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')).find(
      (button) => button.textContent?.trim() === label
    ),
    `expected the dialog’s ${label} button`
  );

const actionCalls = () => app.backend.calls('RunObjectAction').map(([request]) => request);
const target = (identity: ObjectIdentity) => ({ clusterId: dev.clusterId, ...identity });
const detailReads = (object: TestObject) =>
  app.snapshots.reads('object-details').filter((read) => read.scope === object.scopes.detailScope)
    .length;

beforeEach(() => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default']);
  app.startScreen(dev);
  app.backend.answer('IsWorkloadHPAManaged', () => false);
  app.backend.answer('RunObjectAction', () => ({}));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('an object panel’s Actions menu', () => {
  it('opens as a menu of buttons outside the panel’s scrolling body', async () => {
    await openPanel(deployment, deploymentDetail());

    await openActions();

    const menu = requireValue(document.body.querySelector('[role="menu"]'), 'expected the menu');
    expect(view.container.querySelector('.object-panel-body')?.contains(menu)).toBe(false);
    expect(menuItems().length).toBeGreaterThan(0);
    expect(menuItems().every((item) => item.tagName === 'BUTTON' && item.type === 'button')).toBe(
      true
    );
  });

  it('restarts the workload after confirmation, then re-reads it', async () => {
    const object = await openPanel(deployment, deploymentDetail());
    const reads = detailReads(object);
    await openActions();

    await click(menuItem('Restart'));
    expect(actionCalls()).toEqual([]);
    await click(dialogButton('Restart'));

    expect(actionCalls()).toEqual([{ action: 'restart', target: target(deployment) }]);
    expect(detailReads(object)).toBeGreaterThan(reads);
  });

  it('deletes the object after confirmation and closes its panel', async () => {
    await openPanel(deployment, deploymentDetail());
    await openActions();

    await click(menuItem('Delete'));
    await click(dialogButton('Delete'));

    expect(actionCalls()).toEqual([{ action: 'delete', target: target(deployment) }]);
    expect(view.openPanels()).toEqual([]);
  });

  it('runs nothing when the user cancels a restart or delete', async () => {
    await openPanel(deployment, deploymentDetail());

    for (const label of ['Restart', 'Delete']) {
      await openActions();
      await click(menuItem(label));
      await click(dialogButton('Cancel'));
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    }

    expect(actionCalls()).toEqual([]);
    expect(view.openPanels()).toHaveLength(1);
  });

  // A custom resource's delete permission is outside the namespace permissions
  // the panel queries on open, so the menu asks for it under the resource's
  // own group/version key, and offers Delete only where the answer allows it.
  it.each([
    ['offers Delete for a custom resource where its permission allows it', true],
    ['offers no Delete for a custom resource where its permission denies it', false],
  ])('%s', async (_case, allowed) => {
    const dbInstance: ObjectIdentity = {
      group: 'rds.services.k8s.aws',
      version: 'v1alpha1',
      kind: 'DBInstance',
      namespace: 'default',
      name: 'orders',
    };
    if (!allowed) {
      app.denyPermissions([{ verb: 'delete', resourceKind: 'DBInstance', namespace: 'default' }]);
    }
    const object = app.servePanel(
      dev,
      dbInstance,
      objectDetailOf('customresource', { kind: 'DBInstance', name: 'orders' })
    );
    view = await app.mountApp();
    await act(async () => {
      view.owners().objectPanel.openWithObject(object.ref);
    });
    await app.settle();

    await openActions();

    expect(menuLabels().includes('Delete')).toBe(allowed);
  });

  it('scales the workload to the replicas the user enters, then re-reads it', async () => {
    const object = await openPanel(deployment, deploymentDetail());
    const reads = detailReads(object);
    await openActions();
    await click(menuItem('Scale'));
    const replicas = requireValue(
      document.querySelector<HTMLInputElement>('[role="dialog"] input'),
      'expected the replicas input'
    );
    expect(replicas.value).toBe('3');

    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(
        replicas,
        '7'
      );
      replicas.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click(dialogButton('Scale'));

    expect(actionCalls()).toEqual([{ action: 'scale', target: target(deployment), replicas: 7 }]);
    expect(detailReads(object)).toBeGreaterThan(reads);
  });

  it('confirms before scaling a workload to zero from the scale dialog', async () => {
    await openPanel(deployment, deploymentDetail({ ready: '2/4', desiredReplicas: 4 }));
    await openActions();
    await click(menuItem('Scale'));

    await click(dialogButton('Scale to 0'));
    expect(actionCalls()).toEqual([]);
    await click(dialogButton('Scale to 0'));

    expect(actionCalls()).toEqual([{ action: 'scale', target: target(deployment), replicas: 0 }]);
  });

  it('offers only Scale to 0, confirmed first, for an HPA-managed workload that is running', async () => {
    app.backend.answer('IsWorkloadHPAManaged', () => true);
    await openPanel(deployment, deploymentDetail({ ready: '2/4', desiredReplicas: 4 }));
    await openActions();

    expect(menuLabels()).toContain('Scale to 0');
    expect(menuLabels()).not.toContain('Scale');
    expect(menuLabels()).not.toContain('Resume from 0');
    await click(menuItem('Scale to 0'));
    expect(actionCalls()).toEqual([]);
    await click(dialogButton('Scale to 0'));

    expect(actionCalls()).toEqual([{ action: 'scale', target: target(deployment), replicas: 0 }]);
  });

  it('offers only Resume from 0 for an HPA-managed workload at zero, and resumes it to one', async () => {
    app.backend.answer('IsWorkloadHPAManaged', () => true);
    await openPanel(deployment, deploymentDetail({ ready: '0/0', desiredReplicas: 0 }));
    await openActions();

    expect(menuLabels()).toContain('Resume from 0');
    expect(menuLabels()).not.toContain('Scale to 0');
    await click(menuItem('Resume from 0'));

    expect(actionCalls()).toEqual([{ action: 'scale', target: target(deployment), replicas: 1 }]);
  });

  it('offers no scale action while the workload’s HPA ownership is unknown', async () => {
    const release = app.backend.hold('IsWorkloadHPAManaged');
    await openPanel(deployment, deploymentDetail({ ready: '2/4', desiredReplicas: 4 }));
    await openActions();

    expect(menuLabels()).toContain('Restart');
    expect(menuLabels()).not.toContain('Scale');
    expect(menuLabels()).not.toContain('Scale to 0');
    expect(menuLabels()).not.toContain('Resume from 0');
    release();
    await app.settle();
  });

  it('disables Port Forward for a pod with no forwardable ports', async () => {
    await openPanel(
      { group: '', version: 'v1', kind: 'Pod', namespace: 'default', name: 'batch-1' },
      objectDetailOf('pod', {
        name: 'batch-1',
        namespace: 'default',
        containers: [{ name: 'batch', image: 'batch:1', ports: [] }],
      })
    );
    await openActions();

    expect(menuItem('Port Forward').disabled).toBe(true);
  });

  it('switches the panel to its Map tab from Open Map and closes the menu', async () => {
    const configMap: ObjectIdentity = {
      group: '',
      version: 'v1',
      kind: 'ConfigMap',
      namespace: 'default',
      name: 'settings',
    };
    const object = app.object(dev, configMap);
    // backend/refresh/snapshot/object_map.go: the map seeded at the panel's object.
    app.snapshots.serve('object-map', requireValue(object.scopes.mapScope, 'map scope'), {
      clusterId: dev.clusterId,
      clusterName: dev.clusterName,
      seed: target(configMap),
      nodes: [],
      edges: [],
      maxNodes: 250,
      truncated: false,
    });
    await openPanel(
      configMap,
      objectDetailOf('configmap', { name: 'settings', namespace: 'default', usedBy: [] })
    );
    await openActions();

    await click(
      requireValue(
        menuItems().find((item) => item.dataset.contextActionId === OBJECT_ACTION_IDS.viewMap),
        'expected Open Map'
      )
    );

    expect(
      view.owners().objectPanels.getOwnedPanel(dev.clusterId, objectPanelId(object.ref))?.activeView
    ).toBe('map');
    expect(document.body.querySelector('[role="menu"]')).toBeNull();
  });

  it('cordons a node after confirmation', async () => {
    const node: ObjectIdentity = {
      group: '',
      version: 'v1',
      kind: 'Node',
      namespace: '',
      name: 'node-1',
    };
    // A Node panel watches its cluster's drains (useNodeMaintenanceActions.tsx)
    // and collects the node's metrics from the cluster's nodes (core/resource-metrics/scope.ts).
    app.snapshots.serve('object-maintenance', buildNodeMaintenanceAggregateScope(dev.clusterId), {
      clusterId: dev.clusterId,
      drains: [],
    });
    app.snapshots.serve(
      'nodes',
      buildClusterRefreshScope('nodes', dev.clusterId),
      makeClusterNodeSnapshotPayload({ clusterId: dev.clusterId, clusterName: dev.clusterName })
    );
    // A Node panel asks which node logs it can offer.
    app.backend.answer('DiscoverNodeLogs', () => ({ supported: false, reason: 'unavailable' }));
    await openPanel(node, objectDetailOf('node', { name: 'node-1', unschedulable: false }));
    await openActions();

    await click(menuItem('Cordon'));
    await click(dialogButton('Cordon'));

    expect(actionCalls()).toEqual([{ action: 'cordon', target: target(node) }]);
  });

  describe('for a CronJob', () => {
    it('suspends an active CronJob, and triggers it only once the user confirms', async () => {
      await openPanel(cronJob, cronJobDetail(false));
      await openActions();
      expect(menuItem('Trigger Now').disabled).toBe(false);

      await click(menuItem('Suspend'));
      expect(actionCalls()).toEqual([
        { action: 'suspend', target: target(cronJob), suspend: true },
      ]);

      await openActions();
      await click(menuItem('Trigger Now'));
      await click(dialogButton('Cancel'));
      await openActions();
      await click(menuItem('Trigger Now'));
      await click(dialogButton('Trigger'));

      expect(actionCalls().slice(1)).toEqual([{ action: 'trigger', target: target(cronJob) }]);
    });

    it('offers Resume, and no Trigger Now, for a suspended CronJob, and resumes it', async () => {
      await openPanel(cronJob, cronJobDetail(true));
      await openActions();

      expect(menuLabels()).not.toContain('Suspend');
      expect(menuItem('Trigger Now').disabled).toBe(true);
      await click(menuItem('Resume'));

      expect(actionCalls()).toEqual([
        { action: 'suspend', target: target(cronJob), suspend: false },
      ]);
    });
  });
});

describe('finalizer removal from a terminating object’s Details', () => {
  const openTerminating = async () =>
    openPanel(deployment, {
      ...deploymentDetail(),
      deletion: { deletionTimestamp: '2026-08-10T12:00:00Z', finalizers: ['example.com/cleanup'] },
    });
  const requestRemoval = () =>
    click(
      requireValue(
        view.container.querySelector<HTMLButtonElement>(
          'button[aria-label="Remove finalizer example.com/cleanup"]'
        ),
        'expected the finalizer’s Remove button'
      )
    );

  it.each([
    ['warns that the controller may still be cleaning up', '2026-08-10T12:04:59Z', true],
    ['does not warn once five minutes have passed', '2026-08-10T12:05:00Z', false],
  ])('%s since the delete was requested', async (_case, now, warns) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(now));
    await openTerminating();

    await requestRemoval();

    const dialog = requireValue(document.querySelector('[role="dialog"]'), 'expected the dialog');
    expect(dialog.textContent?.includes('Less than 5 minutes has elapsed')).toBe(warns);
  });

  it('runs nothing on Cancel, and reports a refused removal without re-reading the object', async () => {
    const object = await openTerminating();
    await requestRemoval();
    await click(dialogButton('Cancel'));
    expect(actionCalls()).toEqual([]);

    app.backend.answer('RunObjectAction', () => {
      throw new Error('conflict');
    });
    const reads = detailReads(object);
    await requestRemoval();
    await click(dialogButton('Remove'));

    expect(actionCalls()).toEqual([
      {
        action: 'removeFinalizer',
        target: target(deployment),
        finalizer: 'example.com/cleanup',
        finalizerPath: 'metadata.finalizers',
      },
    ]);
    expect(app.errors.take((record) => record.context?.action === 'removeFinalizer')).toEqual([
      expect.objectContaining({ context: expect.objectContaining({ name: 'web' }) }),
    ]);
    expect(detailReads(object)).toBe(reads);
  });
});
