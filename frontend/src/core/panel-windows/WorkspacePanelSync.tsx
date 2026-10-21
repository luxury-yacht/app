import { panelTargetFromSnapshot } from '@modules/object-panel/panelTarget';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { readPanelWorkspace } from '@/core/app-state-access';
import type { panelwindow } from '@/core/backend-api/models';
import { useClusterWorkspaceSnapshot } from '@/core/cluster-workspace/useClusterWorkspace';
import { getWindowIdentity } from '@/core/desktop-runtime';
import { useKubeconfig } from '@/modules/kubernetes/config/KubeconfigContext';
import { useLocalPanelSnapshots } from '@/modules/object-panel/contexts/ObjectPanelStateContext';
import { useDockablePanelContext } from '@/ui/dockable';
import type { TabGroupState } from '@/ui/dockable/tabGroupTypes';
import { reportOperationalError } from '@/utils/errorHandler';
import { ClusterPanelActivity } from './clusterPanelActivity';
import {
  acknowledgePanelWorkspaceReady,
  onPanelWorkspaceChanged,
  openPanelWorkspaceObject,
  publishDockedPanels,
} from './index';
import { PanelLayoutLifecycle } from './PanelLayoutLifecycle';
import { nativePanelPublication, workspacePanelPublication } from './publicationQueue';
import { settlePanelClose, useClosedPanelIntents } from './useClosedPanelIntents';
import { useRemoveWorkspacePanels } from './useRemoveWorkspacePanels';
import { useRestoreWorkspacePanels } from './useRestoreWorkspacePanels';

interface WorkspaceSync {
  flush: () => Promise<void>;
  groupsForCluster: (clusterId: string) => panelwindow.WorkspaceGroup[];
  readCluster: (clusterId: string) => Promise<panelwindow.WorkspaceSnapshot | null>;
  quiesceCluster: (clusterId: string) => Promise<(closed: boolean) => void>;
  openPanel: (
    tab: panelwindow.TabSnapshot
  ) => Promise<Awaited<ReturnType<typeof openPanelWorkspaceObject>> | null>;
}
const PublicationContext = createContext<WorkspaceSync | null>(null);

// One group the directory is moving into this app view: a dock-back group, a
// dropped tab, or one group of a cluster view (`view`). The view mounts a
// provisional copy at insertIndex and drops it if a later read shows the move
// cancelled or its source gone. A view move is settled by the cluster-view
// handoff; every other move by this view's acknowledgement.
export interface IncomingGroupTransfer {
  transferId: string;
  clusterId: string;
  sourceWindowName: string;
  groupId: 'right' | 'bottom';
  insertIndex: number;
  view: boolean;
  tabs: panelwindow.TabSnapshot[];
  activePanelId: string;
}
const IncomingTransfersContext = createContext<readonly IncomingGroupTransfer[]>([]);
export const useIncomingGroupTransfers = () => useContext(IncomingTransfersContext);

const targetsWindow = (panel: panelwindow.WorkspacePanel, windowName: string) =>
  panel.transfer?.target.windowName === windowName;

function incomingGroupTransfers(
  clusterId: string,
  panels: panelwindow.WorkspacePanel[],
  windowName: string
): IncomingGroupTransfer[] {
  const groups = new Map<string, panelwindow.WorkspacePanel[]>();
  for (const panel of panels) {
    const transfer = panel.transfer;
    if (transfer && targetsWindow(panel, windowName)) {
      const key = `${transfer.transferId}\0${transfer.target.groupId}`;
      groups.set(key, [...(groups.get(key) ?? []), panel]);
    }
  }
  return Array.from(groups.values(), (members) => {
    const ordered = [...members].sort(
      (a, b) => (a.transfer?.target.index ?? 0) - (b.transfer?.target.index ?? 0)
    );
    const active = ordered.find((panel) => panel.transfer?.target.active) ?? ordered[0];
    const transfer = ordered[0].transfer;
    return {
      transferId: transfer?.transferId ?? '',
      clusterId,
      sourceWindowName: ordered[0].location.windowName,
      groupId: transfer?.target.groupId === 'bottom' ? 'bottom' : 'right',
      insertIndex: transfer?.target.index ?? 0,
      view: transfer?.view ?? false,
      tabs: ordered.map((panel) => panel.tab),
      activePanelId: active.tab.panelId,
    };
  });
}

// A local tab is foreign when the directory places it elsewhere and is not
// moving it here, or when it was an incoming copy whose source has disappeared.
function isForeignLocalPanel(
  panel: panelwindow.WorkspacePanel | undefined,
  panelId: string,
  windowName: string,
  wasIncoming: ReadonlySet<string> | undefined
): boolean {
  if (!panel) {
    return Boolean(wasIncoming?.has(panelId));
  }
  return panel.location.windowName !== windowName && !targetsWindow(panel, windowName);
}

export function usePanelWorkspaceSync(): WorkspaceSync {
  const sync = useContext(PublicationContext);
  if (!sync) {
    throw new Error('Panel publication requires WorkspacePanelSync');
  }
  return sync;
}

const openNativePanel = async (tab: panelwindow.TabSnapshot) => {
  await settlePanelClose(
    nativePanelPublication,
    panelTargetFromSnapshot(tab).clusterId,
    tab.panelId
  );
  return openPanelWorkspaceObject(getWindowIdentity(), tab);
};

// App views drain these opens before relinquishing cluster membership. Native
// panel views have a fixed cluster and use their own close handshake.
export const usePanelWorkspaceOpen = () =>
  useContext(PublicationContext)?.openPanel ?? openNativePanel;

function collectDockedPanelGroups(
  clusterIds: readonly string[],
  local: Record<string, panelwindow.TabSnapshot[]>,
  getGroups: (clusterId: string) => TabGroupState
): panelwindow.WorkspaceGroup[] {
  return clusterIds.flatMap((clusterId) => {
    const tabsById = new Map((local[clusterId] ?? []).map((tab) => [tab.panelId, tab]));
    const layout = getGroups(clusterId);
    return (['right', 'bottom'] as const).flatMap((groupId) => {
      const group = layout[groupId];
      const tabs = group.tabs.flatMap((id) => {
        const tab = tabsById.get(id);
        return tab ? [tab] : [];
      });
      if (!tabs.length) {
        return [];
      }
      const activePanelId =
        tabs.find((tab) => tab.panelId === group.activeTab)?.panelId ?? tabs[0].panelId;
      return [{ clusterId, groupId, tabs, activePanelId }];
    });
  });
}

export function WorkspacePanelSync({ children }: Readonly<{ children: ReactNode }>) {
  const windowName = getWindowIdentity();
  const {
    selectedClusterIds: visibleClusterIds,
    managedClusterIds,
    selectedClusterId,
    kubeconfigsLoading,
    getClusterMeta,
  } = useKubeconfig();
  const { selectedKubeconfigs: admittedSelections } = useClusterWorkspaceSnapshot();
  const admittedClusterIds = useMemo(
    () => new Set(admittedSelections.map((selection) => getClusterMeta(selection).id)),
    [admittedSelections, getClusterMeta]
  );
  // Tabs paint before their membership RPC settles. Native panel operations
  // require the backend to have admitted that tab, independently of connection readiness.
  const selectedClusterIds = useMemo(
    () => visibleClusterIds.filter((id) => admittedClusterIds.has(id)),
    [visibleClusterIds, admittedClusterIds]
  );
  const local = useLocalPanelSnapshots();
  const { getClusterTabGroups, tabGroups } = useDockablePanelContext();
  const restoreWorkspacePanels = useRestoreWorkspacePanels();
  const removeWorkspacePanels = useRemoveWorkspacePanels();
  const queue = useRef(workspacePanelPublication);
  useClosedPanelIntents(workspacePanelPublication, windowName);
  const lastPublication = useRef('');
  const incomingIds = useRef(new Map<string, ReadonlySet<string>>());
  const [incomingByCluster, setIncomingByCluster] = useState<
    Record<string, IncomingGroupTransfer[]>
  >({});
  const incomingTransfers = useMemo(
    () => Object.values(incomingByCluster).flat(),
    [incomingByCluster]
  );
  const activity = useMemo(() => new ClusterPanelActivity(), []);
  const closingClusters = useSyncExternalStore(activity.subscribe, activity.getSnapshot);
  const groups = useMemo(
    () =>
      collectDockedPanelGroups(managedClusterIds, local, (clusterId) =>
        clusterId === selectedClusterId ? tabGroups : getClusterTabGroups(clusterId)
      ),
    [managedClusterIds, selectedClusterId, local, getClusterTabGroups, tabGroups]
  );
  const current = useRef({ selectedClusterIds, local, groups });
  current.current = { selectedClusterIds, local, groups };
  const sync = useMemo<WorkspaceSync>(
    () => ({
      flush: () => queue.current.flush(),
      groupsForCluster: (clusterId) =>
        current.current.groups.filter((group) => group.clusterId === clusterId),
      readCluster: (clusterId) =>
        current.current.selectedClusterIds.includes(clusterId)
          ? activity.run(clusterId, () => readPanelWorkspace(windowName, clusterId))
          : Promise.resolve(null),
      openPanel: async (tab) => {
        const { clusterId } = panelTargetFromSnapshot(tab);
        if (!current.current.selectedClusterIds.includes(clusterId)) {
          return null;
        }
        const result = await activity.run(clusterId, async () => {
          await settlePanelClose(queue.current, clusterId, tab.panelId);
          return openPanelWorkspaceObject(windowName, tab);
        });
        return activity.isClosing(clusterId) ? null : result;
      },
      quiesceCluster: async (clusterId) => {
        const settle = (closed: boolean) => activity.settle(clusterId, closed);
        try {
          await Promise.all([activity.pause(clusterId), queue.current.flush()]);
          return settle;
        } catch (error) {
          settle(false);
          throw error;
        }
      },
    }),
    [activity, windowName]
  );

  useEffect(() => {
    activity.reconcile(managedClusterIds);
    // Publish only once tab membership is confirmed. Publications only arrange
    // panels, so a closing cluster view simply drops out of them.
    if (groups.some((group) => !admittedClusterIds.has(group.clusterId))) {
      return;
    }
    const publishable = groups.filter((group) => !closingClusters.has(group.clusterId));
    const serialized = JSON.stringify(publishable);
    if (serialized === lastPublication.current) {
      return;
    }
    lastPublication.current = serialized;
    queue.current.publish(
      () => publishDockedPanels(windowName, publishable),
      (error) => {
        reportOperationalError(error, {
          source: 'WorkspacePanelSync',
          action: 'publish-docked-panels',
        });
      }
    );
  }, [groups, windowName, managedClusterIds, closingClusters, activity, admittedClusterIds]);

  const removeForeignPlacements = useCallback(
    (clusterId: string, panels: panelwindow.WorkspacePanel[]) => {
      const listed = new Map(panels.map((panel) => [panel.tab.panelId, panel]));
      const wasIncoming = incomingIds.current.get(clusterId);
      const moved = (current.current.local[clusterId] ?? [])
        .map((tab) => tab.panelId)
        .filter((panelId) =>
          isForeignLocalPanel(listed.get(panelId), panelId, windowName, wasIncoming)
        );
      if (moved.length) {
        removeWorkspacePanels(clusterId, moved);
      }
    },
    [windowName, removeWorkspacePanels]
  );

  const applyIncomingTransfers = useCallback(
    (clusterId: string, panels: panelwindow.WorkspacePanel[]) => {
      const transfers = incomingGroupTransfers(clusterId, panels, windowName);
      incomingIds.current.set(
        clusterId,
        new Set(transfers.flatMap((transfer) => transfer.tabs.map((tab) => tab.panelId)))
      );
      setIncomingByCluster((byCluster) =>
        JSON.stringify(byCluster[clusterId] ?? []) === JSON.stringify(transfers)
          ? byCluster
          : { ...byCluster, [clusterId]: transfers }
      );
    },
    [windowName]
  );

  // A view that stops showing a cluster no longer receives its moves.
  useEffect(() => {
    for (const clusterId of incomingIds.current.keys()) {
      if (!selectedClusterIds.includes(clusterId)) {
        incomingIds.current.delete(clusterId);
      }
    }
    setIncomingByCluster((byCluster) =>
      Object.keys(byCluster).every((clusterId) => selectedClusterIds.includes(clusterId))
        ? byCluster
        : Object.fromEntries(
            Object.entries(byCluster).filter(([clusterId]) =>
              selectedClusterIds.includes(clusterId)
            )
          )
    );
  }, [selectedClusterIds]);

  const mountRetained = useCallback(
    (clusterId: string, claimed: panelwindow.WorkspacePanel[]) => {
      for (const edge of ['right', 'bottom'] as const) {
        const group = claimed.filter(
          (panel) => (panel.location.groupId === 'bottom' ? 'bottom' : 'right') === edge
        );
        if (!group.length) {
          continue;
        }
        const active =
          group.find((panel) => panel.location.active)?.tab.panelId ?? group[0].tab.panelId;
        restoreWorkspacePanels(
          {
            clusterId,
            tabs: group.map((panel) => panel.tab),
            activePanelId: active,
          },
          edge
        );
      }
    },
    [restoreWorkspacePanels]
  );

  const claimRetainedPanel = useCallback(
    async (clusterId: string, panel: panelwindow.WorkspacePanel) => {
      if (
        activity.isClosing(clusterId) ||
        !current.current.selectedClusterIds.includes(clusterId)
      ) {
        return null;
      }
      const result = await sync.openPanel(panel.tab);
      if (!result) {
        return null;
      }
      return result.render ? { ...result.panel, location: panel.location } : null;
    },
    [sync, activity]
  );

  const restoreRetained = useCallback(
    async (clusterId: string, panels: panelwindow.WorkspacePanel[]) => {
      if (activity.isClosing(clusterId)) {
        return;
      }
      const claimed: panelwindow.WorkspacePanel[] = [];
      try {
        for (const panel of retainedPanelOrder(panels)) {
          const claimedPanel = await claimRetainedPanel(clusterId, panel);
          if (claimedPanel) {
            claimed.push(claimedPanel);
          }
        }
      } finally {
        if (
          !activity.isClosing(clusterId) &&
          current.current.selectedClusterIds.includes(clusterId)
        ) {
          mountRetained(clusterId, claimed);
        }
      }
    },
    [mountRetained, claimRetainedPanel, activity]
  );

  useEffect(() => {
    let disposed = false;
    const revisions = new Map<string, number>();
    const refreshing = new Set<string>();
    const pending = new Set<string>();
    const isLive = (clusterId: string) =>
      !disposed &&
      !closingClusters.has(clusterId) &&
      !activity.isClosing(clusterId) &&
      current.current.selectedClusterIds.includes(clusterId);
    const shouldApply = (clusterId: string, revision: number) =>
      isLive(clusterId) && revision >= (revisions.get(clusterId) ?? 0);
    const reportRefreshError = (clusterId: string, error: unknown) => {
      if (isLive(clusterId)) {
        reportOperationalError(error, {
          source: 'WorkspacePanelSync',
          action: 'refresh-shared-panels',
          clusterId,
        });
      }
    };
    const refreshSnapshot = async (clusterId: string) => {
      try {
        const snapshot = await sync.readCluster(clusterId);
        // Every move this view mounts was listed by a read, so a newer revision
        // is the only ordering a read needs.
        if (!snapshot || !shouldApply(clusterId, snapshot.revision)) {
          return;
        }
        revisions.set(clusterId, snapshot.revision);
        const panels = snapshot.panels || [];
        removeForeignPlacements(clusterId, panels);
        applyIncomingTransfers(clusterId, panels);
        await restoreRetained(clusterId, panels);
      } catch (error) {
        reportRefreshError(clusterId, error);
      }
    };
    // Coalesce notifications received during a claim into a fresh read after it.
    // This keeps claims ordered without losing the next retained placement.
    const refresh = async (clusterId: string) => {
      if (!isLive(clusterId)) {
        return;
      }
      if (refreshing.has(clusterId)) {
        pending.add(clusterId);
        return;
      }
      refreshing.add(clusterId);
      try {
        do {
          pending.delete(clusterId);
          await refreshSnapshot(clusterId);
        } while (pending.has(clusterId) && isLive(clusterId));
      } finally {
        refreshing.delete(clusterId);
      }
    };
    const unsubscribe = onPanelWorkspaceChanged(({ clusterId }) => {
      if (current.current.selectedClusterIds.includes(clusterId)) {
        void refresh(clusterId);
      }
    });
    for (const id of selectedClusterIds) {
      void refresh(id);
    }
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [
    selectedClusterIds,
    removeForeignPlacements,
    applyIncomingTransfers,
    restoreRetained,
    sync,
    activity,
    closingClusters,
  ]);

  useEffect(() => {
    if (kubeconfigsLoading) {
      return;
    }
    void acknowledgePanelWorkspaceReady(windowName).catch((error) =>
      reportOperationalError(error, {
        source: 'WorkspacePanelSync',
        action: 'acknowledge-renderer-ready',
      })
    );
  }, [windowName, kubeconfigsLoading]);
  return (
    <PublicationContext.Provider value={sync}>
      <IncomingTransfersContext.Provider value={incomingTransfers}>
        <PanelLayoutLifecycle />
        {children}
      </IncomingTransfersContext.Provider>
    </PublicationContext.Provider>
  );
}

// A retained panel the directory is moving belongs to its transfer, not to a claim.
function retainedPanelOrder(panels: panelwindow.WorkspacePanel[]): panelwindow.WorkspacePanel[] {
  return panels
    .filter((panel) => panel.location.kind === 'retained' && !panel.transfer)
    .sort((a, b) => a.location.index - b.location.index);
}
