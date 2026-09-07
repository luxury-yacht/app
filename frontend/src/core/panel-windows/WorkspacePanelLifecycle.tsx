import { useCallback, useEffect } from 'react';
import { focusWindow, getWindowIdentity } from '@/core/desktop-runtime';
import { useKubeconfig } from '@/modules/kubernetes/config/KubeconfigContext';
import { useObjectPanelState } from '@/modules/object-panel/contexts/ObjectPanelStateContext';
import { useDockablePanelContext } from '@/ui/dockable';
import { reportOperationalError } from '@/utils/errorHandler';
import {
  acknowledgeApplicationQuitPreflight,
  acknowledgeWorkspaceWindowClose,
  onApplicationQuitPreflightRequested,
  onWorkspaceCloseRequested,
} from './index';
import { usePanelLifecycleGuardRegistry } from './panelLifecycleGuards';
import { usePanelPublication } from './WorkspacePanelSync';

export function WorkspacePanelLifecycle() {
  const windowName = getWindowIdentity();
  const { selectedClusterIds, registerClusterClosePreflight } = useKubeconfig();
  const { panelIdsForCluster, getOwnedPanel } = useObjectPanelState();
  const { focusPanel } = useDockablePanelContext();
  const guards = usePanelLifecycleGuardRegistry();
  const flush = usePanelPublication();
  const preflight = useCallback(
    async (clusterIds: readonly string[]) => {
      if (guards.isFrozen()) {
        return false;
      }
      const panelIds = clusterIds.flatMap((id) =>
        panelIdsForCluster(id).filter((panelId) => !getOwnedPanel(id, panelId)?.nativeLocation)
      );
      const blocker = guards.firstBlocker(panelIds);
      if (blocker) {
        if (blocker.panelId) {
          focusPanel(blocker.panelId);
        }
        blocker.focus();
        await focusWindow(windowName);
        return false;
      }
      await flush();
      return true;
    },
    [panelIdsForCluster, getOwnedPanel, guards, focusPanel, windowName, flush]
  );

  useEffect(
    () => registerClusterClosePreflight((clusterId) => preflight([clusterId])),
    [registerClusterClosePreflight, preflight]
  );
  useEffect(
    () =>
      onWorkspaceCloseRequested((event) => {
        if (event.windowName !== windowName) {
          return;
        }
        void preflight(selectedClusterIds)
          .then((allowed) => (allowed ? acknowledgeWorkspaceWindowClose(windowName) : undefined))
          .catch((error) =>
            reportOperationalError(error, {
              source: 'WorkspacePanelLifecycle',
              action: 'close-app-view',
            })
          );
      }),
    [windowName, selectedClusterIds, preflight]
  );
  useEffect(
    () =>
      onApplicationQuitPreflightRequested((event) => {
        if (event.windowName !== windowName) {
          return;
        }
        void preflight(selectedClusterIds)
          .catch((error) => {
            reportOperationalError(error, {
              source: 'WorkspacePanelLifecycle',
              action: 'quit-preflight',
            });
            return false;
          })
          .then((allowed) =>
            acknowledgeApplicationQuitPreflight(windowName, event.transactionId, allowed)
          )
          .catch((error) =>
            reportOperationalError(error, {
              source: 'WorkspacePanelLifecycle',
              action: 'acknowledge-quit',
            })
          );
      }),
    [windowName, selectedClusterIds, preflight]
  );
  return null;
}
