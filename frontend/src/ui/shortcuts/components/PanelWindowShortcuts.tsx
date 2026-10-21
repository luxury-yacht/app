import { panelTargetFromSnapshot } from '@modules/object-panel/panelTarget';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  acknowledgeClusterPanelClose,
  acknowledgePanelTransfer,
  acknowledgePanelWindowClose,
  beginPanelWindowOpen,
  failPanelTabTransfer,
  onClusterPanelCloseRequested,
  onClusterPanelCloseSettled,
  onPanelTabCloseAuthorized,
  onPanelTabTransferCommitted,
  onPanelTabTransferFailed,
  onPanelTabTransferInsertRequested,
  onPanelTabTransferRequested,
  onPanelWindowCloseRequested,
  onPanelWindowFocusRequested,
  publishPanelWindowGroup,
  requestPanelTabClose,
} from '@/core/panel-windows';
import type { PanelLifecycleBlocker } from '@/core/panel-windows/panelLifecycleGuards';
import {
  preparePanelClose,
  usePanelLifecycleGuardRegistry,
} from '@/core/panel-windows/panelLifecycleGuards';
import { nativePanelPublication } from '@/core/panel-windows/publicationQueue';
import {
  objectPanelTabSnapshot,
  samePanelTab,
  tornOffTabSnapshot,
} from '@/core/panel-windows/tabTransfer';
import { useApplicationQuitPreflight } from '@/core/panel-windows/useApplicationQuitPreflight';
import { useClosedPanelIntents } from '@/core/panel-windows/useClosedPanelIntents';
import type { ViewType } from '@/modules/object-panel/components/ObjectPanel/types';
import {
  useObjectPanelActiveTabs,
  useObjectPanelState,
} from '@/modules/object-panel/contexts/ObjectPanelStateContext';
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
  // Tabs the directory is moving into this window, by transfer ID. Each is
  // acknowledged once mounted; a failed move removes the inserted copy.
  const [insertedTabTransfers, setInsertedTabTransfers] = useState<ReadonlyMap<string, string>>(
    new Map()
  );
  const acknowledgingRef = useRef(new Set<string>());
  useClosedPanelIntents(nativePanelPublication, descriptor.windowName);
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

  const prepareClose = useCallback(
    async (transactionId: string, status: string, clusterId?: string) => {
      if (!ready) {
        return false;
      }
      return preparePanelClose({
        guards,
        transactionId,
        clusterId,
        status,
        panelIds: Array.from(openPanels.keys()),
        flush: () => nativePanelPublication.flush(),
        focusBlocker: focusLifecycleBlocker,
      });
    },
    [guards, openPanels, ready, focusLifecycleBlocker]
  );
  useApplicationQuitPreflight(descriptor.windowName, prepareClose);

  useEffect(() => {
    const stopRequest = onClusterPanelCloseRequested((event) => {
      if (event.windowName !== descriptor.windowName || event.clusterId !== descriptor.clusterId) {
        return;
      }
      void prepareClose(event.transactionId, 'Closing cluster…', descriptor.clusterId)
        .catch((error) => {
          reportOperationalError(error, {
            source: 'PanelWindowShortcuts',
            action: 'cluster-close-preflight',
            clusterId: descriptor.clusterId,
          });
          return false;
        })
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
  }, [descriptor.windowName, descriptor.clusterId, guards, prepareClose]);

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
          guards.isFrozen() ||
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
        // Accepting begins the directory move; it checks identity, not this
        // window's published view, so no publication flush comes first.
        void acceptPanelTabTransfer(descriptor.windowName, request.transferId)
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
    const activePanelId = group?.activeTab ?? descriptor.group.activePanelId;
    const tabs = group?.tabs ?? descriptor.group.tabs?.map((tab) => tab.panelId) ?? [];
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
          guards.isFrozen(request.transferId) ||
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
          panelTargetFromSnapshot(request.tab),
          request.tab.activeView as ViewType
        );
        if (panelId !== request.tab.panelId) {
          void failPanelTabTransfer(descriptor.windowName, request.transferId);
          return;
        }
        setInsertedTabTransfers((current) => new Map(current).set(request.transferId, panelId));
        movePanelBetweenGroups(panelId, 'right', request.targetIndex);
      }),
    [descriptor, movePanelBetweenGroups, openPanels, upsertOwnedPanel, guards]
  );

  useEffect(
    () =>
      onPanelTabTransferCommitted(({ request }) => {
        guards.releaseTransfer(request.transferId);
        setInsertedTabTransfers((current) => withoutTransfer(current, request.transferId));
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
        const insertedPanelId = insertedTabTransfers.get(request.transferId);
        if (request.targetWindowName !== descriptor.windowName || !insertedPanelId) {
          return;
        }
        setInsertedTabTransfers((current) => withoutTransfer(current, request.transferId));
        commitTabClose(insertedPanelId);
      }),
    [commitTabClose, descriptor.windowName, guards.releaseTransfer, insertedTabTransfers]
  );

  // Once an inserted tab is mounted, land queued snapshots (so none can later
  // omit the committed tab), then let the directory commit the move.
  useEffect(() => {
    const group = getGroupTabs(tabGroups, 'right') ?? getGroupTabs(tabGroups, 'bottom');
    for (const [transferId, panelId] of insertedTabTransfers) {
      if (acknowledgingRef.current.has(transferId) || !group?.tabs.includes(panelId)) {
        continue;
      }
      acknowledgingRef.current.add(transferId);
      void nativePanelPublication
        .flush()
        .then(() => acknowledgePanelTransfer(descriptor.windowName, transferId, true))
        .catch((error) => {
          cancelInsertedTab(descriptor.windowName, transferId);
          reportOperationalError(error, {
            source: 'PanelWindowShortcuts',
            action: 'acknowledge-inserted-tab',
          });
        });
    }
  }, [descriptor.windowName, insertedTabTransfers, tabGroups]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    const group = getGroupTabs(tabGroups, 'right') ?? getGroupTabs(tabGroups, 'bottom');
    if (!group || group.tabs.length === 0) {
      return;
    }
    const arrangement: import('@/core/backend-api/models').panelwindow.WorkspaceGroup = {
      clusterId: descriptor.clusterId,
      groupId: descriptor.groupId,
      tabs: group.tabs.flatMap((panelId) => {
        const objectRef = openPanels.get(panelId);
        return objectRef
          ? [objectPanelTabSnapshot(panelId, objectRef, activeTabs.get(panelId) ?? 'details')]
          : [];
      }),
      activePanelId: group.activeTab ?? group.tabs[0],
    };
    nativePanelPublication.publish(
      () => publishPanelWindowGroup(descriptor.windowName, arrangement),
      (error) => {
        reportOperationalError(error, {
          source: 'PanelWindowShortcuts',
          action: 'publish-panel-window-group',
        });
      }
    );
  }, [activeTabs, descriptor, openPanels, ready, tabGroups]);

  useEffect(
    () =>
      onPanelWindowCloseRequested(() => {
        const transactionId = `window-close-${globalThis.crypto.randomUUID()}`;
        void prepareClose(transactionId, 'Closing window…')
          .then((allowed) =>
            allowed ? acknowledgePanelWindowClose(descriptor.windowName) : undefined
          )
          .catch((error) =>
            reportOperationalError(error, {
              source: 'PanelWindowShortcuts',
              action: 'close-window',
            })
          )
          .finally(() => guards.releaseTransfer(transactionId));
      }),
    [descriptor.windowName, guards, prepareClose]
  );

  useEffect(() => onPanelWindowFocusRequested(({ panelId }) => focusPanel(panelId)), [focusPanel]);

  return <ApplicationMenuShortcuts enabled={ready} execute={executeApplicationMenuCommand} />;
}

// The registry may already have cancelled the move; only the commit error matters.
function cancelInsertedTab(windowName: string, transferId: string): void {
  void acknowledgePanelTransfer(windowName, transferId, false).catch(() => undefined);
}

function withoutTransfer(
  transfers: ReadonlyMap<string, string>,
  transferId: string
): ReadonlyMap<string, string> {
  if (!transfers.has(transferId)) {
    return transfers;
  }
  const next = new Map(transfers);
  next.delete(transferId);
  return next;
}
