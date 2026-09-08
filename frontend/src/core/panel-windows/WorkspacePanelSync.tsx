import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from 'react';
import { readPanelWorkspace } from '@/core/app-state-access';
import type { panelwindow } from '@/core/backend-api/models';
import { getWindowIdentity } from '@/core/desktop-runtime';
import { useKubeconfig } from '@/modules/kubernetes/config/KubeconfigContext';
import type { ViewType } from '@/modules/object-panel/components/ObjectPanel/types';
import {
  useLocalPanelSnapshots,
  useObjectPanelState,
} from '@/modules/object-panel/contexts/ObjectPanelStateContext';
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
import { workspacePanelPublication } from './publicationQueue';

interface WorkspaceSync {
  flush: () => Promise<void>;
  stage: (id: string, groups: panelwindow.WorkspaceGroup[]) => void;
  settle: (id: string) => void;
  groupsForCluster: (clusterId: string) => panelwindow.WorkspaceGroup[];
  readCluster: (clusterId: string) => Promise<panelwindow.WorkspaceSnapshot | null>;
  quiesceCluster: (clusterId: string) => Promise<(closed: boolean) => void>;
  openPanel: (
    tab: panelwindow.TabSnapshot
  ) => Promise<Awaited<ReturnType<typeof openPanelWorkspaceObject>> | null>;
}
const PublicationContext = createContext<WorkspaceSync | null>(null);
export function usePanelWorkspaceSync(): WorkspaceSync {
  const sync = useContext(PublicationContext);
  if (!sync) {
    throw new Error('Panel publication requires WorkspacePanelSync');
  }
  return sync;
}

const openNativePanel = (tab: panelwindow.TabSnapshot) =>
  openPanelWorkspaceObject(getWindowIdentity(), tab);

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
  const { selectedClusterIds, selectedClusterId, kubeconfigsLoading } = useKubeconfig();
  const local = useLocalPanelSnapshots();
  const { getClusterTabGroups, tabGroups, dockPanelGroup, detachPanelGroup, discardPanelLayouts } =
    useDockablePanelContext();
  const { upsertOwnedPanel, removeOwnedPanel } = useObjectPanelState();
  const queue = useRef(workspacePanelPublication);
  const lastPublication = useRef('');
  const provisional = useRef(new Map<string, panelwindow.WorkspaceGroup[]>());
  const activity = useMemo(() => new ClusterPanelActivity(), []);
  const closingClusters = useSyncExternalStore(activity.subscribe, activity.getSnapshot);
  const groups = useMemo(
    () =>
      collectDockedPanelGroups(selectedClusterIds, local, (clusterId) =>
        clusterId === selectedClusterId ? tabGroups : getClusterTabGroups(clusterId)
      ),
    [selectedClusterIds, selectedClusterId, local, getClusterTabGroups, tabGroups]
  );
  const current = useRef({ selectedClusterIds, local, groups });
  current.current = { selectedClusterIds, local, groups };
  const isProvisional = useCallback(
    (clusterId: string, panelId?: string) =>
      Array.from(provisional.current.values()).some((pending) =>
        pending.some(
          (group) =>
            group.clusterId === clusterId &&
            (!panelId || (group.tabs ?? []).some((tab) => tab.panelId === panelId))
        )
      ),
    []
  );
  const sync = useMemo<WorkspaceSync>(
    () => ({
      flush: () => queue.current.flush(),
      stage: (id, pending) => {
        provisional.current.set(id, pending);
      },
      settle: (id) => {
        provisional.current.delete(id);
      },
      groupsForCluster: (clusterId) =>
        current.current.groups.filter((group) => group.clusterId === clusterId),
      readCluster: async (clusterId) =>
        current.current.selectedClusterIds.includes(clusterId)
          ? activity.run(clusterId, () => readPanelWorkspace(windowName, clusterId))
          : null,
      openPanel: async (tab) => {
        if (!current.current.selectedClusterIds.includes(tab.objectRef.clusterId)) {
          return null;
        }
        const result = await activity.run(tab.objectRef.clusterId, () =>
          openPanelWorkspaceObject(windowName, tab)
        );
        return activity.isClosing(tab.objectRef.clusterId) ? null : result;
      },
      quiesceCluster: async (clusterId) => {
        const settle = (closed: boolean) => {
          lastPublication.current = '';
          activity.settle(clusterId, closed);
        };
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
    activity.reconcile(selectedClusterIds);
    // Publications replace every docked group in this renderer. Resume only
    // when each accepted close is reflected in the rendered cluster selection.
    if (
      Array.from(closingClusters).some(([id, closed]) => !closed || selectedClusterIds.includes(id))
    ) {
      return;
    }
    const serialized = JSON.stringify(groups);
    if (serialized === lastPublication.current) {
      return;
    }
    lastPublication.current = serialized;
    queue.current.publish(
      () => publishDockedPanels(windowName, groups),
      (error) => {
        reportOperationalError(error, {
          source: 'WorkspacePanelSync',
          action: 'publish-docked-panels',
        });
      }
    );
  }, [groups, windowName, selectedClusterIds, closingClusters, activity]);

  const removeForeignPlacements = useCallback(
    (clusterId: string, panels: panelwindow.WorkspacePanel[]) => {
      const localIds = new Set((current.current.local[clusterId] ?? []).map((tab) => tab.panelId));
      const moved = panels.filter(
        (panel) =>
          localIds.has(panel.tab.panelId) &&
          panel.location.windowName !== windowName &&
          !isProvisional(clusterId, panel.tab.panelId)
      );
      if (!moved.length) {
        return;
      }
      const ids = moved.map((panel) => panel.tab.panelId);
      detachPanelGroup(clusterId, ids);
      discardPanelLayouts(clusterId, ids);
      for (const id of ids) {
        removeOwnedPanel(clusterId, id);
      }
    },
    [windowName, isProvisional, detachPanelGroup, discardPanelLayouts, removeOwnedPanel]
  );

  const mountRetained = useCallback(
    (clusterId: string, claimed: panelwindow.WorkspacePanel[]) => {
      for (const edge of ['right', 'bottom'] as const) {
        const group = claimed.filter(
          (panel) => (panel.location.groupId === 'bottom' ? 'bottom' : 'right') === edge
        );
        if (!group.length) {
          continue;
        }
        for (const panel of group) {
          upsertOwnedPanel({ ...panel.tab.objectRef }, panel.tab.activeView as ViewType, {
            kind: 'docked',
            edge,
          });
        }
        const active =
          group.find((panel) => panel.location.active)?.tab.panelId ?? group[0].tab.panelId;
        dockPanelGroup(
          clusterId,
          group.map((panel) => panel.tab.panelId),
          active,
          edge
        );
      }
    },
    [upsertOwnedPanel, dockPanelGroup]
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
      if (activity.isClosing(clusterId) || isProvisional(clusterId)) {
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
    [isProvisional, mountRetained, claimRetainedPanel, activity]
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
        if (!snapshot || !shouldApply(clusterId, snapshot.revision)) {
          return;
        }
        revisions.set(clusterId, snapshot.revision);
        const panels = snapshot.panels || [];
        removeForeignPlacements(clusterId, panels);
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
  return <PublicationContext.Provider value={sync}>{children}</PublicationContext.Provider>;
}

function retainedPanelOrder(panels: panelwindow.WorkspacePanel[]): panelwindow.WorkspacePanel[] {
  return panels
    .filter((panel) => panel.location.kind === 'retained')
    .sort((a, b) => a.location.index - b.location.index);
}
