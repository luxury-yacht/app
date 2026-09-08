import { useCallback, useEffect } from 'react';
import { focusWindow, getWindowIdentity } from '@/core/desktop-runtime';
import { useKubeconfig } from '@/modules/kubernetes/config/KubeconfigContext';
import { useObjectPanelState } from '@/modules/object-panel/contexts/ObjectPanelStateContext';
import { useDockablePanelContext } from '@/ui/dockable';
import { reportOperationalError } from '@/utils/errorHandler';
import {
  acknowledgeWorkspaceWindowClose,
  closeClusterView,
  onWorkspaceCloseRequested,
} from './index';
import { preparePanelClose, usePanelLifecycleGuardRegistry } from './panelLifecycleGuards';
import { useApplicationQuitPreflight } from './useApplicationQuitPreflight';
import { usePanelPublication } from './WorkspacePanelSync';

export function WorkspacePanelLifecycle() {
  const windowName = getWindowIdentity();
  const { selectedClusterIds, registerClusterClosePreflight } = useKubeconfig();
  const { panelIdsForCluster, getOwnedPanel } = useObjectPanelState();
  const { focusPanel } = useDockablePanelContext();
  const guards = usePanelLifecycleGuardRegistry();
  const flush = usePanelPublication();
  const preflight = useCallback(
    (clusterIds: readonly string[], transactionId: string, status: string) => {
      const panelIds = clusterIds.flatMap((id) =>
        panelIdsForCluster(id).filter((panelId) => !getOwnedPanel(id, panelId)?.nativeLocation)
      );
      return preparePanelClose({
        guards,
        transactionId,
        panelIds,
        status,
        flush,
        focusBlocker: (blocker) => {
          if (blocker.panelId) {
            focusPanel(blocker.panelId);
          }
          blocker.focus();
          void focusWindow(windowName).catch((error) =>
            reportOperationalError(error, {
              source: 'WorkspacePanelLifecycle',
              action: 'focus-close-blocker',
            })
          );
        },
      });
    },
    [panelIdsForCluster, getOwnedPanel, guards, focusPanel, windowName, flush]
  );

  const closeCluster = useCallback(
    async (clusterId: string) => {
      const transactionId = `cluster-close-${globalThis.crypto.randomUUID()}`;
      try {
        if (!(await preflight([clusterId], transactionId, 'Closing cluster…'))) {
          return false;
        }
        return await closeClusterView(windowName, clusterId);
      } finally {
        guards.releaseTransfer(transactionId);
      }
    },
    [preflight, guards, windowName]
  );
  useEffect(
    () => registerClusterClosePreflight(closeCluster),
    [registerClusterClosePreflight, closeCluster]
  );
  useEffect(
    () =>
      onWorkspaceCloseRequested((event) => {
        if (event.windowName !== windowName) {
          return;
        }
        const transactionId = `window-close-${globalThis.crypto.randomUUID()}`;
        void preflight(selectedClusterIds, transactionId, 'Closing window…')
          .then((allowed) => (allowed ? acknowledgeWorkspaceWindowClose(windowName) : undefined))
          .catch((error) =>
            reportOperationalError(error, {
              source: 'WorkspacePanelLifecycle',
              action: 'close-app-view',
            })
          )
          .finally(() => guards.releaseTransfer(transactionId));
      }),
    [windowName, selectedClusterIds, preflight, guards]
  );
  const prepareQuit = useCallback(
    (transactionId: string, status: string) => preflight(selectedClusterIds, transactionId, status),
    [selectedClusterIds, preflight]
  );
  useApplicationQuitPreflight(windowName, prepareQuit);
  return null;
}
