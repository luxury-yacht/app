/**
 * frontend/src/modules/object-panel/hooks/useObjectPanel.test.tsx
 *
 * Opening object and identity panels: an open claims the panel through the
 * shared directory, reuses a panel shown elsewhere or already open, applies
 * the requested or retained view, moves focus to it, switches to its cluster
 * first, refuses incomplete identities, and floats only a newly opened panel
 * when the user prefers floating. Runs the hook in the full app, whose layout
 * hosts the open panels, with its real object-panel state, dock, and
 * kubeconfig owner; only the backend boundary is faked (test-utils/appState).
 */

import {
  objectPanelId,
  useObjectPanelActiveTabs,
} from '@modules/object-panel/contexts/ObjectPanelStateContext';
import { act } from 'react';
import { describe, expect, it } from 'vitest';
import { panelwindow } from '@/core/backend-api/models';
import { acknowledgePanelWindowReady } from '@/core/panel-windows';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { snapshotResponse } from '@/test-utils/appState/transport';
import { requireValue } from '@/test-utils/requireValue';
import { useObjectPanel } from './useObjectPanel';

const app = installAppStateHarness();
let view: MountedApp;
let dev: TestCluster;
let other: TestCluster;
let hook: ReturnType<typeof useObjectPanel> | undefined;
let activeTabs = new Map<string, string>();

function Probe() {
  hook = useObjectPanel();
  activeTabs = useObjectPanelActiveTabs() as Map<string, string>;
  return null;
}

const panel = () => requireValue(hook, 'object panel hook');
const pod = (cluster = dev) => ({
  kind: 'Pod',
  group: '',
  version: 'v1',
  name: 'api',
  namespace: 'default',
  clusterId: cluster.clusterId,
});

const start = async () => {
  dev = app.cluster({ name: 'dev', context: 'alpha' });
  other = app.cluster({ name: 'dev', context: 'beta' });
  app.namespaces(dev, ['default']);
  app.namespaces(other, ['default']);
  app.startScreen(dev);
  app.startScreen(other);
  view = await app.mountApp(<Probe />);
};

const openObject = async (
  ref: Parameters<ReturnType<typeof useObjectPanel>['openWithObject']>[0],
  options?: Parameters<ReturnType<typeof useObjectPanel>['openWithObject']>[1]
) => {
  // The app renders the panel it opens, which reads its object. An incomplete
  // identity opens nothing, so it has nothing to serve.
  const cluster = [dev, other].find((candidate) => candidate.clusterId === ref.clusterId);
  if (cluster && typeof ref.group === 'string' && ref.version && ref.kind && ref.name) {
    app.servePanel(cluster, {
      group: ref.group,
      version: ref.version,
      kind: ref.kind,
      namespace: ref.namespace ?? '',
      name: ref.name,
    });
  }
  await act(async () => {
    panel().openWithObject(ref, options);
  });
  await app.settle();
};

const focusedPanelId = () =>
  document.activeElement?.closest('[data-panel-id]')?.getAttribute('data-panel-id');

describe('opening an object panel', () => {
  it('opens the panel with its object and cluster, and focuses it', async () => {
    await start();

    await openObject(pod());

    // Outside a panel's own tree there is no current object.
    expect(panel().objectData).toBeNull();
    expect(panel().isOpen).toBe(true);
    expect(Array.from(panel().openPanels.values())).toEqual([
      { ...pod(), clusterName: dev.clusterName },
    ]);
    expect(focusedPanelId()).toBe(objectPanelId(pod()));
  });

  it('uses the shared panel shown elsewhere instead of opening a duplicate here', async () => {
    await start();
    // The directory already shows the panel in a native window.
    app.backend.answer('OpenPanelWorkspaceObject', (_windowName, tab) => ({
      panel: {
        tab,
        location: {
          kind: panelwindow.PanelLocationKind.PanelLocationWindow,
          windowName: 'panel-1',
          groupId: 'native',
          index: 0,
          active: true,
        },
      },
      render: false,
    }));

    await openObject(pod());

    expect(app.backend.calls('OpenPanelWorkspaceObject')).toEqual([
      [app.windowName, expect.objectContaining({ objectRef: expect.objectContaining(pod()) })],
    ]);
    expect(panel().openPanels.size).toBe(0);
  });

  it('activates the existing tab instead of duplicating it, and focuses it again', async () => {
    await start();
    await openObject(pod());
    (document.activeElement as HTMLElement | null)?.blur();

    await openObject(pod());

    expect(panel().openPanels.size).toBe(1);
    expect(focusedPanelId()).toBe(objectPanelId(pod()));
  });

  // Links spell some kinds in lowercase (a Deployment's ReplicaSet link). The
  // directory refuses a listed panel id whose object identity differs, so a
  // reopen through such a link must send the identity it was opened with.
  it('focuses the open panel when a link spells its kind in another case', async () => {
    await start();
    await openObject(pod());
    (document.activeElement as HTMLElement | null)?.blur();

    await openObject({ ...pod(), kind: 'pod' });

    expect(app.backend.calls('OpenPanelWorkspaceObject').map(([, tab]) => tab.objectRef)).toEqual([
      expect.objectContaining({ kind: 'Pod' }),
      expect.objectContaining({ kind: 'Pod' }),
    ]);
    expect(panel().openPanels.size).toBe(1);
    expect(focusedPanelId()).toBe(objectPanelId(pod()));
  });

  it('restores the retained panel sub-tab when reopening its object', async () => {
    await start();
    const panelId = objectPanelId(pod());
    app.backend.answer('OpenPanelWorkspaceObject', (windowName) => ({
      panel: {
        tab: {
          kind: panelwindow.TabKind.TabKindObject,
          panelId,
          objectRef: pod(),
          activeView: 'events',
        },
        location: {
          kind: panelwindow.PanelLocationKind.PanelLocationDocked,
          windowName,
          groupId: 'right',
          index: 0,
          active: true,
        },
      },
      render: true,
    }));

    await openObject(pod());

    expect(activeTabs.get(panelId)).toBe('events');
  });

  it('applies an initial sub-tab in the same open', async () => {
    await start();

    await openObject(pod(), { initialTab: 'events' });

    expect(activeTabs.get(objectPanelId(pod()))).toBe('events');
  });

  it('switches to the owning cluster before opening a cross-cluster object panel', async () => {
    await start();
    const namespace = {
      kind: 'Namespace',
      group: '',
      version: 'v1',
      name: 'team-b',
      clusterId: other.clusterId,
      clusterName: other.clusterName,
    };

    await openObject(namespace);

    expect(view.owners().kubeconfig.selectedClusterId).toBe(other.clusterId);
    expect(Array.from(panel().openPanels.values())).toEqual([expect.objectContaining(namespace)]);
    expect(focusedPanelId()).toBe(objectPanelId(namespace));
  });

  it.each([
    ['the name a link built in another cluster carried', 'borrowed'],
    ['no name', 'none'],
  ] as const)(
    'names a cross-cluster object panel from its cluster id when the ref carries %s',
    async (_case, carried) => {
      await start();
      const namespace = {
        kind: 'Namespace',
        group: '',
        version: 'v1',
        name: 'team-b',
        clusterId: other.clusterId,
      };

      await openObject(
        carried === 'borrowed' ? { ...namespace, clusterName: dev.clusterName } : namespace
      );

      expect(Array.from(panel().openPanels.values())).toEqual([
        expect.objectContaining({ ...namespace, clusterName: other.clusterName }),
      ]);
    }
  );

  it('tells the user, and opens nothing, for a cluster this window does not display', async () => {
    const unopened = app.cluster({ name: 'dev', context: 'unopened', open: false });
    await start();

    await openObject({
      kind: 'Namespace',
      group: '',
      version: 'v1',
      name: 'missing',
      clusterId: unopened.clusterId,
    });

    // The window never claims a panel for a cluster it does not show.
    expect(app.backend.calls('OpenPanelWorkspaceObject')).toEqual([]);
    expect(panel().openPanels.size).toBe(0);
    expect(view.owners().kubeconfig.selectedClusterId).toBe(dev.clusterId);
    expect(app.errors.take((record) => record.kinds.includes('warning'))).toEqual([
      expect.objectContaining({
        context: expect.objectContaining({ clusterId: unopened.clusterId }),
      }),
    ]);
  });

  it('closes all panels via close()', async () => {
    await start();
    const settings = { ...pod(), kind: 'ConfigMap', name: 'settings' };
    await openObject(settings);
    await openObject({ ...settings, name: 'other-settings' });
    expect(panel().openPanels.size).toBe(2);

    await act(async () => panel().close());

    // Outside a panel's own tree, close() closes every panel.
    expect(panel().isOpen).toBe(false);
    expect(panel().openPanels.size).toBe(0);
  });

  it('floats only each newly opened panel when floating is the default', async () => {
    app.preferences({ defaultObjectPanelPosition: 'floating' });
    await start();

    await openObject(pod());
    const [[, first]] = app.backend.calls('BeginPanelWindowOpen');
    await act(async () => {
      await acknowledgePanelWindowReady('panel-1', first.transferId);
    });
    await app.settle();
    await openObject({ ...pod(), name: 'worker' });

    expect(
      app.backend
        .calls('BeginPanelWindowOpen')
        .map(([, snapshot]) => (snapshot.tabs ?? []).map((tab) => tab.panelId))
    ).toEqual([[objectPanelId(pod())], [objectPanelId({ ...pod(), name: 'worker' })]]);
  });
});

describe('opening an identity panel', () => {
  it('opens identities through the shared registry and keeps exact subjects', async () => {
    await start();
    const ref = {
      targetType: 'identity' as const,
      clusterId: dev.clusterId,
      kind: 'User' as const,
      name: ' alice ',
    };
    // An identity panel looks its subject up (backend cluster-identities query); none bound.
    app.snapshots.respond((request) =>
      request.domain === 'cluster-identities'
        ? snapshotResponse({
            domain: 'cluster-identities',
            scope: request.scope,
            version: 1,
            payload: {
              clusterId: dev.clusterId,
              clusterName: dev.clusterName,
              provider: 'typed-resource',
              table: 'cluster-identities',
              total: 0,
              unfilteredTotal: 0,
              totalIsExact: true,
              facetsExact: true,
              capabilities: {},
              rows: [],
              completeness: 'complete',
            },
          })
        : undefined
    );

    await act(async () => panel().openWithIdentity(ref));
    await app.settle();

    const [[, tab]] = app.backend.calls('OpenPanelWorkspaceObject');
    expect(tab).toMatchObject({
      kind: 'identity',
      identityRef: { clusterId: ref.clusterId, kind: ref.kind, name: ref.name },
      activeView: 'details',
    });
    expect(tab.objectRef).toBeUndefined();
    expect([...panel().openPanels.values()]).toEqual([ref]);
    expect(focusedPanelId()).toBe(tab.panelId);

    await act(async () => panel().openWithIdentity(ref));
    expect(panel().openPanels.size).toBe(1);
    await act(async () => panel().openWithIdentity({ ...ref, kind: 'Group' }));
    expect(panel().openPanels.size).toBe(2);
  });
});

// Runtime defense for the kind-only-objects bug: programmatically built refs
// (helpers, mappers) that a literal call-site audit cannot see. See
// assertObjectRefHasRequiredIdentity in src/types/view-state.ts.
describe('refusing incomplete object identity', () => {
  it.each([
    [
      'a kind without a version',
      () => ({
        kind: 'DBInstance',
        name: 'primary',
        namespace: 'default',
        clusterId: dev.clusterId,
      }),
      /missing version/,
    ],
    [
      'a custom resource without a group',
      () => ({
        kind: 'DBInstance',
        version: 'v1alpha1',
        name: 'primary',
        namespace: 'default',
        clusterId: dev.clusterId,
      }),
      /missing group/,
    ],
    [
      'a ref missing both, with a hint to the fix helpers',
      () => ({ kind: 'Rollout', name: 'canary', clusterId: dev.clusterId }),
      /resolveBuiltinGroupVersion|parseApiVersion/,
    ],
  ])('throws for %s', async (_case, ref, message) => {
    await start();

    expect(() => {
      act(() => {
        panel().openWithObject(ref());
      });
    }).toThrow(message);
    expect(panel().openPanels.size).toBe(0);
  });

  it.each([
    [
      'a synthetic HelmRelease with canonical identity',
      () => ({ ...pod(), kind: 'HelmRelease', group: 'helm.sh', version: 'v3', name: 'demo' }),
    ],
    ['a built-in core resource', () => pod()],
    [
      'a custom resource with its group',
      () => ({
        ...pod(),
        kind: 'DBInstance',
        group: 'rds.services.k8s.aws',
        version: 'v1alpha1',
        name: 'primary',
      }),
    ],
  ])('opens %s', async (_case, ref) => {
    await start();

    await openObject(ref());

    expect(panel().openPanels.size).toBe(1);
  });
});
