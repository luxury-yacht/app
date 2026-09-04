import { useCallback, useEffect, useRef } from 'react';
import { focusWindow, onEvent, openDevTools } from '@/core/desktop-runtime';
import type { PanelWindowDescriptor } from '@/core/panel-windows';
import {
  acknowledgePanelWindowClose,
  acknowledgePanelWindowGuard,
  failPanelTabTransfer,
  onPanelTabCloseAuthorized,
  onPanelTabTransferCommitted,
  onPanelTabTransferFailed,
  onPanelTabTransferInsertRequested,
  onPanelWindowCloseRequested,
  onPanelWindowFocusRequested,
  onPanelWindowGuardRequested,
  requestPanelTabClose,
  updatePanelWindowSnapshot,
} from '@/core/panel-windows';
import type { PanelLifecycleBlocker } from '@/core/panel-windows/panelLifecycleGuards';
import { usePanelLifecycleGuardRegistry } from '@/core/panel-windows/panelLifecycleGuards';
import type { ViewType } from '@/modules/object-panel/components/ObjectPanel/types';
import {
  useObjectPanelActiveTabs,
  useObjectPanelState,
} from '@/modules/object-panel/contexts/ObjectPanelStateContext';
import type { KubernetesObjectReference } from '@/types/view-state';
import { useDockablePanelContext } from '@/ui/dockable';
import { getGroupTabs } from '@/ui/dockable/tabGroupState';
import { reportOperationalError } from '@/utils/errorHandler';

export function PanelWindowShortcuts({
  descriptor,
  ready,
}: Readonly<{ descriptor: PanelWindowDescriptor; ready: boolean }>) {
  const { openPanels, upsertOwnedPanel } = useObjectPanelState();
  const activeTabs = useObjectPanelActiveTabs();
  const { tabGroups, focusPanel, commitTabClose, movePanelBetweenGroups } =
    useDockablePanelContext();
  const guards = usePanelLifecycleGuardRegistry();
  const snapshotUpdateQueueRef = useRef<Promise<void>>(Promise.resolve());
  const insertedTabTransfersRef = useRef(new Map<string, string>());
  const focusLifecycleBlocker = useCallback(
    (blocker: PanelLifecycleBlocker) => {
      if (blocker.panelId) {
        focusPanel(blocker.panelId);
      }
      blocker.focus();
      void focusWindow(descriptor.windowName).catch((error) =>
        reportOperationalError(error, {
          source: 'PanelWindowShortcuts',
          action: 'focus-lifecycle-blocker',
        })
      );
    },
    [descriptor.windowName, focusPanel]
  );

  useEffect(() => {
    if (!ready) {
      return;
    }
    const closeActiveTab = async () => {
      const group = getGroupTabs(tabGroups, 'right') ?? getGroupTabs(tabGroups, 'bottom');
      const activePanelId = group?.activeTab ?? descriptor.snapshot.activePanelId;
      const tabs = group?.tabs ?? descriptor.snapshot.tabs?.map((tab) => tab.panelId) ?? [];
      const blocker = guards.firstBlocker(activePanelId ? [activePanelId] : tabs);
      if (blocker) {
        focusLifecycleBlocker(blocker);
        return;
      }
      if (activePanelId) {
        await requestPanelTabClose(descriptor.windowName, activePanelId);
      }
    };
    return onEvent('menu:close', () => {
      void closeActiveTab().catch((error) =>
        reportOperationalError(error, {
          source: 'PanelWindowShortcuts',
          action: 'close-active-tab',
        })
      );
    });
  }, [descriptor, focusLifecycleBlocker, guards, ready, tabGroups]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    return onEvent('debug:open-inspector', () => {
      void openDevTools().catch((error) =>
        reportOperationalError(error, {
          source: 'PanelWindowShortcuts',
          action: 'open-inspector',
        })
      );
    });
  }, [ready]);

  useEffect(
    () =>
      onPanelTabCloseAuthorized(({ panelId }) => {
        const group = getGroupTabs(tabGroups, 'right') ?? getGroupTabs(tabGroups, 'bottom');
        const tabs = group?.tabs ?? [];
        if (tabs.length <= 1) {
          void acknowledgePanelWindowClose(descriptor.windowName).catch((error) =>
            reportOperationalError(error, {
              source: 'PanelWindowShortcuts',
              action: 'close-last-authorized-tab',
            })
          );
          return;
        }
        commitTabClose(panelId);
      }),
    [commitTabClose, descriptor, tabGroups]
  );

  useEffect(
    () =>
      onPanelTabTransferInsertRequested(({ request }) => {
        if (
          request.targetWindowName !== descriptor.windowName ||
          request.ownerWindowName !== descriptor.ownerWindowName ||
          request.clusterId !== descriptor.clusterId ||
          request.targetGroupId !== descriptor.groupId ||
          openPanels.has(request.tab.panelId)
        ) {
          void failPanelTabTransfer(descriptor.windowName, request.transferId);
          return;
        }
        const panelId = upsertOwnedPanel(
          { ...request.tab.objectRef } as KubernetesObjectReference,
          request.tab.activeView as ViewType,
          {
            kind: 'panel-window',
            windowName: descriptor.windowName,
            groupId: descriptor.groupId,
          }
        );
        if (panelId !== request.tab.panelId) {
          void failPanelTabTransfer(descriptor.windowName, request.transferId);
          return;
        }
        insertedTabTransfersRef.current.set(request.transferId, panelId);
        movePanelBetweenGroups(panelId, 'right', request.targetIndex);
      }),
    [descriptor, movePanelBetweenGroups, openPanels, upsertOwnedPanel]
  );

  useEffect(
    () =>
      onPanelTabTransferCommitted(({ request }) => {
        insertedTabTransfersRef.current.delete(request.transferId);
        if (request.sourceWindowName !== descriptor.windowName) {
          return;
        }
        const group = getGroupTabs(tabGroups, 'right') ?? getGroupTabs(tabGroups, 'bottom');
        if (!group?.tabs.includes(request.tab.panelId)) {
          return;
        }
        if (group.tabs.length <= 1) {
          void acknowledgePanelWindowClose(descriptor.windowName).catch((error) =>
            reportOperationalError(error, {
              source: 'PanelWindowShortcuts',
              action: 'close-empty-tab-transfer-source',
            })
          );
          return;
        }
        commitTabClose(request.tab.panelId);
      }),
    [commitTabClose, descriptor, tabGroups]
  );

  useEffect(
    () =>
      onPanelTabTransferFailed(({ request }) => {
        const insertedPanelId = insertedTabTransfersRef.current.get(request.transferId);
        if (request.targetWindowName !== descriptor.windowName || !insertedPanelId) {
          return;
        }
        insertedTabTransfersRef.current.delete(request.transferId);
        commitTabClose(insertedPanelId);
      }),
    [commitTabClose, descriptor.windowName]
  );

  useEffect(() => {
    if (!ready) {
      return;
    }
    const group = getGroupTabs(tabGroups, 'right') ?? getGroupTabs(tabGroups, 'bottom');
    if (!group || group.tabs.length === 0) {
      return;
    }
    const snapshot: import('@/core/backend-api/models').panelwindow.GroupSnapshot = {
      schemaVersion: 1,
      transferId: descriptor.snapshot.transferId,
      ownerWindowName: descriptor.ownerWindowName,
      clusterId: descriptor.clusterId,
      groupId: descriptor.groupId,
      tabs: group.tabs.flatMap((panelId) => {
        const objectRef = openPanels.get(panelId);
        return objectRef
          ? [
              {
                kind: 'object' as import('@/core/backend-api/models').panelwindow.TabKind,
                panelId,
                objectRef: {
                  clusterId: objectRef.clusterId,
                  group: objectRef.group,
                  version: objectRef.version,
                  kind: objectRef.kind,
                  namespace: objectRef.namespace ?? '',
                  name: objectRef.name,
                },
                activeView: activeTabs.get(panelId) ?? 'details',
              },
            ]
          : [];
      }),
      activePanelId: group.activeTab ?? group.tabs[0],
    };
    snapshotUpdateQueueRef.current = snapshotUpdateQueueRef.current
      .then(() => updatePanelWindowSnapshot(descriptor.windowName, snapshot))
      .catch((error) => {
        reportOperationalError(error, {
          source: 'PanelWindowShortcuts',
          action: 'sync-panel-window-snapshot',
        });
      });
  }, [activeTabs, descriptor, openPanels, ready, tabGroups]);

  useEffect(
    () =>
      onPanelWindowCloseRequested(() => {
        const group = getGroupTabs(tabGroups, 'right') ?? getGroupTabs(tabGroups, 'bottom');
        const tabs = group?.tabs ?? descriptor.snapshot.tabs?.map((tab) => tab.panelId) ?? [];
        const blocker = guards.firstBlocker(tabs);
        if (blocker) {
          focusLifecycleBlocker(blocker);
          return;
        }
        void acknowledgePanelWindowClose(descriptor.windowName).catch((error) =>
          reportOperationalError(error, { source: 'PanelWindowShortcuts', action: 'close-window' })
        );
      }),
    [descriptor, focusLifecycleBlocker, guards, tabGroups]
  );

  useEffect(() => onPanelWindowFocusRequested(({ panelId }) => focusPanel(panelId)), [focusPanel]);

  useEffect(
    () =>
      onPanelWindowGuardRequested(({ requestId, windowName }) => {
        if (windowName !== descriptor.windowName) {
          return;
        }
        const group = getGroupTabs(tabGroups, 'right') ?? getGroupTabs(tabGroups, 'bottom');
        const tabs = group?.tabs ?? descriptor.snapshot.tabs?.map((tab) => tab.panelId) ?? [];
        const blocker = guards.firstBlocker(tabs);
        if (blocker) {
          focusLifecycleBlocker(blocker);
        }
        void acknowledgePanelWindowGuard(descriptor.windowName, requestId, blocker === null).catch(
          (error) =>
            reportOperationalError(error, {
              source: 'PanelWindowShortcuts',
              action: 'acknowledge-window-guard',
            })
        );
      }),
    [descriptor, focusLifecycleBlocker, guards, tabGroups]
  );

  return null;
}
