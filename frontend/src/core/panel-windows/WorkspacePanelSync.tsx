import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
}
const PublicationContext = createContext<WorkspaceSync | null>(null);
export function usePanelWorkspaceSync(): WorkspaceSync {
  const sync = useContext(PublicationContext);
  if (!sync) {
    throw new Error('Panel publication requires WorkspacePanelSync');
  }
  return sync;
}
export const usePanelPublication = () => usePanelWorkspaceSync().flush;

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
  const restoring = useRef(new Set<string>());
  const provisional = useRef(new Map<string, panelwindow.WorkspaceGroup[]>());
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
    }),
    []
  );

  useEffect(() => {
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
  }, [groups, windowName]);

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
      if (!current.current.selectedClusterIds.includes(clusterId)) {
        return null;
      }
      const result = await openPanelWorkspaceObject(windowName, panel.tab);
      return result.render ? { ...result.panel, location: panel.location } : null;
    },
    [windowName]
  );

  const restoreRetained = useCallback(
    async (clusterId: string, panels: panelwindow.WorkspacePanel[]) => {
      if (restoring.current.has(clusterId) || isProvisional(clusterId)) {
        return;
      }
      restoring.current.add(clusterId);
      const retained = retainedPanelOrder(panels);
      const claimed: panelwindow.WorkspacePanel[] = [];
      for (const panel of retained) {
        const claimedPanel = await claimRetainedPanel(clusterId, panel);
        if (claimedPanel) {
          claimed.push(claimedPanel);
        }
      }
      if (!current.current.selectedClusterIds.includes(clusterId)) {
        return;
      }
      mountRetained(clusterId, claimed);
    },
    [isProvisional, mountRetained, claimRetainedPanel]
  );

  useEffect(() => {
    let disposed = false;
    const revisions = new Map<string, number>();
    const shouldApply = (clusterId: string, revision: number) =>
      !disposed &&
      current.current.selectedClusterIds.includes(clusterId) &&
      revision >= (revisions.get(clusterId) ?? 0);
    const refresh = async (clusterId: string) => {
      try {
        const snapshot = await readPanelWorkspace(windowName, clusterId);
        if (!shouldApply(clusterId, snapshot.revision)) {
          return;
        }
        revisions.set(clusterId, snapshot.revision);
        const panels = snapshot.panels || [];
        removeForeignPlacements(clusterId, panels);
        await restoreRetained(clusterId, panels);
      } catch (error) {
        if (!disposed) {
          reportOperationalError(error, {
            source: 'WorkspacePanelSync',
            action: 'refresh-shared-panels',
            clusterId,
          });
        }
      }
    };
    const unsubscribe = onPanelWorkspaceChanged(({ clusterId }) => {
      if (current.current.selectedClusterIds.includes(clusterId)) {
        void refresh(clusterId);
      }
    });
    for (const id of restoring.current) {
      if (!selectedClusterIds.includes(id)) {
        restoring.current.delete(id);
      }
    }
    for (const id of selectedClusterIds) {
      void refresh(id);
    }
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [windowName, selectedClusterIds, removeForeignPlacements, restoreRetained]);

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
