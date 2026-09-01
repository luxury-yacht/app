import type { panelwindow } from '@/core/backend-api/models';
import type { ViewType } from '@/modules/object-panel/components/ObjectPanel/types';

export type DockEdge = 'right' | 'bottom';

export type OwnedPanelLocation =
  | { kind: 'docked'; edge: DockEdge }
  | {
      kind: 'pending-window';
      edge: DockEdge;
      transferId: string;
      groupId: string;
    }
  | { kind: 'panel-window'; windowName: string; groupId: string };

export interface OwnedObjectPanel {
  panelId: string;
  objectRef: panelwindow.ObjectReference;
  activeView: ViewType;
  location: OwnedPanelLocation;
}

export interface OwnedClusterPanels {
  panels: Map<string, OwnedObjectPanel>;
}

export type OwnedPanelDirectory = Map<string, OwnedClusterPanels>;

interface AddDockedObjectPanel {
  panelId: string;
  objectRef: panelwindow.ObjectReference;
  activeView: ViewType;
  edge: DockEdge;
}

interface CommitNativePanelOpen {
  transferId: string;
  windowName: string;
  clusterId: string;
  groupId: string;
}

export const createOwnedPanelDirectory = (): OwnedPanelDirectory => new Map();

const updateCluster = (
  directory: OwnedPanelDirectory,
  clusterId: string,
  update: (panels: Map<string, OwnedObjectPanel>) => Map<string, OwnedObjectPanel>
): OwnedPanelDirectory => {
  const next = new Map(directory);
  const current = directory.get(clusterId)?.panels ?? new Map<string, OwnedObjectPanel>();
  next.set(clusterId, { panels: update(new Map(current)) });
  return next;
};

export const addDockedObjectPanel = (
  directory: OwnedPanelDirectory,
  panel: AddDockedObjectPanel
): OwnedPanelDirectory => {
  if (
    !panel.objectRef.clusterId ||
    panel.objectRef.clusterId !== panel.objectRef.clusterId.trim()
  ) {
    throw new Error('Owned object panel requires a cluster identity');
  }
  return updateCluster(directory, panel.objectRef.clusterId, (panels) => {
    if (panels.has(panel.panelId)) {
      throw new Error(`Panel ${panel.panelId} is already owned in this workspace`);
    }
    panels.set(panel.panelId, {
      panelId: panel.panelId,
      objectRef: { ...panel.objectRef },
      activeView: panel.activeView,
      location: { kind: 'docked', edge: panel.edge },
    });
    return panels;
  });
};

export const beginNativePanelOpen = (
  directory: OwnedPanelDirectory,
  snapshot: panelwindow.GroupSnapshot
): OwnedPanelDirectory =>
  updateCluster(directory, snapshot.clusterId, (panels) => {
    for (const tab of snapshot.tabs ?? []) {
      const panel = panels.get(tab.panelId);
      if (!panel || panel.objectRef.clusterId !== snapshot.clusterId) {
        throw new Error(`Panel ${tab.panelId} is not docked in cluster ${snapshot.clusterId}`);
      }
      if (panel.location.kind !== 'docked') {
        throw new Error(`Panel ${tab.panelId} is already moving or native`);
      }
      panels.set(tab.panelId, {
        ...panel,
        activeView: tab.activeView as ViewType,
        location: {
          kind: 'pending-window',
          edge: panel.location.edge,
          transferId: snapshot.transferId,
          groupId: snapshot.groupId,
        },
      });
    }
    return panels;
  });

export const commitNativePanelOpen = (
  directory: OwnedPanelDirectory,
  commit: CommitNativePanelOpen
): OwnedPanelDirectory =>
  updateCluster(directory, commit.clusterId, (panels) => {
    let committed = false;
    for (const [panelId, panel] of panels) {
      if (
        panel.location.kind !== 'pending-window' ||
        panel.location.transferId !== commit.transferId ||
        panel.location.groupId !== commit.groupId
      ) {
        continue;
      }
      committed = true;
      panels.set(panelId, {
        ...panel,
        location: {
          kind: 'panel-window',
          windowName: commit.windowName,
          groupId: commit.groupId,
        },
      });
    }
    if (!committed) {
      throw new Error(`Panel transfer ${commit.transferId} is stale`);
    }
    return panels;
  });

export const rollbackNativePanelOpen = (
  directory: OwnedPanelDirectory,
  clusterId: string,
  transferId: string
): OwnedPanelDirectory =>
  updateCluster(directory, clusterId, (panels) => {
    for (const [panelId, panel] of panels) {
      if (panel.location.kind !== 'pending-window' || panel.location.transferId !== transferId) {
        continue;
      }
      panels.set(panelId, {
        ...panel,
        location: { kind: 'docked', edge: panel.location.edge },
      });
    }
    return panels;
  });
