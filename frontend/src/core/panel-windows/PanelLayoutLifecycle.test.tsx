/**
 * frontend/src/core/panel-windows/PanelLayoutLifecycle.test.tsx
 *
 * Restored panel groups reach the dock before their content, and closing a
 * panel cleans its own cluster's layout without touching the active cluster's.
 * The probe runs inside the production shell, so the object-panel state,
 * dock, and PanelLayoutLifecycle are the ones the workspace window composes
 * (ViewStateContext, WorkspacePanelCoordinator, WorkspacePanelSync); only the
 * backend boundary is faked (test-utils/appState).
 */

import { act, useLayoutEffect } from 'react';
import { expect, it } from 'vitest';
import type { panelwindow } from '@/core/backend-api/models';
import { useKubeconfig } from '@/modules/kubernetes/config/KubeconfigContext';
import { useObjectPanelState } from '@/modules/object-panel/contexts/ObjectPanelStateContext';
import { objectPanelId } from '@/modules/object-panel/objectPanelRef';
import { installAppStateHarness, type TestCluster } from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { useDockablePanelContext } from '@/ui/dockable';
import type { PanelLayoutStore } from '@/ui/dockable/panelLayoutStore';
import { usePanelLayoutStoreContext } from '@/ui/dockable/panelLayoutStoreContext';
import { useRestoreWorkspacePanels } from './useRestoreWorkspacePanels';

const app = installAppStateHarness();

const group = (cluster: TestCluster): panelwindow.WorkspaceGroup => {
  const objectRef = {
    clusterId: cluster.clusterId,
    group: '',
    version: 'v1',
    kind: 'ConfigMap',
    namespace: 'default',
    name: 'settings',
  };
  const panelId = objectPanelId(objectRef);
  return {
    clusterId: cluster.clusterId,
    groupId: 'bottom',
    activePanelId: panelId,
    tabs: [{ kind: 'object' as panelwindow.TabKind, panelId, objectRef, activeView: 'yaml' }],
  };
};

it('restores groups before content and cleans an inactive cluster without touching the active cluster', async () => {
  const alpha = app.cluster({ name: 'dev', context: 'alpha' });
  const beta = app.cluster({ name: 'dev', context: 'beta' });
  app.namespaces(alpha, ['default']);
  app.namespaces(beta, ['default']);
  const view = await app.render(null);

  const stores = new Map<string, PanelLayoutStore>();
  let objects: ReturnType<typeof useObjectPanelState> | undefined;
  let dockable: ReturnType<typeof useDockablePanelContext> | undefined;
  let restore: ReturnType<typeof useRestoreWorkspacePanels> | undefined;
  const committed: Array<{ cluster: string; panels: string[]; bottom: string[] }> = [];
  const Probe = () => {
    const { selectedClusterId } = useKubeconfig();
    const objectState = useObjectPanelState();
    objects = objectState;
    const dockState = useDockablePanelContext();
    dockable = dockState;
    restore = useRestoreWorkspacePanels();
    stores.set(selectedClusterId, usePanelLayoutStoreContext());
    useLayoutEffect(() => {
      committed.push({
        cluster: selectedClusterId,
        panels: [...objectState.openPanels.keys()],
        bottom: dockState.tabGroups.bottom.tabs,
      });
    });
    return null;
  };
  const objectState = () => requireValue(objects, 'object state is mounted');
  const dock = () => requireValue(dockable, 'layout context is mounted');
  const restoreGroup = async (workspaceGroup: panelwindow.WorkspaceGroup) => {
    await act(async () => requireValue(restore, 'restore is mounted')(workspaceGroup, 'bottom'));
    await app.settle();
  };
  const first = group(alpha);
  const second = group(beta);

  await view.show(<Probe />);
  await restoreGroup(first);
  const firstStore = requireValue(stores.get(alpha.clusterId), 'first cluster layout exists');
  firstStore.updateGroupLayout('bottom', {
    bottomSize: { width: 400, height: 540 },
  });
  expect(objectState().getOwnedPanel(alpha.clusterId, first.activePanelId)?.activeView).toBe(
    'yaml'
  );
  // No commit shows the restored panel without its dock group.
  expect(
    committed
      .filter((visit) => visit.panels.includes(first.activePanelId))
      .every((visit) => visit.bottom.includes(first.activePanelId))
  ).toBe(true);

  await view.selectCluster(beta);
  await restoreGroup(second);
  const secondStore = requireValue(stores.get(beta.clusterId), 'second cluster layout exists');
  secondStore.updateGroupLayout('bottom', {
    bottomSize: { width: 400, height: 360 },
  });
  expect(firstStore.getGroupLayout('bottom').bottomSize.height).toBe(540);

  // Closing the inactive cluster's panel cleans only that cluster's layout.
  await act(async () => objectState().closePanel(alpha.clusterId, first.activePanelId));
  await app.settle();
  expect(firstStore.getState(first.activePanelId)).toBeUndefined();
  expect(dock().getClusterTabGroups(alpha.clusterId).bottom.tabs).toEqual([]);
  expect(secondStore.getGroupLayout('bottom').bottomSize.height).toBe(360);
  expect(dock().tabGroups.bottom.tabs).toEqual([second.activePanelId]);
  expect(
    objectState().getOwnedPanel(beta.clusterId, second.activePanelId)?.objectRef.clusterId
  ).toBe(beta.clusterId);

  await act(async () => objectState().removeOwnedPanel(beta.clusterId, second.activePanelId));
  await app.settle();
  expect(secondStore.getState(second.activePanelId)).toBeUndefined();
  expect(dock().tabGroups.bottom.tabs).toEqual([]);
});
