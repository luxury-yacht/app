import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { panelwindow } from '@/core/backend-api/models';
import { focusWindow, getWindowIdentity } from '@/core/desktop-runtime';
import { getObjectPanelLayoutDefaults } from '@/core/settings/appPreferences';
import { useKubeconfig } from '@/modules/kubernetes/config/KubeconfigContext';
import type { ViewType } from '@/modules/object-panel/components/ObjectPanel/types';
import {
  useObjectPanelActiveTabs,
  useObjectPanelState,
} from '@/modules/object-panel/contexts/ObjectPanelStateContext';
import { buildObjectPanelRef, objectPanelId } from '@/modules/object-panel/objectPanelRef';
import type { DockPosition } from '@/ui/dockable';
import { DockablePanelProvider, useDockablePanelContext } from '@/ui/dockable';
import { getGroupForPanel } from '@/ui/dockable/tabGroupState';
import type { GroupKey } from '@/ui/dockable/tabGroupTypes';
import { reportOperationalError } from '@/utils/errorHandler';
import {
  acceptPanelTabTransfer,
  acknowledgeApplicationQuitPreflight,
  acknowledgePanelWindowDock,
  acknowledgeWorkspaceWindowClose,
  authorizePanelObjectOpen,
  authorizePanelTabClose,
  beginPanelWindowOpen,
  failPanelTabTransfer,
  failPanelWindowTransfer,
  focusPanelWindow,
  onApplicationQuitPreflightRequested,
  onOwnerCloseRequested,
  onPanelObjectOpenRequested,
  onPanelTabCloseRequested,
  onPanelTabTransferCommitted,
  onPanelTabTransferFailed,
  onPanelTabTransferRequested,
  onPanelWindowClosed,
  onPanelWindowDockRequested,
  onPanelWindowGuardResult,
  onPanelWindowOpened,
  onPanelWindowSnapshotUpdated,
  requestPanelTabTransfer,
  requestPanelWindowClose,
  requestPanelWindowGuard,
} from './index';
import { usePanelLifecycleGuardRegistry } from './panelLifecycleGuards';
import {
  type DockableTabDragPayload,
  objectPanelTabSnapshot,
  singleTabGroupSnapshot,
  tabTransferRequestFromDragPayload,
} from './tabTransfer';

const newIdentity = (prefix: string): string =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;

const objectSnapshot = (
  panelId: string,
  objectRef: ReturnType<typeof useObjectPanelState>['openPanels'] extends Map<string, infer Ref>
    ? Ref
    : never,
  activeView: string
): panelwindow.TabSnapshot => ({
  ...objectPanelTabSnapshot(panelId, objectRef, activeView),
});

const initialWindowBounds = (panelIds: readonly string[]): panelwindow.WindowBounds | undefined => {
  if (panelIds.length === 0) {
    return undefined;
  }
  const { floatingWidth: width, floatingHeight: height } = getObjectPanelLayoutDefaults();
  return {
    x: 0,
    y: 0,
    width,
    height,
  };
};

const sameTransferredTab = (
  owned: ReturnType<typeof useObjectPanelState>['getOwnedPanel'] extends (
    clusterId: string,
    panelId: string
  ) => infer Owned
    ? NonNullable<Owned>
    : never,
  tab: panelwindow.TabSnapshot
): boolean =>
  owned.objectRef.clusterId === tab.objectRef.clusterId &&
  owned.objectRef.group === tab.objectRef.group &&
  owned.objectRef.version === tab.objectRef.version &&
  owned.objectRef.kind === tab.objectRef.kind &&
  (owned.objectRef.namespace ?? '') === tab.objectRef.namespace &&
  owned.objectRef.name === tab.objectRef.name &&
  owned.activeView === tab.activeView;

export function WorkspacePanelCoordinator({ children }: Readonly<{ children: React.ReactNode }>) {
  const ownerWindowName = getWindowIdentity();
  const {
    openPanels,
    nativeLocations,
    pendingNativeOpenPanelIds,
    commitPanelWindow,
    dockPanelWindow,
    getOwnedPanel,
    panelIdsForCluster,
    nativeWindowNamesForCluster,
    syncPanelWindowSnapshot,
  } = useObjectPanelState();
  const activeTabs = useObjectPanelActiveTabs();
  const { registerClusterClosePreflight, selectedClusterId } = useKubeconfig();
  const guards = usePanelLifecycleGuardRegistry();
  const [pendingOwnerCloseWindows, setPendingOwnerCloseWindows] = useState<Set<string> | null>(
    null
  );
  const pendingOwnerCloseTimeoutRef = useRef<number | null>(null);
  const [pendingDockRequest, setPendingDockRequest] =
    useState<panelwindow.WindowDockRequestedEvent | null>(null);
  const pendingClusterClosesRef = useRef(
    new Map<
      string,
      {
        remaining: Set<string>;
        promise: Promise<boolean>;
        resolve: (allowed: boolean) => void;
        timeout: number;
        guardRequests: Map<string, string>;
      }
    >()
  );
  const pendingOwnerCloseGuardRequestsRef = useRef(new Map<string, string>());
  const pendingApplicationQuitRef = useRef<{
    transactionId: string;
    remaining: Set<string>;
    timeout: number;
  } | null>(null);
  const pendingFloatGroupsRef = useRef(new Set<GroupKey>());
  const pendingFloatGroupIdsRef = useRef(
    new Map<
      string,
      { sourceGroup: GroupKey; snapshot: panelwindow.GroupSnapshot; autoFloat: boolean }
    >()
  );
  const [pendingAutoFloatRollbacks, setPendingAutoFloatRollbacks] = useState<
    panelwindow.GroupSnapshot[]
  >([]);

  const queueAutoFloatRollback = useCallback(
    (snapshot: panelwindow.GroupSnapshot) => {
      dockPanelWindow(snapshot, 'right');
      setPendingAutoFloatRollbacks((previous) =>
        previous.some((candidate) => candidate.transferId === snapshot.transferId)
          ? previous
          : [...previous, snapshot]
      );
    },
    [dockPanelWindow]
  );

  const settleApplicationQuit = useCallback(
    (transactionId: string, allowed: boolean, error?: unknown) => {
      const pending = pendingApplicationQuitRef.current;
      if (pending?.transactionId !== transactionId) {
        return;
      }
      window.clearTimeout(pending.timeout);
      pendingApplicationQuitRef.current = null;
      void acknowledgeApplicationQuitPreflight(ownerWindowName, transactionId, allowed).catch(
        (acknowledgeError) =>
          reportOperationalError(acknowledgeError, {
            source: 'WorkspacePanelCoordinator',
            action: 'acknowledge-application-quit',
          })
      );
      if (error) {
        reportOperationalError(error, {
          source: 'WorkspacePanelCoordinator',
          action: 'application-quit-preflight',
        });
      }
    },
    [ownerWindowName]
  );

  const handleGroupMove = useCallback(
    (
      group: { groupKey: GroupKey; tabs: string[]; activeTab: string | null },
      targetPosition: DockPosition
    ): boolean => {
      if (targetPosition !== 'floating') {
        return false;
      }
      if (pendingFloatGroupsRef.current.has(group.groupKey)) {
        return true;
      }
      const blocker = guards.firstBlocker(group.tabs);
      if (blocker) {
        blocker.focus();
        return true;
      }
      const firstRef = openPanels.get(group.tabs[0] ?? '');
      if (!firstRef?.clusterId) {
        return true;
      }
      const groupId = newIdentity('panel-group');
      const snapshot: panelwindow.GroupSnapshot = {
        schemaVersion: 1,
        transferId: newIdentity('panel-transfer'),
        ownerWindowName,
        clusterId: firstRef.clusterId,
        groupId,
        tabs: group.tabs.flatMap((panelId) => {
          const objectRef = openPanels.get(panelId);
          if (!objectRef || objectRef.clusterId !== firstRef.clusterId) {
            return [];
          }
          return [objectSnapshot(panelId, objectRef, activeTabs.get(panelId) ?? 'details')];
        }),
        activePanelId: group.activeTab ?? group.tabs[0] ?? '',
        initialBounds: initialWindowBounds(group.tabs),
      };
      const autoFloat =
        group.tabs.length > 0 &&
        group.tabs.every((panelId) => pendingNativeOpenPanelIds.has(panelId));
      pendingFloatGroupsRef.current.add(group.groupKey);
      pendingFloatGroupIdsRef.current.set(groupId, {
        sourceGroup: group.groupKey,
        snapshot,
        autoFloat,
      });
      void beginPanelWindowOpen(ownerWindowName, snapshot).catch((error) => {
        const pending = pendingFloatGroupIdsRef.current.get(groupId);
        pendingFloatGroupsRef.current.delete(pending?.sourceGroup ?? group.groupKey);
        pendingFloatGroupIdsRef.current.delete(groupId);
        if (pending?.autoFloat) {
          queueAutoFloatRollback(pending.snapshot);
        }
        reportOperationalError(error, {
          source: 'WorkspacePanelCoordinator',
          action: 'float-group',
        });
      });
      return true;
    },
    [
      activeTabs,
      guards,
      openPanels,
      ownerWindowName,
      pendingNativeOpenPanelIds,
      queueAutoFloatRollback,
    ]
  );

  const getTabSnapshot = useCallback(
    (panelId: string) => {
      const objectRef = openPanels.get(panelId);
      return objectRef
        ? objectSnapshot(panelId, objectRef, activeTabs.get(panelId) ?? 'details')
        : undefined;
    },
    [activeTabs, openPanels]
  );

  const tabDragIdentity = useMemo(
    () => ({
      windowName: ownerWindowName,
      ownerWindowName,
      clusterId: selectedClusterId,
      getTabSnapshot,
    }),
    [getTabSnapshot, ownerWindowName, selectedClusterId]
  );

  const canStartTabDrag = useCallback(
    (panelId: string) => {
      const blocker = guards.firstBlocker([panelId]);
      blocker?.focus();
      return blocker === null;
    },
    [guards]
  );

  const handleExternalTabDrop = useCallback(
    (payload: DockableTabDragPayload, targetGroupId: string, insertIndex: number) => {
      if (targetGroupId !== 'right' && targetGroupId !== 'bottom') {
        return;
      }
      const request = tabTransferRequestFromDragPayload(payload, {
        transferId: newIdentity('panel-tab-transfer'),
        targetWindowName: ownerWindowName,
        targetGroupId,
        targetIndex: insertIndex,
        targetKind: 'workspace' as panelwindow.TabTransferTarget,
      });
      if (!request) {
        return;
      }
      void requestPanelTabTransfer(ownerWindowName, request).catch((error) =>
        reportOperationalError(error, {
          source: 'WorkspacePanelCoordinator',
          action: 'request-tab-drop',
          clusterId: request.clusterId,
        })
      );
    },
    [ownerWindowName]
  );

  const handleTabTearOff = useCallback(
    (payload: DockableTabDragPayload, cursor: { x: number; y: number }) => {
      const request = tabTransferRequestFromDragPayload(payload, {
        transferId: newIdentity('panel-tab-transfer'),
        targetWindowName: '',
        targetGroupId: newIdentity('panel-group'),
        targetIndex: 0,
        targetKind: 'new-window' as panelwindow.TabTransferTarget,
        cursor,
      });
      if (!request || request.sourceWindowName !== ownerWindowName) {
        return;
      }
      void requestPanelTabTransfer(ownerWindowName, request).catch((error) =>
        reportOperationalError(error, {
          source: 'WorkspacePanelCoordinator',
          action: 'tear-off-tab',
          clusterId: request.clusterId,
        })
      );
    },
    [ownerWindowName]
  );

  const handlePanelWindowOpened = useCallback(
    (event: panelwindow.WindowOpenedEvent) => {
      const pending = pendingFloatGroupIdsRef.current.get(event.groupId);
      if (pending) {
        pendingFloatGroupsRef.current.delete(pending.sourceGroup);
        pendingFloatGroupIdsRef.current.delete(event.groupId);
      }
      commitPanelWindow(event.snapshot, event.windowName);
    },
    [commitPanelWindow]
  );

  useEffect(
    () =>
      onPanelWindowSnapshotUpdated(({ windowName, snapshot }) => {
        if (snapshot.ownerWindowName !== ownerWindowName) {
          return;
        }
        syncPanelWindowSnapshot(snapshot, windowName);
      }),
    [ownerWindowName, syncPanelWindowSnapshot]
  );

  useEffect(
    () =>
      onPanelTabCloseRequested((event) => {
        if (event.ownerWindowName !== ownerWindowName) {
          return;
        }
        if (!getOwnedPanel(event.clusterId, event.panelId)) {
          return;
        }
        void authorizePanelTabClose(ownerWindowName, event.sourceWindowName, event.panelId).catch(
          (error) => {
            reportOperationalError(error, {
              source: 'WorkspacePanelCoordinator',
              action: 'authorize-panel-tab-close',
              clusterId: event.clusterId,
            });
          }
        );
      }),
    [getOwnedPanel, ownerWindowName]
  );

  const handlePanelWindowDockRequested = useCallback(
    (event: panelwindow.WindowDockRequestedEvent, targetPosition: 'right' | 'bottom') => {
      dockPanelWindow(event.snapshot, targetPosition);
      setPendingDockRequest(event);
    },
    [dockPanelWindow]
  );

  const handlePanelWindowClosed = useCallback(
    (windowName: string, groupId?: string) => {
      if (groupId) {
        const pending = pendingFloatGroupIdsRef.current.get(groupId);
        if (pending) {
          pendingFloatGroupsRef.current.delete(pending.sourceGroup);
          pendingFloatGroupIdsRef.current.delete(groupId);
          if (pending.autoFloat) {
            queueAutoFloatRollback(pending.snapshot);
          }
        }
      }
      setPendingOwnerCloseWindows((previous) => {
        if (!previous?.has(windowName)) {
          return previous;
        }
        const next = new Set(previous);
        next.delete(windowName);
        return next;
      });
      for (const [clusterId, pending] of pendingClusterClosesRef.current) {
        pending.remaining.delete(windowName);
        if (pending.remaining.size > 0) {
          continue;
        }
        window.clearTimeout(pending.timeout);
        pendingClusterClosesRef.current.delete(clusterId);
        pending.resolve(true);
      }
    },
    [queueAutoFloatRollback]
  );

  const handleAutoFloatRollbackSettled = useCallback((transferId: string) => {
    setPendingAutoFloatRollbacks((previous) =>
      previous.filter((snapshot) => snapshot.transferId !== transferId)
    );
  }, []);

  const settleClusterClose = useCallback(
    (clusterId: string, allowed: boolean, error?: unknown, action = 'cluster-close') => {
      const pending = pendingClusterClosesRef.current.get(clusterId);
      if (!pending) {
        return;
      }
      window.clearTimeout(pending.timeout);
      pendingClusterClosesRef.current.delete(clusterId);
      pending.resolve(allowed);
      if (error) {
        reportOperationalError(error, {
          source: 'WorkspacePanelCoordinator',
          action,
          clusterId,
        });
      }
    },
    []
  );

  const cancelOwnerClose = useCallback((error?: unknown, focusWindowName?: string) => {
    if (pendingOwnerCloseTimeoutRef.current !== null) {
      window.clearTimeout(pendingOwnerCloseTimeoutRef.current);
      pendingOwnerCloseTimeoutRef.current = null;
    }
    pendingOwnerCloseGuardRequestsRef.current.clear();
    setPendingOwnerCloseWindows(null);
    if (focusWindowName) {
      void focusWindow(focusWindowName).catch((focusError) =>
        reportOperationalError(focusError, {
          source: 'WorkspacePanelCoordinator',
          action: 'focus-close-blocker',
        })
      );
    }
    if (error) {
      reportOperationalError(error, {
        source: 'WorkspacePanelCoordinator',
        action: 'request-owner-close',
      });
    }
  }, []);

  useEffect(
    () =>
      registerClusterClosePreflight(async (clusterId) => {
        const existing = pendingClusterClosesRef.current.get(clusterId);
        if (existing) {
          return existing.promise;
        }
        const panelIds = panelIdsForCluster(clusterId);
        const dockedPanelIds = panelIds.filter(
          (panelId) => !getOwnedPanel(clusterId, panelId)?.nativeLocation
        );
        const blocker = guards.firstBlocker(dockedPanelIds);
        if (blocker) {
          blocker.focus();
          return false;
        }
        const remaining = new Set(nativeWindowNamesForCluster(clusterId));
        if (remaining.size === 0) {
          return true;
        }
        let resolveClose!: (allowed: boolean) => void;
        const promise = new Promise<boolean>((resolve) => {
          resolveClose = resolve;
        });
        const timeout = window.setTimeout(() => {
          pendingClusterClosesRef.current.delete(clusterId);
          resolveClose(false);
          reportOperationalError(new Error(`Panel close timed out for cluster ${clusterId}`), {
            source: 'WorkspacePanelCoordinator',
            action: 'cluster-close-timeout',
            clusterId,
          });
        }, 15_000);
        pendingClusterClosesRef.current.set(clusterId, {
          remaining,
          promise,
          resolve: resolveClose,
          timeout,
          guardRequests: new Map(),
        });
        const pending = pendingClusterClosesRef.current.get(clusterId);
        if (!pending) {
          return promise;
        }
        for (const windowName of remaining) {
          const requestId = newIdentity('cluster-close-guard');
          pending.guardRequests.set(requestId, windowName);
          void requestPanelWindowGuard(
            ownerWindowName,
            windowName,
            requestId,
            'cluster-close'
          ).catch((error) => settleClusterClose(clusterId, false, error, 'request-cluster-guard'));
        }
        return promise;
      }),
    [
      getOwnedPanel,
      guards,
      nativeWindowNamesForCluster,
      ownerWindowName,
      panelIdsForCluster,
      registerClusterClosePreflight,
      settleClusterClose,
    ]
  );

  useEffect(
    () => () => {
      for (const pending of pendingClusterClosesRef.current.values()) {
        window.clearTimeout(pending.timeout);
        pending.resolve(false);
      }
      pendingClusterClosesRef.current.clear();
      pendingOwnerCloseGuardRequestsRef.current.clear();
      if (pendingApplicationQuitRef.current) {
        window.clearTimeout(pendingApplicationQuitRef.current.timeout);
        pendingApplicationQuitRef.current = null;
      }
    },
    []
  );

  useEffect(
    () =>
      onApplicationQuitPreflightRequested((event) => {
        if (event.ownerWindowName !== ownerWindowName) {
          return;
        }
        const dockedPanelIds = Array.from(openPanels.keys()).filter(
          (panelId) => !nativeLocations.has(panelId)
        );
        const blocker = guards.firstBlocker(dockedPanelIds);
        if (blocker) {
          blocker.focus();
          void acknowledgeApplicationQuitPreflight(
            ownerWindowName,
            event.transactionId,
            false
          ).catch((error) =>
            reportOperationalError(error, {
              source: 'WorkspacePanelCoordinator',
              action: 'reject-application-quit',
            })
          );
          return;
        }
        const remaining = new Set(event.panelWindows ?? []);
        if (remaining.size === 0) {
          void acknowledgeApplicationQuitPreflight(
            ownerWindowName,
            event.transactionId,
            true
          ).catch((error) =>
            reportOperationalError(error, {
              source: 'WorkspacePanelCoordinator',
              action: 'allow-application-quit',
            })
          );
          return;
        }
        if (pendingApplicationQuitRef.current) {
          window.clearTimeout(pendingApplicationQuitRef.current.timeout);
        }
        const timeout = window.setTimeout(() => {
          settleApplicationQuit(
            event.transactionId,
            false,
            new Error(`Application quit guard timed out for ${ownerWindowName}`)
          );
        }, 15_000);
        pendingApplicationQuitRef.current = {
          transactionId: event.transactionId,
          remaining,
          timeout,
        };
        for (const windowName of remaining) {
          const requestId = `${event.transactionId}:${windowName}`;
          void requestPanelWindowGuard(
            ownerWindowName,
            windowName,
            requestId,
            'application-quit'
          ).catch((error) => settleApplicationQuit(event.transactionId, false, error));
        }
      }),
    [guards, nativeLocations, openPanels, ownerWindowName, settleApplicationQuit]
  );

  useEffect(
    () =>
      onPanelWindowGuardResult((event) => {
        const pending = pendingApplicationQuitRef.current;
        if (
          pending &&
          event.requestId === `${pending.transactionId}:${event.windowName}` &&
          pending.remaining.has(event.windowName)
        ) {
          if (!event.allowed) {
            settleApplicationQuit(pending.transactionId, false);
            return;
          }
          pending.remaining.delete(event.windowName);
          if (pending.remaining.size === 0) {
            settleApplicationQuit(pending.transactionId, true);
          }
          return;
        }

        for (const [clusterId, clusterClose] of pendingClusterClosesRef.current) {
          if (clusterClose.guardRequests.get(event.requestId) !== event.windowName) {
            continue;
          }
          clusterClose.guardRequests.delete(event.requestId);
          if (!event.allowed) {
            void focusWindow(event.windowName).catch((error) =>
              reportOperationalError(error, {
                source: 'WorkspacePanelCoordinator',
                action: 'focus-close-blocker',
                clusterId,
              })
            );
            settleClusterClose(clusterId, false);
            return;
          }
          void requestPanelWindowClose(ownerWindowName, event.windowName, 'cluster-close').catch(
            (error) => settleClusterClose(clusterId, false, error, 'request-cluster-close')
          );
          return;
        }

        if (pendingOwnerCloseGuardRequestsRef.current.get(event.requestId) !== event.windowName) {
          return;
        }
        pendingOwnerCloseGuardRequestsRef.current.delete(event.requestId);
        if (!event.allowed) {
          cancelOwnerClose(undefined, event.windowName);
          return;
        }
        void requestPanelWindowClose(ownerWindowName, event.windowName, 'owner-close').catch(
          (error) => cancelOwnerClose(error)
        );
      }),
    [cancelOwnerClose, ownerWindowName, settleApplicationQuit, settleClusterClose]
  );

  useEffect(
    () =>
      onOwnerCloseRequested(({ ownerWindowName: requestedOwner, panelWindows }) => {
        if (requestedOwner !== ownerWindowName) {
          return;
        }
        const dockedPanelIds = Array.from(openPanels.keys()).filter(
          (panelId) => !nativeLocations.has(panelId)
        );
        const blocker = guards.firstBlocker(dockedPanelIds);
        if (blocker) {
          blocker.focus();
          return;
        }
        const requestedPanelWindows = panelWindows ?? [];
        if (pendingOwnerCloseTimeoutRef.current !== null) {
          window.clearTimeout(pendingOwnerCloseTimeoutRef.current);
          pendingOwnerCloseTimeoutRef.current = null;
        }
        pendingOwnerCloseGuardRequestsRef.current.clear();
        setPendingOwnerCloseWindows(new Set(requestedPanelWindows));
        if (requestedPanelWindows.length > 0) {
          pendingOwnerCloseTimeoutRef.current = window.setTimeout(() => {
            pendingOwnerCloseTimeoutRef.current = null;
            pendingOwnerCloseGuardRequestsRef.current.clear();
            setPendingOwnerCloseWindows(null);
            reportOperationalError(
              new Error(`Panel close timed out for owner ${ownerWindowName}`),
              {
                source: 'WorkspacePanelCoordinator',
                action: 'owner-close-timeout',
              }
            );
          }, 15_000);
        }
        for (const windowName of requestedPanelWindows) {
          const requestId = newIdentity('owner-close-guard');
          pendingOwnerCloseGuardRequestsRef.current.set(requestId, windowName);
          void requestPanelWindowGuard(ownerWindowName, windowName, requestId, 'owner-close').catch(
            (error) => cancelOwnerClose(error)
          );
        }
      }),
    [cancelOwnerClose, guards, nativeLocations, openPanels, ownerWindowName]
  );

  useEffect(() => {
    if (!pendingOwnerCloseWindows || pendingOwnerCloseWindows.size > 0) {
      return;
    }
    if (pendingOwnerCloseTimeoutRef.current !== null) {
      window.clearTimeout(pendingOwnerCloseTimeoutRef.current);
      pendingOwnerCloseTimeoutRef.current = null;
    }
    setPendingOwnerCloseWindows(null);
    pendingOwnerCloseGuardRequestsRef.current.clear();
    void acknowledgeWorkspaceWindowClose(ownerWindowName).catch((error) =>
      reportOperationalError(error, {
        source: 'WorkspacePanelCoordinator',
        action: 'acknowledge-owner-close',
      })
    );
  }, [ownerWindowName, pendingOwnerCloseWindows]);

  useEffect(
    () => () => {
      if (pendingOwnerCloseTimeoutRef.current !== null) {
        window.clearTimeout(pendingOwnerCloseTimeoutRef.current);
        pendingOwnerCloseTimeoutRef.current = null;
      }
      pendingOwnerCloseGuardRequestsRef.current.clear();
    },
    []
  );

  const handleDockRequestSettled = useCallback(
    (request: panelwindow.WindowDockRequestedEvent, committed: boolean) => {
      if (!committed) {
        commitPanelWindow(request.snapshot, request.windowName);
      }
      setPendingDockRequest((current) =>
        current?.windowName === request.windowName && current.transferId === request.transferId
          ? null
          : current
      );
    },
    [commitPanelWindow]
  );

  return (
    <DockablePanelProvider
      onGroupMoveRequest={handleGroupMove}
      tabDragIdentity={tabDragIdentity}
      onExternalTabDrop={handleExternalTabDrop}
      onTabTearOff={handleTabTearOff}
      canStartTabDrag={canStartTabDrag}
    >
      <WorkspaceObjectRouteCoordinator
        ownerWindowName={ownerWindowName}
        pendingDockRequest={pendingDockRequest}
        pendingAutoFloatRollbacks={pendingAutoFloatRollbacks}
        onWindowOpened={handlePanelWindowOpened}
        onDockRequest={handlePanelWindowDockRequested}
        onDockRequestSettled={handleDockRequestSettled}
        onOwnedPanelWindowClosed={handlePanelWindowClosed}
        onAutoFloatRollbackSettled={handleAutoFloatRollbackSettled}
      >
        {children}
      </WorkspaceObjectRouteCoordinator>
    </DockablePanelProvider>
  );
}

function WorkspaceObjectRouteCoordinator({
  ownerWindowName,
  pendingDockRequest,
  pendingAutoFloatRollbacks,
  onWindowOpened,
  onDockRequest,
  onDockRequestSettled,
  onOwnedPanelWindowClosed,
  onAutoFloatRollbackSettled,
  children,
}: Readonly<{
  ownerWindowName: string;
  pendingDockRequest: panelwindow.WindowDockRequestedEvent | null;
  pendingAutoFloatRollbacks: panelwindow.GroupSnapshot[];
  onWindowOpened: (event: panelwindow.WindowOpenedEvent) => void;
  onDockRequest: (
    request: panelwindow.WindowDockRequestedEvent,
    targetPosition: 'right' | 'bottom'
  ) => void;
  onDockRequestSettled: (request: panelwindow.WindowDockRequestedEvent, committed: boolean) => void;
  onOwnedPanelWindowClosed: (windowName: string, groupId?: string) => void;
  onAutoFloatRollbackSettled: (transferId: string) => void;
  children: React.ReactNode;
}>) {
  const {
    commitPanelWindow,
    dockPanelWindow,
    getOwnedPanel,
    upsertOwnedPanel,
    removePanelWindow,
    panelIdsForPanelWindow,
  } = useObjectPanelState();
  const {
    selectedClusterIds,
    selectedKubeconfigs,
    getClusterMeta,
    setActiveKubeconfig,
    selectedClusterId,
  } = useKubeconfig();
  const { tabGroups, focusPanel, dockPanelGroup, detachPanelGroup, discardPanelLayouts } =
    useDockablePanelContext();
  const guards = usePanelLifecycleGuardRegistry();
  const [pendingTabDockRequests, setPendingTabDockRequests] = useState(
    new Map<string, panelwindow.TabTransferRequest>()
  );
  const acceptingTabDockRef = useRef(new Set<string>());
  const pendingDockedFocusRef = useRef<string | null>(null);
  const pendingObjectClaimsRef = useRef(new Set<string>());
  const dockAttemptRef = useRef<{
    key: string;
    timeout: number;
    acknowledging: boolean;
  } | null>(null);

  useEffect(() => {
    for (const snapshot of pendingAutoFloatRollbacks) {
      dockPanelGroup(
        snapshot.clusterId,
        (snapshot.tabs ?? []).map((tab) => tab.panelId),
        snapshot.activePanelId,
        'right'
      );
      onAutoFloatRollbackSettled(snapshot.transferId);
    }
  }, [dockPanelGroup, onAutoFloatRollbackSettled, pendingAutoFloatRollbacks]);

  const restoreNativeTabSource = useCallback(
    (request: panelwindow.TabTransferRequest) => {
      if (request.sourceWindowName === request.ownerWindowName) {
        return;
      }
      commitPanelWindow(
        {
          ...singleTabGroupSnapshot(request),
          groupId: request.sourceGroupId,
        },
        request.sourceWindowName
      );
    },
    [commitPanelWindow]
  );

  const rollbackWorkspaceTabTarget = useCallback(
    (request: panelwindow.TabTransferRequest) => {
      detachPanelGroup(request.clusterId, [request.tab.panelId]);
      restoreNativeTabSource(request);
      acceptingTabDockRef.current.delete(request.transferId);
      setPendingTabDockRequests((current) => {
        if (!current.has(request.transferId)) {
          return current;
        }
        const next = new Map(current);
        next.delete(request.transferId);
        return next;
      });
    },
    [detachPanelGroup, restoreNativeTabSource]
  );

  useEffect(
    () =>
      onPanelTabTransferRequested(({ request }) => {
        if (request.ownerWindowName !== ownerWindowName) {
          return;
        }
        const owned = getOwnedPanel(request.clusterId, request.tab.panelId);
        const sourceGroup = getGroupForPanel(tabGroups, request.tab.panelId);
        const validSource =
          !!owned &&
          sameTransferredTab(owned, request.tab) &&
          (request.sourceWindowName === ownerWindowName
            ? !owned.nativeLocation && sourceGroup === request.sourceGroupId
            : owned.nativeLocation?.windowName === request.sourceWindowName &&
              owned.nativeLocation?.groupId === request.sourceGroupId);
        if (!validSource) {
          void failPanelTabTransfer(ownerWindowName, request.transferId);
          return;
        }
        if (request.sourceWindowName === ownerWindowName) {
          const blocker = guards.firstBlocker([request.tab.panelId]);
          if (blocker) {
            blocker.focus();
            void failPanelTabTransfer(ownerWindowName, request.transferId);
            return;
          }
        }

        if (request.targetKind === 'workspace') {
          if (request.targetGroupId !== 'right' && request.targetGroupId !== 'bottom') {
            void failPanelTabTransfer(ownerWindowName, request.transferId);
            return;
          }
          const snapshot = singleTabGroupSnapshot(request);
          dockPanelWindow(snapshot, request.targetGroupId);
          dockPanelGroup(
            request.clusterId,
            [request.tab.panelId],
            request.tab.panelId,
            request.targetGroupId,
            request.targetIndex
          );
          setPendingTabDockRequests((current) => {
            const next = new Map(current);
            next.set(request.transferId, request);
            return next;
          });
          return;
        }

        if (request.targetKind === 'panel-window') {
          void acceptPanelTabTransfer(ownerWindowName, request.transferId).catch((error) => {
            void failPanelTabTransfer(ownerWindowName, request.transferId);
            reportOperationalError(error, {
              source: 'WorkspacePanelCoordinator',
              action: 'accept-native-tab-target',
              clusterId: request.clusterId,
            });
          });
          return;
        }

        if (request.targetKind === 'new-window') {
          const snapshot = singleTabGroupSnapshot(request);
          const bounds = initialWindowBounds([request.tab.panelId]);
          if (bounds && (request.cursorX !== 0 || request.cursorY !== 0)) {
            bounds.x = request.cursorX - 120;
            bounds.y = request.cursorY - 24;
            snapshot.initialPositionAnchor = {
              x: request.cursorX,
              y: request.cursorY,
            };
            snapshot.useInitialPosition = true;
          }
          snapshot.initialBounds = bounds;
          void acceptPanelTabTransfer(ownerWindowName, request.transferId)
            .then(() => beginPanelWindowOpen(ownerWindowName, snapshot))
            .catch((error) => {
              void failPanelTabTransfer(ownerWindowName, request.transferId);
              reportOperationalError(error, {
                source: 'WorkspacePanelCoordinator',
                action: 'open-torn-off-tab',
                clusterId: request.clusterId,
              });
            });
        }
      }),
    [dockPanelGroup, dockPanelWindow, getOwnedPanel, guards, ownerWindowName, tabGroups]
  );

  useEffect(() => {
    const request = Array.from(pendingTabDockRequests.values()).find(
      (candidate) => !acceptingTabDockRef.current.has(candidate.transferId)
    );
    if (!request) {
      return;
    }
    if (selectedClusterId !== request.clusterId) {
      const selection = selectedKubeconfigs.find(
        (candidate) => getClusterMeta(candidate).id === request.clusterId
      );
      if (selection) {
        setActiveKubeconfig(selection);
      }
      return;
    }
    const target = request.targetGroupId === 'right' ? tabGroups.right : tabGroups.bottom;
    if (!target.tabs.includes(request.tab.panelId)) {
      return;
    }
    acceptingTabDockRef.current.add(request.transferId);
    void acceptPanelTabTransfer(ownerWindowName, request.transferId)
      .then(() => {
        acceptingTabDockRef.current.delete(request.transferId);
        setPendingTabDockRequests((current) => {
          const next = new Map(current);
          next.delete(request.transferId);
          return next;
        });
      })
      .catch((error) => {
        rollbackWorkspaceTabTarget(request);
        void failPanelTabTransfer(ownerWindowName, request.transferId);
        reportOperationalError(error, {
          source: 'WorkspacePanelCoordinator',
          action: 'commit-workspace-tab-target',
          clusterId: request.clusterId,
        });
      });
  }, [
    getClusterMeta,
    ownerWindowName,
    pendingTabDockRequests,
    rollbackWorkspaceTabTarget,
    selectedClusterId,
    selectedKubeconfigs,
    setActiveKubeconfig,
    tabGroups,
  ]);

  useEffect(
    () =>
      onPanelTabTransferCommitted(({ request }) => {
        if (request.ownerWindowName !== ownerWindowName) {
          return;
        }
        if (request.sourceWindowName === ownerWindowName) {
          detachPanelGroup(request.clusterId, [request.tab.panelId]);
        }
        acceptingTabDockRef.current.delete(request.transferId);
        setPendingTabDockRequests((current) => {
          if (!current.has(request.transferId)) {
            return current;
          }
          const next = new Map(current);
          next.delete(request.transferId);
          return next;
        });
      }),
    [detachPanelGroup, ownerWindowName]
  );

  useEffect(
    () =>
      onPanelTabTransferFailed(({ request }) => {
        if (request.ownerWindowName !== ownerWindowName) {
          return;
        }
        if (request.targetKind === 'workspace') {
          rollbackWorkspaceTabTarget(request);
        }
      }),
    [ownerWindowName, rollbackWorkspaceTabTarget]
  );

  useEffect(
    () =>
      onPanelWindowOpened((event) => {
        if (event.snapshot.ownerWindowName !== ownerWindowName) {
          return;
        }
        detachPanelGroup(
          event.snapshot.clusterId,
          (event.snapshot.tabs ?? []).map((tab) => tab.panelId)
        );
        onWindowOpened(event);
      }),
    [detachPanelGroup, onWindowOpened, ownerWindowName]
  );

  useEffect(
    () =>
      onPanelWindowDockRequested((event) => {
        if (
          event.snapshot.ownerWindowName !== ownerWindowName ||
          (event.targetPosition !== 'right' && event.targetPosition !== 'bottom')
        ) {
          return;
        }
        dockPanelGroup(
          event.snapshot.clusterId,
          (event.snapshot.tabs ?? []).map((tab) => tab.panelId),
          event.snapshot.activePanelId,
          event.targetPosition
        );
        onDockRequest(event, event.targetPosition);
      }),
    [dockPanelGroup, onDockRequest, ownerWindowName]
  );

  useEffect(
    () =>
      onPanelWindowClosed(({ windowName, clusterId, groupId }) => {
        const panelIds = panelIdsForPanelWindow(clusterId, windowName);
        discardPanelLayouts(clusterId, panelIds);
        removePanelWindow(clusterId, windowName);
        onOwnedPanelWindowClosed(windowName, groupId);
      }),
    [discardPanelLayouts, onOwnedPanelWindowClosed, panelIdsForPanelWindow, removePanelWindow]
  );

  const settleDockAttempt = useCallback(
    (request: panelwindow.WindowDockRequestedEvent, committed: boolean, error?: unknown) => {
      const key = `${request.windowName}\0${request.transferId}`;
      if (dockAttemptRef.current?.key !== key) {
        return;
      }
      window.clearTimeout(dockAttemptRef.current.timeout);
      dockAttemptRef.current = null;
      if (!committed) {
        detachPanelGroup(
          request.snapshot.clusterId,
          (request.snapshot.tabs ?? []).map((tab) => tab.panelId)
        );
      }
      onDockRequestSettled(request, committed);
      if (error) {
        reportOperationalError(error, {
          source: 'WorkspacePanelCoordinator',
          action: committed ? 'acknowledge-dock' : 'rollback-dock',
          clusterId: request.snapshot.clusterId,
        });
      }
    },
    [detachPanelGroup, onDockRequestSettled]
  );

  useEffect(() => {
    if (!pendingDockRequest) {
      return;
    }
    const key = `${pendingDockRequest.windowName}\0${pendingDockRequest.transferId}`;
    if (dockAttemptRef.current?.key !== key) {
      if (dockAttemptRef.current) {
        window.clearTimeout(dockAttemptRef.current.timeout);
      }
      const timeout = window.setTimeout(() => {
        if (dockAttemptRef.current?.key !== key) {
          return;
        }
        void failPanelWindowTransfer(
          ownerWindowName,
          pendingDockRequest.windowName,
          pendingDockRequest.transferId
        ).catch((error) =>
          reportOperationalError(error, {
            source: 'WorkspacePanelCoordinator',
            action: 'fail-dock-timeout',
            clusterId: pendingDockRequest.snapshot.clusterId,
          })
        );
        settleDockAttempt(
          pendingDockRequest,
          false,
          new Error(`Panel dock timed out for ${pendingDockRequest.windowName}`)
        );
      }, 15_000);
      dockAttemptRef.current = { key, timeout, acknowledging: false };
    }
    if (selectedClusterId !== pendingDockRequest.snapshot.clusterId) {
      const selection = selectedKubeconfigs.find(
        (candidate) => getClusterMeta(candidate).id === pendingDockRequest.snapshot.clusterId
      );
      if (selection) {
        setActiveKubeconfig(selection);
      }
      return;
    }
    const mountedPanelIds = new Set([...tabGroups.right.tabs, ...tabGroups.bottom.tabs]);
    if (
      !(pendingDockRequest.snapshot.tabs ?? []).every((tab) => mountedPanelIds.has(tab.panelId))
    ) {
      return;
    }
    const attempt = dockAttemptRef.current;
    if (attempt?.key !== key || attempt.acknowledging) {
      return;
    }
    attempt.acknowledging = true;
    void acknowledgePanelWindowDock(
      ownerWindowName,
      pendingDockRequest.windowName,
      pendingDockRequest.transferId
    )
      .then(() => settleDockAttempt(pendingDockRequest, true))
      .catch((error) => {
        void failPanelWindowTransfer(
          ownerWindowName,
          pendingDockRequest.windowName,
          pendingDockRequest.transferId
        );
        settleDockAttempt(pendingDockRequest, false, error);
      });
  }, [
    getClusterMeta,
    ownerWindowName,
    pendingDockRequest,
    selectedClusterId,
    selectedKubeconfigs,
    setActiveKubeconfig,
    settleDockAttempt,
    tabGroups,
  ]);

  useEffect(
    () => () => {
      if (dockAttemptRef.current) {
        window.clearTimeout(dockAttemptRef.current.timeout);
        dockAttemptRef.current = null;
      }
    },
    []
  );

  useEffect(() => {
    for (const claim of pendingObjectClaimsRef.current) {
      const separator = claim.indexOf('\0');
      const clusterId = claim.slice(0, separator);
      const panelId = claim.slice(separator + 1);
      if (getOwnedPanel(clusterId, panelId)) {
        pendingObjectClaimsRef.current.delete(claim);
      }
    }
  });

  useEffect(() => {
    const panelId = pendingDockedFocusRef.current;
    if (!panelId) {
      return;
    }
    const mounted =
      tabGroups.right.tabs.includes(panelId) || tabGroups.bottom.tabs.includes(panelId);
    if (!mounted) {
      return;
    }
    pendingDockedFocusRef.current = null;
    focusPanel(panelId);
    void focusWindow(ownerWindowName);
  }, [focusPanel, ownerWindowName, tabGroups]);

  useEffect(
    () =>
      onPanelObjectOpenRequested((event) => {
        if (event.ownerWindowName !== ownerWindowName) {
          return;
        }
        const objectRef = buildObjectPanelRef({ ...event.objectRef });
        const panelId = objectPanelId(objectRef);
        const claimKey = `${objectRef.clusterId}\0${panelId}`;
        const existing = getOwnedPanel(objectRef.clusterId, panelId);
        if (existing?.nativeLocation) {
          void focusPanelWindow(ownerWindowName, existing.nativeLocation.windowName, panelId).catch(
            (error) =>
              reportOperationalError(error, {
                source: 'WorkspacePanelCoordinator',
                action: 'focus-existing-native-object',
                clusterId: objectRef.clusterId,
              })
          );
          return;
        }

        const activateOwnerCluster = () => {
          const selection = selectedKubeconfigs.find(
            (candidate) => getClusterMeta(candidate).id === objectRef.clusterId
          );
          if (selection) {
            setActiveKubeconfig(selection);
          }
          pendingDockedFocusRef.current = panelId;
        };

        if (existing) {
          activateOwnerCluster();
          return;
        }

        if (pendingObjectClaimsRef.current.has(claimKey)) {
          return;
        }
        pendingObjectClaimsRef.current.add(claimKey);

        if (objectRef.clusterId !== event.objectRef.clusterId) {
          pendingObjectClaimsRef.current.delete(claimKey);
          return;
        }
        if (objectRef.clusterId === event.clusterId) {
          void authorizePanelObjectOpen(
            ownerWindowName,
            event.sourceWindowName,
            panelId,
            event.objectRef,
            event.activeView
          ).catch((error) => {
            pendingObjectClaimsRef.current.delete(claimKey);
            reportOperationalError(error, {
              source: 'WorkspacePanelCoordinator',
              action: 'authorize-panel-object-open',
              clusterId: objectRef.clusterId,
            });
          });
          return;
        }

        if (!selectedClusterIds.includes(objectRef.clusterId)) {
          pendingObjectClaimsRef.current.delete(claimKey);
          reportOperationalError(
            new Error(`Open cluster ${objectRef.clusterId} before opening this object`),
            {
              source: 'WorkspacePanelCoordinator',
              action: 'reject-cross-cluster-panel-object',
              clusterId: objectRef.clusterId,
            }
          );
          return;
        }
        upsertOwnedPanel(objectRef, event.activeView as ViewType, {
          kind: 'docked',
          edge: 'right',
        });
        activateOwnerCluster();
      }),
    [
      getClusterMeta,
      getOwnedPanel,
      ownerWindowName,
      selectedClusterIds,
      selectedKubeconfigs,
      setActiveKubeconfig,
      upsertOwnedPanel,
    ]
  );

  return children;
}
