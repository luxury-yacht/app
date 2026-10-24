import { useCallback, useEffect, useRef, useState } from 'react';
import type { panelwindow } from '@/core/backend-api/models';
import { useSidebarState } from '@/core/contexts/SidebarStateContext';
import { useViewState } from '@/core/contexts/ViewStateContext';
import { getWindowIdentity } from '@/core/desktop-runtime';
import { getClusterTabOrder, setClusterTabOrder } from '@/core/persistence/clusterTabOrder';
import { useKubeconfig } from '@/modules/kubernetes/config/KubeconfigContext';
import { useNamespace } from '@/modules/namespace/contexts/NamespaceContext';
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
import { useRemoveWorkspacePanels } from './useRemoveWorkspacePanels';
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
  const { tabGroups } = useDockablePanelContext();
  const removeWorkspacePanels = useRemoveWorkspacePanels();
  const pending = useRef(new Map<string, PendingTarget>());
  const cancelled = useRef(new Set<string>());
  const [revision, setRevision] = useState(0);
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
      } catch (error_) {
        report(error_, 'cancel-cluster-view-transfer');
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
        if (guards.isFrozen() || !selectedClusterIds.includes(request.clusterId) || blocker) {
          blocker?.focus();
          void fail(request.transferId);
          return;
        }
        guards.freeze(request.transferId, ids);
        const accept = async () => {
          // Close intents queue with publications; land them before the
          // directory decides which docked panels travel with the view.
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
        if (guards.isFrozen(request.transferId)) {
          void fail(request.transferId);
          return;
        }
        // The panel projection mounts these groups from directory reads.
        guards.freeze(request.transferId, panelIds(event.groups ?? []));
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
          setRevision((value) => value + 1);
        };
        void prepare().catch((error) => fail(request.transferId, error));
      }),
    [windowName, guards, loadKubeconfigs, fail]
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
      if (!target.event.targetAlreadyOpen) {
        restoreTargetView(target);
      }
      target.mounted = true;
      setRevision((value) => value + 1);
    },
    [restoreTargetView]
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
      const { request, groups } = target.event;
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
      if (!clusterGroupsMounted(groups ?? [], sync.groupsForCluster(request.clusterId))) {
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

  const settle = useCallback(
    (event: panelwindow.ClusterTabTransferEvent, committed: boolean) => {
      const { request, groups } = event;
      if (request.sourceWindowName !== windowName && request.targetWindowName !== windowName) {
        return;
      }
      const wasTarget = pending.current.delete(request.transferId);
      cancelled.current.add(request.transferId);
      if ((committed && request.sourceWindowName === windowName) || (!committed && wasTarget)) {
        removeWorkspacePanels(request.clusterId, panelIds(groups ?? []));
      }
      void loadKubeconfigs(true)
        .catch((error) => report(error, 'refresh-cluster-views'))
        .finally(() => guards.releaseTransfer(request.transferId));
      setRevision((value) => value + 1);
    },
    [windowName, removeWorkspacePanels, loadKubeconfigs, report, guards]
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
