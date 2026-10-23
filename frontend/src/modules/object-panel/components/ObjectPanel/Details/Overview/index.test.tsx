/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Details/Overview/index.test.tsx
 *
 * An opened object panel's Overview: it renders the kind's registered
 * descriptor (or the generic overview for an unregistered kind) and hands the
 * panel's object, replica counts, and lifecycle to the actions menu. The
 * Overview reads the open panel's object, so the suite mounts the full app and
 * opens real panels; only the backend boundary is faked (test-utils/appState).
 * The actions menu and generic overview are stubbed to capture what they are
 * given.
 */

import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installAppStateHarness,
  type MountedApp,
  type ObjectIdentity,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

const captured = vi.hoisted(() => ({
  actionsMenu: [] as Array<Record<string, unknown>>,
  genericOverview: [] as Array<Record<string, unknown>>,
}));

vi.mock('@shared/components/kubernetes/ActionsMenu', () => ({
  ActionsMenu: (props: Record<string, unknown>) => {
    captured.actionsMenu.push(props);
    return <div data-testid="actions-menu" />;
  },
}));

vi.mock('./GenericOverview', () => ({
  GenericOverview: (props: Record<string, unknown>) => {
    captured.genericOverview.push(props);
    return <div data-testid="generic-overview" />;
  },
}));

const app = installAppStateHarness();
let dev: TestCluster;
let view: MountedApp;

const lastActionsMenu = () => captured.actionsMenu[captured.actionsMenu.length - 1];

/** Serves the panel's reads (test-utils/appState), with these details. */
const servePanel = (identity: ObjectIdentity, detailType: string, details: object) =>
  app.servePanel(dev, identity, { detailType, details } as never);

const openPanel = async (object: ReturnType<typeof servePanel>) => {
  view = await app.mountApp();
  await act(async () => {
    view.owners().objectPanel.openWithObject(object.ref);
  });
  await app.settle();
};

const workload = (kind: string, name: string): ObjectIdentity => ({
  group: 'apps',
  version: 'v1',
  kind,
  namespace: 'default',
  name,
});

beforeEach(() => {
  captured.actionsMenu = [];
  captured.genericOverview = [];
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default']);
  app.startScreen(dev);
  app.backend.answer('IsWorkloadHPAManaged', () => false);
});

describe('an opened panel’s Overview', () => {
  it('hands the panel’s object and desired replicas to the actions menu', async () => {
    const deployment = servePanel(workload('Deployment', 'demo'), 'deployment', {
      name: 'demo',
      namespace: 'default',
      desiredReplicas: 5,
      replicas: '5/5',
      ready: '5/5',
    });

    await openPanel(deployment);

    expect(view.container.querySelector('[data-testid="actions-menu"]')).not.toBeNull();
    expect(lastActionsMenu()).toMatchObject({
      object: expect.objectContaining({
        clusterId: dev.clusterId,
        kind: 'Deployment',
        name: 'demo',
      }),
      currentReplicas: 5,
    });
  });

  it('hands a ReplicaSet’s desired replicas from its detail to the actions menu', async () => {
    const replicaSet = servePanel(workload('ReplicaSet', 'rs-demo'), 'replicaset', {
      name: 'rs-demo',
      namespace: 'default',
      desiredReplicas: 4,
      replicas: '2/4',
      ready: '2/4',
    });

    await openPanel(replicaSet);

    expect(lastActionsMenu()).toMatchObject({
      object: expect.objectContaining({ kind: 'ReplicaSet', name: 'rs-demo', ready: '2/4' }),
      currentReplicas: 4,
    });
  });

  it('closes the panel once the actions menu deletes its object', async () => {
    const statefulSet = servePanel(workload('StatefulSet', 'stateful-1'), 'statefulset', {
      name: 'stateful-1',
      namespace: 'default',
    });
    await openPanel(statefulSet);
    expect(view.openPanels()).toHaveLength(1);

    const onAfterDelete = requireValue(lastActionsMenu(), 'actions menu')
      .onAfterDelete as () => void;
    await act(async () => {
      onAfterDelete();
    });
    await app.settle();

    expect(view.openPanels()).toEqual([]);
  });

  it('renders a registered kind’s descriptor from its detail', async () => {
    const configMap = servePanel(
      { group: '', version: 'v1', kind: 'ConfigMap', namespace: 'default', name: 'action-target' },
      'configmap',
      { kind: 'ConfigMap', name: 'raw-detail-name', namespace: 'default', usedBy: [] }
    );

    await openPanel(configMap);

    expect(view.container.textContent).toContain('raw-detail-name');
    expect(view.container.querySelector('[data-testid="generic-overview"]')).toBeNull();
  });

  it('renders the generic overview, with the object’s group, for an unregistered kind', async () => {
    const widget = servePanel(
      {
        group: 'example.test',
        version: 'v1',
        kind: 'Widget',
        namespace: '',
        name: 'custom-target',
      },
      'unstructured',
      { kind: 'Widget', name: 'custom-target', labels: { owner: 'team-a' } }
    );

    await openPanel(widget);

    expect(captured.genericOverview).toContainEqual(
      expect.objectContaining({
        kind: 'Widget',
        name: 'custom-target',
        group: 'example.test',
      })
    );
  });
});
