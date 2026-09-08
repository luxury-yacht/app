import { useEffect, useState } from 'react';
import { readPanelWorkspace } from '@/core/app-state-access';
import type { panelwindow } from '@/core/backend-api/models';
import { getWindowIdentity } from '@/core/desktop-runtime';
import { useKubeconfig } from '@/modules/kubernetes/config/KubeconfigContext';
import { useObjectPanel } from '@/modules/object-panel/hooks/useObjectPanel';
import ContextMenu, { type ContextMenuItem } from '@/shared/components/ContextMenu';
import { reportOperationalError } from '@/utils/errorHandler';
import { canMoveClusterToNewWindow } from './clusterTabTransferPolicy';
import {
  onPanelWorkspaceChanged,
  requestClusterTabTransfer,
  requestPanelTabTransfer,
} from './index';

type MenuState =
  | { phase: 'loading' }
  | { phase: 'error' }
  | { phase: 'ready'; panels: panelwindow.WorkspacePanel[] };
const locationLabel = (location: panelwindow.PanelLocation, windowName: string) => {
  if (location.kind === 'retained') {
    return 'saved panel';
  }
  if (location.windowName === windowName) {
    return 'this window';
  }
  return location.windowName
    .replace(/^workspace-/, 'app window ')
    .replace(/^panel-/, 'panel window ');
};

export function ClusterPanelsMenu({
  clusterId,
  clusterName,
  position,
  onClose,
}: Readonly<{
  clusterId: string;
  clusterName: string;
  position: { x: number; y: number };
  onClose: () => void;
}>) {
  const windowName = getWindowIdentity();
  const { selectedClusterIds } = useKubeconfig();
  const { openWithObject } = useObjectPanel();
  const [state, setState] = useState<MenuState>({ phase: 'loading' });
  const report = (error: unknown) =>
    reportOperationalError(error, {
      source: 'ClusterPanelsMenu',
      action: 'access-cluster-panels',
      clusterId,
    });
  useEffect(() => {
    let disposed = false;
    let revision = 0;
    const read = async () => {
      try {
        const snapshot = await readPanelWorkspace(windowName, clusterId);
        if (disposed || snapshot.revision < revision) {
          return;
        }
        revision = snapshot.revision;
        setState({ phase: 'ready', panels: snapshot.panels ?? [] });
      } catch (error) {
        if (disposed) {
          return;
        }
        setState({ phase: 'error' });
        reportOperationalError(error, {
          source: 'ClusterPanelsMenu',
          action: 'read-cluster-panels',
          clusterId,
        });
      }
    };
    const cancel = onPanelWorkspaceChanged((event) => {
      if (event.clusterId === clusterId) {
        void read();
      }
    });
    void read();
    return () => {
      disposed = true;
      cancel();
    };
  }, [windowName, clusterId]);
  const items: ContextMenuItem[] = [
    { label: clusterName, header: true },
    {
      label: 'Move cluster to new window',
      disabled: !canMoveClusterToNewWindow(clusterId, selectedClusterIds),
      onClick: () => {
        void requestClusterTabTransfer(windowName, {
          transferId: globalThis.crypto.randomUUID(),
          sourceWindowName: windowName,
          targetWindowName: '',
          clusterId,
          targetIndex: 0,
        }).catch(report);
      },
    },
    { divider: true },
  ];
  const statusLabel = panelMenuStatusLabel(state);
  if (state.phase !== 'ready') {
    return (
      <ContextMenu
        items={[...items, { label: statusLabel, disabled: true }]}
        position={position}
        onClose={onClose}
      />
    );
  }
  if (!state.panels.length) {
    items.push({ label: 'No open panels', disabled: true });
  }
  for (const panel of state.panels) {
    const ref = panel.tab.objectRef;
    const objectName = ref.namespace ? `${ref.namespace}/${ref.name}` : ref.name;
    items.push(
      { label: `${ref.kind} ${objectName}`, header: true },
      {
        label: `Show · ${locationLabel(panel.location, windowName)}`,
        onClick: () => openWithObject({ ...ref, group: ref.group, version: ref.version }),
      }
    );
    if (panel.location.windowName && panel.location.windowName !== windowName) {
      items.push({
        label: 'Move here',
        onClick: () => {
          void requestPanelTabTransfer(windowName, {
            transferId: globalThis.crypto.randomUUID(),
            sourceWindowName: panel.location.windowName,
            targetWindowName: windowName,
            clusterId,
            sourceGroupId: panel.location.groupId,
            targetGroupId: 'right',
            targetIndex: 0,
            targetKind: 'workspace' as panelwindow.TabTransferTarget,
            cursorX: 0,
            cursorY: 0,
            tab: panel.tab,
          }).catch(report);
        },
      });
    }
  }
  return <ContextMenu items={items} position={position} onClose={onClose} />;
}

function panelMenuStatusLabel(state: MenuState): string {
  return state.phase === 'loading' ? 'Loading panels…' : 'Unable to load panels';
}
