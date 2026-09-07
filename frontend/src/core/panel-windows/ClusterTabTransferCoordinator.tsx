import { useCallback, useEffect, useRef, useState } from 'react';
import type { panelwindow } from '@/core/backend-api/models';
import { useSidebarState } from '@/core/contexts/SidebarStateContext';
import { useViewState } from '@/core/contexts/ViewStateContext';
import { getWindowIdentity } from '@/core/desktop-runtime';
import { getClusterTabOrder, setClusterTabOrder } from '@/core/persistence/clusterTabOrder';
import { useKubeconfig } from '@/modules/kubernetes/config/KubeconfigContext';
import { useNamespace } from '@/modules/namespace/contexts/NamespaceContext';
import type { ViewType } from '@/modules/object-panel/components/ObjectPanel/types';
import { useObjectPanelState } from '@/modules/object-panel/contexts/ObjectPanelStateContext';
import {
  captureClusterTableState,
  restoreClusterTableState,
} from '@/shared/components/tables/persistence/gridTablePersistence';
import { useDockablePanelContext } from '@/ui/dockable';
import { reportOperationalError } from '@/utils/errorHandler';
import { type ClusterViewState, decodeClusterViewState } from './clusterViewState';
import {
  acceptClusterTabTransfer,
  acknowledgeClusterTabTransfer,
  failClusterTabTransfer,
  onClusterTabTransferCommitted,
  onClusterTabTransferFailed,
  onClusterTabTransferInsert,
  onClusterTabTransferRequested,
} from './index';
import { usePanelLifecycleGuardRegistry } from './panelLifecycleGuards';
import { samePanelTab } from './tabTransfer';
import { usePanelWorkspaceSync } from './WorkspacePanelSync';

type PendingTarget = {
  event: panelwindow.ClusterTabTransferEvent;
  state: ClusterViewState;
  mounted: boolean;
  acknowledging: boolean;
};
const panelIds = (groups: panelwindow.WorkspaceGroup[]) =>
  groups.flatMap((group) => (group.tabs ?? []).map((tab) => tab.panelId));

export function ClusterTabTransferCoordinator() {
  const windowName = getWindowIdentity();
  const sync = usePanelWorkspaceSync();
  const guards = usePanelLifecycleGuardRegistry();
  const {
    selectedClusterIds,
    selectedClusterId,
    selectedKubeconfigs,
    getClusterMeta,
    setActiveKubeconfig,
    loadKubeconfigs,
  } = useKubeconfig();
  const { getClusterNavigationState, restoreClusterNavigationState } = useViewState();
  const { getClusterSidebarSelection, setSidebarSelectionForCluster } = useSidebarState();
  const { getClusterNamespace, setSelectedNamespace } = useNamespace();
  const { upsertOwnedPanel, removeOwnedPanel } = useObjectPanelState();
  const { tabGroups, dockPanelGroup, detachPanelGroup, discardPanelLayouts } =
    useDockablePanelContext();
  const pending = useRef(new Map<string, PendingTarget>());
  const cancelled = useRef(new Set<string>());
  const [revision, update] = useState(0);
  const report = useCallback(
    (error: unknown, action: string) =>
      reportOperationalError(error, { source: 'ClusterTabTransferCoordinator', action }),
    []
  );
  const fail = useCallback(
    async (id: string, error?: unknown) => {
      if (error) {
        report(error, 'transfer-cluster-view');
      }
      try {
        await failClusterTabTransfer(windowName, id);
      } catch (failure) {
        report(failure, 'cancel-cluster-view-transfer');
      }
    },
    [windowName, report]
  );

  useEffect(
    () =>
      onClusterTabTransferRequested(({ request }) => {
        if (request.sourceWindowName !== windowName) {
          return;
        }
        const groups = sync.groupsForCluster(request.clusterId);
        const ids = panelIds(groups);
        const blocker = guards.firstBlocker(ids);
        if (!selectedClusterIds.includes(request.clusterId) || blocker) {
          blocker?.focus();
          void fail(request.transferId);
          return;
        }
        guards.freeze(request.transferId, ids);
        const accept = async () => {
          await sync.flush();
          const viewState: ClusterViewState = {
            clusterId: request.clusterId,
            navigation: getClusterNavigationState(request.clusterId),
            sidebar: getClusterSidebarSelection(request.clusterId),
            namespace: getClusterNamespace(request.clusterId),
            tables: await captureClusterTableState(request.clusterId),
          };
          await acceptClusterTabTransfer(windowName, request.transferId, {
            schemaVersion: 1,
            viewState: JSON.stringify(viewState),
            groups: sync.groupsForCluster(request.clusterId),
          });
        };
        void accept().catch((error) => fail(request.transferId, error));
      }),
    [
      windowName,
      sync,
      guards,
      selectedClusterIds,
      getClusterNavigationState,
      getClusterSidebarSelection,
      getClusterNamespace,
      fail,
    ]
  );

  useEffect(
    () =>
      onClusterTabTransferInsert((event) => {
        const { request, snapshot } = event;
        if (request.targetWindowName !== windowName || cancelled.current.has(request.transferId)) {
          return;
        }
        const groups = snapshot.groups ?? [];
        // Empty cluster views still need a staged marker to avoid claiming retained
        // panels while this destination's selected-cluster projection is loading.
        sync.stage(
          request.transferId,
          groups.length
            ? groups
            : [{ clusterId: request.clusterId, groupId: 'right', tabs: [], activePanelId: '' }]
        );
        guards.freeze(request.transferId, panelIds(groups));
        const prepare = async () => {
          const state = decodeClusterViewState(snapshot.viewState, request.clusterId);
          if (!event.targetAlreadyOpen) {
            await restoreClusterTableState(request.clusterId, state.tables);
          }
          await loadKubeconfigs(true);
          if (cancelled.current.has(request.transferId)) {
            return;
          }
          pending.current.set(request.transferId, {
            event,
            state,
            mounted: false,
            acknowledging: false,
          });
          update((value) => value + 1);
        };
        void prepare().catch((error) => fail(request.transferId, error));
      }),
    [windowName, sync, guards, loadKubeconfigs, fail]
  );

  const restoreTargetView = useCallback(
    (target: PendingTarget) => {
      const { request } = target.event;
      restoreClusterNavigationState(request.clusterId, target.state.navigation);
      setSidebarSelectionForCluster(request.clusterId, target.state.sidebar);
      if (target.state.namespace !== undefined) {
        setSelectedNamespace(target.state.namespace, request.clusterId);
      }
      const selection = selectedKubeconfigs.find(
        (value) => getClusterMeta(value).id === request.clusterId
      );
      if (selection) {
        const order = getClusterTabOrder().filter((value) => value !== selection);
        order.splice(Math.min(request.targetIndex, order.length), 0, selection);
        setClusterTabOrder(order);
      }
    },
    [
      restoreClusterNavigationState,
      setSidebarSelectionForCluster,
      setSelectedNamespace,
      selectedKubeconfigs,
      getClusterMeta,
    ]
  );

  const mountTarget = useCallback(
    (target: PendingTarget) => {
      const { request, snapshot, targetAlreadyOpen } = target.event;
      if (!targetAlreadyOpen) {
        restoreTargetView(target);
      }
      for (const group of snapshot.groups ?? []) {
        const edge = group.groupId === 'bottom' ? 'bottom' : 'right';
        for (const tab of group.tabs ?? []) {
          upsertOwnedPanel({ ...tab.objectRef }, tab.activeView as ViewType, {
            kind: 'docked',
            edge,
          });
        }
        dockPanelGroup(request.clusterId, panelIds([group]), group.activePanelId, edge);
      }
      target.mounted = true;
      update((value) => value + 1);
    },
    [upsertOwnedPanel, dockPanelGroup, restoreTargetView]
  );

  const activateTargetCluster = useCallback(
    (clusterId: string) => {
      const selection = selectedKubeconfigs.find((value) => getClusterMeta(value).id === clusterId);
      if (selection) {
        setActiveKubeconfig(selection);
      }
    },
    [selectedKubeconfigs, getClusterMeta, setActiveKubeconfig]
  );

  const advanceTarget = useCallback(
    (target: PendingTarget) => {
      const { request, snapshot } = target.event;
      if (!selectedClusterIds.includes(request.clusterId) || target.acknowledging) {
        return;
      }
      if (selectedClusterId !== request.clusterId) {
        activateTargetCluster(request.clusterId);
        return;
      }
      if (!target.mounted) {
        mountTarget(target);
        return;
      }
      if (!clusterGroupsMounted(snapshot.groups ?? [], sync.groupsForCluster(request.clusterId))) {
        return;
      }
      target.acknowledging = true;
      void sync
        .flush()
        .then(() => acknowledgeClusterTabTransfer(windowName, request.transferId))
        .catch((error) => fail(request.transferId, error));
    },
    [
      selectedClusterIds,
      selectedClusterId,
      mountTarget,
      sync,
      windowName,
      fail,
      activateTargetCluster,
    ]
  );

  useEffect(() => {
    void revision;
    void tabGroups;
    // Finish one reconstruction before changing the active cluster for another.
    const target = pending.current.values().next().value;
    if (target) {
      advanceTarget(target);
    }
  }, [revision, tabGroups, advanceTarget]);

  const removeGroups = useCallback(
    (clusterId: string, groups: panelwindow.WorkspaceGroup[]) => {
      const ids = panelIds(groups);
      detachPanelGroup(clusterId, ids);
      discardPanelLayouts(clusterId, ids);
      for (const id of ids) {
        removeOwnedPanel(clusterId, id);
      }
    },
    [detachPanelGroup, discardPanelLayouts, removeOwnedPanel]
  );
  const settle = useCallback(
    (event: panelwindow.ClusterTabTransferEvent, committed: boolean) => {
      const { request, snapshot } = event;
      if (request.sourceWindowName !== windowName && request.targetWindowName !== windowName) {
        return;
      }
      const wasTarget = pending.current.delete(request.transferId);
      cancelled.current.add(request.transferId);
      sync.settle(request.transferId);
      if ((committed && request.sourceWindowName === windowName) || (!committed && wasTarget)) {
        removeGroups(request.clusterId, snapshot.groups ?? []);
      }
      void loadKubeconfigs(true)
        .catch((error) => report(error, 'refresh-cluster-views'))
        .finally(() => guards.releaseTransfer(request.transferId));
      update((value) => value + 1);
    },
    [windowName, sync, removeGroups, loadKubeconfigs, report, guards]
  );
  useEffect(() => onClusterTabTransferCommitted((event) => settle(event, true)), [settle]);
  useEffect(() => onClusterTabTransferFailed((event) => settle(event, false)), [settle]);
  return null;
}

function clusterGroupsMounted(
  expected: panelwindow.WorkspaceGroup[],
  current: panelwindow.WorkspaceGroup[]
): boolean {
  return expected.every((group) => {
    const mounted = current.find((candidate) => candidate.groupId === group.groupId);
    return (
      !!mounted &&
      (group.tabs ?? []).every((tab) =>
        samePanelTab(
          mounted.tabs?.find((candidate) => candidate.panelId === tab.panelId) ?? null,
          tab
        )
      )
    );
  });
}
