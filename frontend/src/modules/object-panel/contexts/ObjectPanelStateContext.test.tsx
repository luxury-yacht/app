/**
 * frontend/src/modules/object-panel/contexts/ObjectPanelStateContext.test.tsx
 *
 * The workspace window's object-panel state: open panels and their active
 * views are kept per cluster tab, survive switching tabs and a denied close,
 * and are dropped with their cached reads (refresh scopes, log viewer and Helm
 * values views) exactly once when a panel or its cluster tab goes away. Runs
 * the production shell's own state provider under the real kubeconfig owner
 * and refresh orchestrator (test-utils/appState); cluster tabs switch, close,
 * and reopen through the real owner. Evictions are observed on the real
 * orchestrator with a pass-through spy.
 */

import {
  getHelmValuesView,
  setHelmValuesView,
} from '@modules/object-panel/components/ObjectPanel/Helm/helmValuesViewCache';
import {
  getLogViewerPrefs,
  setLogViewerPrefs,
} from '@modules/object-panel/components/ObjectPanel/Logs/logViewerPrefsCache';
import {
  ObjectPanelStateProvider,
  useObjectPanelActiveTab,
  useObjectPanelState,
} from '@modules/object-panel/contexts/ObjectPanelStateContext';
import { act } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { panelwindow } from '@/core/backend-api/models';
import { refreshOrchestrator } from '@/core/refresh/orchestrator';
import {
  installAppStateHarness,
  type MountedApp,
  type TestCluster,
} from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

const app = installAppStateHarness();
let view: MountedApp;
let alpha: TestCluster;
let beta: TestCluster;
let state: ReturnType<typeof useObjectPanelState> | null = null;
let activeTab: string | undefined;

function Probe({ panelId }: Readonly<{ panelId?: string }>) {
  state = useObjectPanelState();
  activeTab = useObjectPanelActiveTab(panelId ?? '');
  return null;
}

const current = () => requireValue(state, 'object panel state');
const pod = (cluster: TestCluster, name: string, namespace = 'default') => ({
  clusterId: cluster.clusterId,
  group: '',
  version: 'v1',
  kind: 'Pod',
  namespace,
  name,
});

/** Opens `ref` the way a row click does; returns its panel id. */
const open = (ref: Parameters<ReturnType<typeof useObjectPanelState>['onRowClick']>[0]) => {
  let panelId = '';
  act(() => {
    panelId = current().onRowClick(ref);
  });
  return panelId;
};

const openNames = () => Array.from(current().openPanels.values()).map((target) => target.name);

const closeClusterTab = async (cluster: TestCluster) => {
  await act(async () => {
    await view.owners().kubeconfig.closeKubeconfig(cluster.selection);
  });
  await app.settle();
};

const reopenClusterTab = async (cluster: TestCluster) => {
  await act(async () => {
    await view.owners().kubeconfig.openKubeconfig(cluster.selection);
  });
  await app.settle();
};

/** Records the scoped refresh entries the panel state evicts, still evicting them. */
const recordEvictions = () => vi.spyOn(refreshOrchestrator, 'resetScopedDomain');
const evictedDomains = (spy: ReturnType<typeof recordEvictions>) =>
  spy.mock.calls.map(([domain]) => domain);

beforeEach(async () => {
  state = null;
  activeTab = undefined;
  alpha = app.cluster({ name: 'dev', context: 'alpha' });
  beta = app.cluster({ name: 'dev', context: 'beta' });
  app.namespaces(alpha, ['default', 'team-a']);
  app.namespaces(beta, ['default', 'team-b']);
  view = await app.render(null);
  await view.show(<Probe />);
});

describe('per cluster tab', () => {
  it('keeps object panel state isolated per cluster tab', async () => {
    open(pod(alpha, 'api'));
    expect(current().showObjectPanel).toBe(true);
    expect(openNames()).toEqual(['api']);

    await view.selectCluster(beta);
    expect(current().showObjectPanel).toBe(false);
    expect(openNames()).toEqual([]);
    open({ ...pod(beta, 'web'), group: 'apps', kind: 'Deployment' });
    expect(openNames()).toEqual(['web']);

    await view.selectCluster(alpha);
    expect(current().showObjectPanel).toBe(true);
    expect(openNames()).toEqual(['api']);
  });

  it('stores a cross-cluster object in the cluster identified by the object reference', async () => {
    open({
      group: '',
      version: 'v1',
      kind: 'Namespace',
      name: 'team-b',
      clusterId: beta.clusterId,
    });
    expect(openNames()).toEqual([]);

    await view.selectCluster(beta);

    expect(Array.from(current().openPanels.values())).toEqual([
      expect.objectContaining({ clusterId: beta.clusterId, kind: 'Namespace', name: 'team-b' }),
    ]);
  });

  it('persists the active sub-tab per cluster tab', async () => {
    const panelId = open(pod(alpha, 'api'));
    act(() => current().setObjectPanelActiveTab(alpha.clusterId, panelId, 'logs'));
    await view.show(<Probe panelId={panelId} />);
    expect(activeTab).toBe('logs');

    await view.selectCluster(beta);
    expect(activeTab).toBeUndefined();
    const betaPanelId = open(pod(beta, 'api'));
    act(() => current().setObjectPanelActiveTab(beta.clusterId, betaPanelId, 'yaml'));
    await view.show(<Probe panelId={betaPanelId} />);
    expect(activeTab).toBe('yaml');

    await view.selectCluster(alpha);
    await view.show(<Probe panelId={panelId} />);
    expect(activeTab).toBe('logs');
  });

  it('clears the active sub-tab entry when a panel is closed', async () => {
    const panelId = open(pod(alpha, 'api'));
    act(() => current().setObjectPanelActiveTab(alpha.clusterId, panelId, 'events'));
    await view.show(<Probe panelId={panelId} />);
    expect(activeTab).toBe('events');

    act(() => current().closePanel(alpha.clusterId, panelId));

    expect(current().openPanels.has(panelId)).toBe(false);
    expect(activeTab).toBeUndefined();
  });

  it('does not re-render state-only consumers when a panel tab changes', async () => {
    let renders = 0;
    function StateConsumer() {
      useObjectPanelState();
      renders += 1;
      return null;
    }
    await view.show(
      <>
        <Probe />
        <StateConsumer />
      </>
    );
    const panelId = open(pod(alpha, 'api'));
    const rendersAfterOpen = renders;

    act(() => current().setObjectPanelActiveTab(alpha.clusterId, panelId, 'logs'));

    expect(renders).toBe(rendersAfterOpen);
  });

  it('rejects object panel references without clusterId', () => {
    expect(() => current().onRowClick({ kind: 'Pod', name: 'api', namespace: 'default' })).toThrow(
      'Object panel reference is missing clusterId'
    );
    expect(current().openPanels.size).toBe(0);
  });
});

describe('closing a cluster tab', () => {
  it('retains panels while a tab is hidden for close and restores them after denial', async () => {
    const panelId = open(pod(alpha, 'api'));
    const evictions = recordEvictions();
    app.backend.answer('CloseClusterView', () => false);
    const decide = app.backend.hold('CloseClusterView');

    let closing!: Promise<void>;
    act(() => {
      closing = view.owners().kubeconfig.closeKubeconfig(alpha.selection);
    });
    await app.settle();
    expect(view.owners().kubeconfig.selectedClusterIds).not.toContain(alpha.clusterId);
    expect(current().getOwnedPanel(alpha.clusterId, panelId)).not.toBeNull();
    expect(evictions).not.toHaveBeenCalled();

    await act(async () => decide());
    await act(async () => {
      await closing;
    });
    await view.selectCluster(alpha);

    expect(current().openPanels.has(panelId)).toBe(true);
  });

  it('clears object panel state when a tab is closed', async () => {
    await view.selectCluster(beta);
    open(pod(beta, 'job'));
    expect(current().showObjectPanel).toBe(true);

    await closeClusterTab(beta);
    await reopenClusterTab(beta);

    expect(view.owners().kubeconfig.selectedClusterId).toBe(beta.clusterId);
    expect(current().showObjectPanel).toBe(false);
    expect(current().openPanels.size).toBe(0);
  });

  it('evicts only the closed cluster tab’s panel scopes', async () => {
    open(pod(alpha, 'api', 'team-a'));
    await view.selectCluster(beta);
    open(pod(beta, 'web', 'team-b'));
    const evictions = recordEvictions();

    await closeClusterTab(beta);

    const evictedScopes = evictions.mock.calls.map(([, scope]) => scope);
    expect(evictedScopes.length).toBeGreaterThan(0);
    expect(evictedScopes.every((scope) => scope.includes(beta.clusterId))).toBe(true);
  });

  it('does not evict scopes when a different cluster tab is activated', async () => {
    open(pod(alpha, 'api'));
    const evictions = recordEvictions();

    await view.selectCluster(beta);

    expect(evictions).not.toHaveBeenCalled();
  });
});

describe('closing and moving panels', () => {
  it('evicts every scoped-domain entry for a panel when closePanel runs', () => {
    const panelId = open(pod(alpha, 'api', 'team-a'));
    const evictions = recordEvictions();

    act(() => current().closePanel(alpha.clusterId, panelId));

    // A pod's details and YAML share the detail scope; events and logs have
    // their own. Helm-only domains stay untouched.
    expect(evictedDomains(evictions)).toEqual(
      expect.arrayContaining(['object-details', 'object-yaml', 'object-events', 'container-logs'])
    );
    expect(evictedDomains(evictions)).not.toContain('object-helm-manifest');
    expect(evictedDomains(evictions)).not.toContain('object-helm-values');
  });

  it('evicts helm scopes when closePanel runs on a HelmRelease panel', () => {
    const panelId = open({
      kind: 'HelmRelease',
      name: 'my-app',
      namespace: 'team-a',
      clusterId: alpha.clusterId,
    });
    const evictions = recordEvictions();

    act(() => current().closePanel(alpha.clusterId, panelId));

    expect(evictedDomains(evictions)).toEqual(
      expect.arrayContaining(['object-helm-manifest', 'object-helm-values'])
    );
  });

  it('evicts every active-cluster panel when onCloseObjectPanel runs', () => {
    open(pod(alpha, 'api', 'team-a'));
    open({ ...pod(alpha, 'web', 'team-a'), group: 'apps', kind: 'Deployment' });
    const evictions = recordEvictions();

    act(() => current().onCloseObjectPanel());

    const panelsEvicted = new Set(evictions.mock.calls.map(([, scope]) => scope));
    expect(panelsEvicted.size).toBeGreaterThanOrEqual(2);
  });

  it('announces panels the user closes, but not panels that move away', () => {
    const closed: Array<[string, string[]]> = [];
    const stop = current().subscribeClosedPanels((clusterId, panelIds) => {
      closed.push([clusterId, panelIds]);
    });
    const api = open(pod(alpha, 'api', 'team-a'));
    const web = open({ ...pod(alpha, 'web', 'team-a'), group: 'apps', kind: 'Deployment' });
    const db = open({ ...pod(alpha, 'db', 'team-a'), kind: 'Service' });

    act(() => current().removeOwnedPanel(alpha.clusterId, web));
    expect(closed).toEqual([]);
    act(() => current().closePanel(alpha.clusterId, api));
    act(() => current().closePanel(alpha.clusterId, api));
    expect(closed).toEqual([[alpha.clusterId, [api]]]);
    act(() => current().onCloseObjectPanel());
    expect(closed).toEqual([
      [alpha.clusterId, [api]],
      [alpha.clusterId, [db]],
    ]);

    stop();
    open(pod(alpha, 'later', 'team-a'));
    act(() => current().onCloseObjectPanel());
    expect(closed).toHaveLength(2);
  });

  it('evicts local caches once when the renderer relinquishes a transferred panel', () => {
    const panelId = open(pod(alpha, 'api'));
    setLogViewerPrefs(panelId, {} as never);
    const evictions = recordEvictions();

    act(() => current().removeOwnedPanel(alpha.clusterId, panelId));

    expect(evictedDomains(evictions)).toEqual(
      expect.arrayContaining(['object-details', 'object-yaml', 'object-events', 'container-logs'])
    );
    expect(getLogViewerPrefs(panelId)).toBeUndefined();

    evictions.mockClear();
    act(() => current().removeOwnedPanel(alpha.clusterId, panelId));
    expect(evictions).not.toHaveBeenCalled();
  });

  it.each(['transfer', 'close', 'close-all', 'cluster-close'] as const)(
    'evicts %s scopes once after panel removal commits',
    async (operation) => {
      const panelId = open(pod(alpha, 'api'));
      setHelmValuesView(panelId, 'merged');
      setLogViewerPrefs(panelId, {} as never);
      const stillOpenAtEviction: boolean[] = [];
      const evictions = recordEvictions().mockImplementation(() => {
        stillOpenAtEviction.push((state?.getOwnedPanel(alpha.clusterId, panelId) ?? null) !== null);
      });

      if (operation === 'transfer') {
        act(() => current().removeOwnedPanel(alpha.clusterId, panelId));
      } else if (operation === 'close') {
        act(() => current().closePanel(alpha.clusterId, panelId));
      } else if (operation === 'close-all') {
        act(() => current().onCloseObjectPanel());
      } else {
        await view.selectCluster(beta);
        await closeClusterTab(alpha);
      }

      expect(stillOpenAtEviction.length).toBeGreaterThan(0);
      expect(stillOpenAtEviction.every((stillOpen) => !stillOpen)).toBe(true);
      const evicted = evictions.mock.calls.map(([domain, scope]) => `${domain}:${scope}`);
      expect(new Set(evicted).size).toBe(evicted.length);
      expect(getLogViewerPrefs(panelId)).toBeUndefined();
      expect(getHelmValuesView(panelId)).toBeUndefined();
    }
  );
});

describe('panel handoffs', () => {
  it('tracks a hidden native-open handoff until the panel is committed or docked', () => {
    const ref = pod(alpha, 'api');
    let panelId = '';
    act(() => {
      panelId = current().onRowClick(ref, { pendingNativeOpen: true });
    });
    expect(current().pendingNativeOpenPanelIds.has(panelId)).toBe(true);

    act(() =>
      current().restorePanelTabs({
        schemaVersion: 1,
        transferId: 'transfer-pending',
        sourceWindowName: app.windowName,
        clusterId: alpha.clusterId,
        groupId: 'group-pending',
        activePanelId: panelId,
        tabs: [{ kind: 'object', panelId, objectRef: ref, activeView: 'details' }],
      } as panelwindow.GroupSnapshot)
    );

    expect(current().pendingNativeOpenPanelIds.has(panelId)).toBe(false);
  });

  it('docks a group without changing other panels or their previously published state', () => {
    const ref = pod(alpha, 'existing');
    let existingId = '';
    let incomingId = '';
    act(() => {
      existingId = current().upsertOwnedPanel(ref, 'events');
      incomingId = current().onRowClick({ ...ref, name: 'incoming' }, { pendingNativeOpen: true });
    });
    const previous = current();
    const evictions = recordEvictions();

    act(() =>
      current().restorePanelTabs({
        clusterId: alpha.clusterId,
        tabs: [
          {
            kind: 'object',
            panelId: incomingId,
            objectRef: { ...ref, name: 'incoming' },
            activeView: 'yaml',
          },
        ],
      } as panelwindow.GroupSnapshot)
    );

    expect(current().panelIdsForCluster(alpha.clusterId)).toEqual([existingId, incomingId]);
    expect(current().getOwnedPanel(alpha.clusterId, existingId)).toMatchObject({
      activeView: 'events',
    });
    expect(current().getOwnedPanel(alpha.clusterId, incomingId)).toMatchObject({
      activeView: 'yaml',
    });
    expect(current().pendingNativeOpenPanelIds.has(incomingId)).toBe(false);
    expect(previous.pendingNativeOpenPanelIds.has(incomingId)).toBe(true);
    expect(evictions).not.toHaveBeenCalled();
  });

  it('retains complete local object identity while updating the active view', () => {
    const ref = pod(alpha, 'api');
    let panelId = '';
    act(() => {
      panelId = current().upsertOwnedPanel(ref, 'events');
    });
    expect(current().getOwnedPanel(alpha.clusterId, panelId)).toMatchObject({
      objectRef: ref,
      activeView: 'events',
    });
    expect(current().panelIdsForCluster(alpha.clusterId)).toEqual([panelId]);

    act(() => {
      current().upsertOwnedPanel(ref, 'yaml');
    });
    expect(current().getOwnedPanel(alpha.clusterId, panelId)).toMatchObject({
      activeView: 'yaml',
    });

    act(() => current().removeOwnedPanel(alpha.clusterId, panelId));
    expect(current().getOwnedPanel(alpha.clusterId, panelId)).toBeNull();
    expect(current().panelIdsForCluster(alpha.clusterId)).toEqual([]);
  });

  it('opens a native window with the group the directory gives it', async () => {
    const objectRef = {
      clusterId: alpha.clusterId,
      group: 'apps',
      version: 'v1',
      kind: 'Deployment',
      namespace: 'default',
      name: 'api',
    };
    const group = {
      clusterId: alpha.clusterId,
      groupId: 'floating-1',
      activePanelId: 'panel-native',
      tabs: [{ kind: 'object', panelId: 'panel-native', objectRef, activeView: 'yaml' }],
    } as panelwindow.WorkspaceGroup;

    // A panel window's own state provider starts from its descriptor's group.
    await view.show(
      <ObjectPanelStateProvider initialGroup={group}>
        <Probe />
      </ObjectPanelStateProvider>
    );

    expect(current().panelIdsForCluster(alpha.clusterId)).toEqual(['panel-native']);
    expect(current().getOwnedPanel(alpha.clusterId, 'panel-native')).toMatchObject({
      objectRef,
      activeView: 'yaml',
    });
  });
});
