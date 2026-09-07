import { useCallback, useEffect, useRef } from 'react';
import type { backend } from '@/core/backend-api/models';
import { useZoom } from '@/core/contexts/ZoomContext';
import {
  focusWindow,
  maximiseWindow,
  minimiseWindow,
  onEvent,
  openDevTools,
  restoreWindow,
  toggleMaximise,
} from '@/core/desktop-runtime';
import type { PanelWindowDescriptor } from '@/core/panel-windows';
import {
  acceptPanelTabTransfer,
  acknowledgeApplicationQuitPreflight,
  acknowledgeClusterPanelClose,
  acknowledgePanelWindowClose,
  beginPanelWindowOpen,
  failPanelTabTransfer,
  onApplicationQuitPreflightRequested,
  onClusterPanelCloseRequested,
  onClusterPanelCloseSettled,
  onPanelTabCloseAuthorized,
  onPanelTabTransferCommitted,
  onPanelTabTransferFailed,
  onPanelTabTransferInsertRequested,
  onPanelTabTransferRequested,
  onPanelWindowCloseRequested,
  onPanelWindowFocusRequested,
  requestPanelTabClose,
  updatePanelWindowSnapshot,
} from '@/core/panel-windows';
import type { PanelLifecycleBlocker } from '@/core/panel-windows/panelLifecycleGuards';
import { usePanelLifecycleGuardRegistry } from '@/core/panel-windows/panelLifecycleGuards';
import { nativePanelPublication } from '@/core/panel-windows/publicationQueue';
import {
  objectPanelTabSnapshot,
  samePanelTab,
  tornOffTabSnapshot,
} from '@/core/panel-windows/tabTransfer';
import type { ViewType } from '@/modules/object-panel/components/ObjectPanel/types';
import {
  useObjectPanelActiveTabs,
  useObjectPanelState,
} from '@/modules/object-panel/contexts/ObjectPanelStateContext';
import type { KubernetesObjectReference } from '@/types/view-state';
import { useDockablePanelContext } from '@/ui/dockable';
import { getGroupTabs } from '@/ui/dockable/tabGroupState';
import { executeBackendApplicationMenuCommand } from '@/ui/layout/ApplicationMenuCommandContext';
import { reportOperationalError } from '@/utils/errorHandler';
import { ApplicationMenuShortcuts } from './ApplicationMenuShortcuts';
import {
  dispatchPanelApplicationMenuCommand,
  type PanelApplicationMenuActions,
} from './panelApplicationMenuCommands';

export function PanelWindowShortcuts({
  descriptor,
  ready,
}: Readonly<{ descriptor: PanelWindowDescriptor; ready: boolean }>) {
  const { openPanels, upsertOwnedPanel } = useObjectPanelState();
  const activeTabs = useObjectPanelActiveTabs();
  const { tabGroups, focusPanel, commitTabClose, movePanelBetweenGroups } =
    useDockablePanelContext();
  const guards = usePanelLifecycleGuardRegistry();
  const { resetZoom, zoomIn, zoomOut } = useZoom();
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

  useEffect(
    () =>
      onApplicationQuitPreflightRequested((event) => {
        if (event.windowName !== descriptor.windowName) {
          return;
        }
        const blocker = guards.firstBlocker(Array.from(openPanels.keys()));
        if (blocker) {
          focusLifecycleBlocker(blocker);
        }
        void nativePanelPublication
          .flush()
          .then(
            () => ready && !blocker && !guards.isFrozen(),
            (error: unknown) => {
              reportOperationalError(error, {
                source: 'PanelWindowShortcuts',
                action: 'quit-preflight',
              });
              return false;
            }
          )
          .then((allowed) =>
            acknowledgeApplicationQuitPreflight(descriptor.windowName, event.transactionId, allowed)
          )
          .catch((error) =>
            reportOperationalError(error, {
              source: 'PanelWindowShortcuts',
              action: 'acknowledge-quit',
            })
          );
      }),
    [descriptor.windowName, guards, openPanels, ready, focusLifecycleBlocker]
  );

  const prepareClusterClose = useCallback(
    async (transactionId: string) => {
      const panelIds = Array.from(openPanels.keys());
      const blocker = guards.firstBlocker(panelIds);
      if (blocker) {
        focusLifecycleBlocker(blocker);
      }
      if (!ready || blocker || guards.isFrozen()) {
        return false;
      }
      guards.freeze(transactionId, panelIds, 'Closing cluster…');
      try {
        await nativePanelPublication.flush();
        return true;
      } catch (error) {
        reportOperationalError(error, {
          source: 'PanelWindowShortcuts',
          action: 'cluster-close-preflight',
          clusterId: descriptor.clusterId,
        });
        return false;
      }
    },
    [descriptor.clusterId, guards, openPanels, ready, focusLifecycleBlocker]
  );

  useEffect(() => {
    const stopRequest = onClusterPanelCloseRequested((event) => {
      if (event.windowName !== descriptor.windowName || event.clusterId !== descriptor.clusterId) {
        return;
      }
      void prepareClusterClose(event.transactionId)
        .then((approved) =>
          acknowledgeClusterPanelClose(descriptor.windowName, event.transactionId, approved)
        )
        .catch((error) =>
          reportOperationalError(error, {
            source: 'PanelWindowShortcuts',
            action: 'acknowledge-cluster-close',
            clusterId: descriptor.clusterId,
          })
        );
    });
    const stopSettled = onClusterPanelCloseSettled((event) => {
      if (event.windowName === descriptor.windowName && event.clusterId === descriptor.clusterId) {
        guards.releaseTransfer(event.transactionId);
      }
    });
    return () => {
      stopRequest();
      stopSettled();
    };
  }, [descriptor.windowName, descriptor.clusterId, guards, prepareClusterClose]);

  const getPanelSnapshot = useCallback(
    (panelId: string) => {
      const ref = openPanels.get(panelId);
      return ref
        ? objectPanelTabSnapshot(panelId, ref, activeTabs.get(panelId) ?? 'details')
        : null;
    },
    [openPanels, activeTabs]
  );

  useEffect(
    () =>
      onPanelTabTransferRequested(({ request }) => {
        if (request.sourceWindowName !== descriptor.windowName) {
          return;
        }
        const current = getPanelSnapshot(request.tab.panelId);
        const blocker = guards.firstBlocker([request.tab.panelId]);
        if (
          !ready ||
          request.clusterId !== descriptor.clusterId ||
          request.sourceGroupId !== descriptor.groupId ||
          !samePanelTab(current, request.tab) ||
          blocker
        ) {
          if (blocker) {
            focusLifecycleBlocker(blocker);
          }
          void failPanelTabTransfer(descriptor.windowName, request.transferId);
          return;
        }
        guards.freeze(request.transferId, [request.tab.panelId]);
        void nativePanelPublication
          .flush()
          .then(() => acceptPanelTabTransfer(descriptor.windowName, request.transferId))
          .then(() => {
            if (request.targetKind === 'new-window') {
              return beginPanelWindowOpen(descriptor.windowName, tornOffTabSnapshot(request));
            }
          })
          .catch((error) => {
            void failPanelTabTransfer(descriptor.windowName, request.transferId);
            reportOperationalError(error, {
              source: 'PanelWindowShortcuts',
              action: 'accept-tab-transfer',
            });
          });
      }),
    [descriptor, guards, ready, focusLifecycleBlocker, getPanelSnapshot]
  );

  const closeActiveTab = useCallback(async () => {
    if (!ready) {
      return;
    }
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
  }, [descriptor, focusLifecycleBlocker, guards, ready, tabGroups]);

  const requestActiveTabClose = useCallback(() => {
    void closeActiveTab().catch((error) =>
      reportOperationalError(error, {
        source: 'PanelWindowShortcuts',
        action: 'close-active-tab',
      })
    );
  }, [closeActiveTab]);

  const requestInspector = useCallback(() => {
    void openDevTools().catch((error) =>
      reportOperationalError(error, {
        source: 'PanelWindowShortcuts',
        action: 'open-inspector',
      })
    );
  }, []);

  const runWindowOperation = useCallback((action: string, operation: () => Promise<void>) => {
    void operation().catch((error) =>
      reportOperationalError(error, { source: 'PanelWindowShortcuts', action })
    );
  }, []);

  const executeApplicationMenuCommand = useCallback(
    (menuCommand: backend.ApplicationMenuCommand) => {
      if (guards.isFrozen()) {
        return;
      }
      const actions: PanelApplicationMenuActions = {
        close: requestActiveTabClose,
        zoomIn,
        zoomOut,
        zoomReset: resetZoom,
        minimise: () => runWindowOperation('minimise-window', minimiseWindow),
        maximise: () => runWindowOperation('maximise-window', maximiseWindow),
        restore: () => runWindowOperation('restore-window', restoreWindow),
        toggleMaximise: () => runWindowOperation('toggle-maximise-window', toggleMaximise),
        openInspector: requestInspector,
      };
      if (!dispatchPanelApplicationMenuCommand(menuCommand, actions)) {
        executeBackendApplicationMenuCommand(menuCommand);
      }
    },
    [
      requestActiveTabClose,
      requestInspector,
      resetZoom,
      runWindowOperation,
      zoomIn,
      zoomOut,
      guards.isFrozen,
    ]
  );

  useEffect(() => {
    if (!ready) {
      return;
    }
    return onEvent('menu:close', () => {
      requestActiveTabClose();
    });
  }, [ready, requestActiveTabClose]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    return onEvent('debug:open-inspector', () => {
      requestInspector();
    });
  }, [ready, requestInspector]);

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
          request.clusterId !== descriptor.clusterId ||
          request.targetGroupId !== descriptor.groupId ||
          openPanels.has(request.tab.panelId)
        ) {
          void failPanelTabTransfer(descriptor.windowName, request.transferId);
          return;
        }
        guards.freeze(request.transferId, [request.tab.panelId]);
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
    [descriptor, movePanelBetweenGroups, openPanels, upsertOwnedPanel, guards.freeze]
  );

  useEffect(
    () =>
      onPanelTabTransferCommitted(({ request }) => {
        guards.releaseTransfer(request.transferId);
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
    [commitTabClose, descriptor, tabGroups, guards.releaseTransfer]
  );

  useEffect(
    () =>
      onPanelTabTransferFailed(({ request }) => {
        guards.releaseTransfer(request.transferId);
        const insertedPanelId = insertedTabTransfersRef.current.get(request.transferId);
        if (request.targetWindowName !== descriptor.windowName || !insertedPanelId) {
          return;
        }
        guards.releaseTransfer(request.transferId);
        insertedTabTransfersRef.current.delete(request.transferId);
        commitTabClose(insertedPanelId);
      }),
    [commitTabClose, descriptor.windowName, guards.releaseTransfer]
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
      sourceWindowName: descriptor.windowName,
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
    nativePanelPublication.publish(
      () => updatePanelWindowSnapshot(descriptor.windowName, snapshot),
      (error) => {
        reportOperationalError(error, {
          source: 'PanelWindowShortcuts',
          action: 'sync-panel-window-snapshot',
        });
      }
    );
  }, [activeTabs, descriptor, openPanels, ready, tabGroups]);

  useEffect(
    () =>
      onPanelWindowCloseRequested(() => {
        if (guards.isFrozen()) {
          return;
        }
        const group = getGroupTabs(tabGroups, 'right') ?? getGroupTabs(tabGroups, 'bottom');
        const tabs = group?.tabs ?? descriptor.snapshot.tabs?.map((tab) => tab.panelId) ?? [];
        const blocker = guards.firstBlocker(tabs);
        if (blocker) {
          focusLifecycleBlocker(blocker);
          return;
        }
        void nativePanelPublication
          .flush()
          .then(() => acknowledgePanelWindowClose(descriptor.windowName))
          .catch((error) =>
            reportOperationalError(error, {
              source: 'PanelWindowShortcuts',
              action: 'close-window',
            })
          );
      }),
    [descriptor, focusLifecycleBlocker, guards, tabGroups]
  );

  useEffect(() => onPanelWindowFocusRequested(({ panelId }) => focusPanel(panelId)), [focusPanel]);

  return <ApplicationMenuShortcuts enabled={ready} execute={executeApplicationMenuCommand} />;
}
