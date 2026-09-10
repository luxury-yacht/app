import { getWindowIdentity } from '@/core/desktop-runtime';
import { useKubeconfig } from '@/modules/kubernetes/config/KubeconfigContext';
import ContextMenu, { type ContextMenuItem } from '@/shared/components/ContextMenu';
import { FloatPanelIcon } from '@/shared/components/icons/DockableIcons';
import { CloseIcon, OpenIcon } from '@/shared/components/icons/SharedIcons';
import { reportOperationalError } from '@/utils/errorHandler';
import { canMoveClusterToNewWindow } from './clusterTabTransferPolicy';
import { openClusterWindow, requestClusterTabTransfer } from './index';
import { PanelLifecycleClusterSurface } from './panelLifecycleGuards';

export function ClusterPanelsMenu({
  clusterId,
  position,
  onClose,
  onCloseCluster,
  orderActions = [],
}: Readonly<{
  clusterId: string;
  position: { x: number; y: number };
  onClose: () => void;
  onCloseCluster: () => void;
  orderActions?: ContextMenuItem[];
}>) {
  const windowName = getWindowIdentity();
  const { selectedClusterIds } = useKubeconfig();
  const items: ContextMenuItem[] = [
    ...orderActions,
    ...(orderActions.length ? [{ divider: true }] : []),
    {
      label: 'Open in new window',
      icon: <FloatPanelIcon width={16} height={16} />,
      disabled: !selectedClusterIds.includes(clusterId),
      onClick: () => {
        void openClusterWindow(windowName, clusterId).catch((error) =>
          reportOperationalError(error, {
            source: 'ClusterPanelsMenu',
            action: 'open-cluster-window',
            clusterId,
          })
        );
      },
    },
    {
      label: 'Move to new window',
      icon: <OpenIcon width={16} height={16} />,
      disabled: !canMoveClusterToNewWindow(clusterId, selectedClusterIds),
      onClick: () => {
        void requestClusterTabTransfer(windowName, {
          transferId: globalThis.crypto.randomUUID(),
          sourceWindowName: windowName,
          targetWindowName: '',
          clusterId,
          targetIndex: 0,
        }).catch((error) =>
          reportOperationalError(error, {
            source: 'ClusterPanelsMenu',
            action: 'move-cluster-window',
            clusterId,
          })
        );
      },
    },
    { divider: true },
    { label: 'Close', icon: <CloseIcon width={16} height={16} />, onClick: onCloseCluster },
  ];
  return (
    <PanelLifecycleClusterSurface clusterId={clusterId}>
      <ContextMenu items={items} position={position} onClose={onClose} />
    </PanelLifecycleClusterSurface>
  );
}
