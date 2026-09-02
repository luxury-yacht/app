import type React from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
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
import type { GroupKey } from '@/ui/dockable/tabGroupTypes';
import { reportOperationalError } from '@/utils/errorHandler';
import {
  acknowledgeApplicationQuitPreflight,
  acknowledgePanelWindowDock,
  acknowledgeWorkspaceWindowClose,
  authorizePanelObjectOpen,
  authorizePanelTabClose,
  beginPanelWindowOpen,
  failPanelWindowTransfer,
  focusPanelWindow,
  onApplicationQuitPreflightRequested,
  onOwnerCloseRequested,
  onPanelObjectOpenRequested,
  onPanelTabCloseRequested,
  onPanelWindowClosed,
  onPanelWindowDockRequested,
  onPanelWindowGuardResult,
  onPanelWindowOpened,
  onPanelWindowSnapshotUpdated,
  requestPanelWindowClose,
  requestPanelWindowGuard,
} from './index';
import { usePanelLifecycleGuardRegistry } from './panelLifecycleGuards';

const newIdentity = (prefix: string): string =>
  `${prefix}-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`;

const objectSnapshot = (
  panelId: string,
  objectRef: ReturnType<typeof useObjectPanelState>['openPanels'] extends Map<string, infer Ref>
    ? Ref
    : never,
  activeView: string
): panelwindow.TabSnapshot => ({
  kind: 'object' as panelwindow.TabKind,
  panelId,
  objectRef: {
    clusterId: objectRef.clusterId,
    group: objectRef.group,
    version: objectRef.version,
    kind: objectRef.kind,
    namespace: objectRef.namespace ?? '',
    name: objectRef.name,
  },
  activeView,
});

const initialWindowBounds = (panelIds: readonly string[]): panelwindow.WindowBounds | undefined => {
  if (typeof document === 'undefined') {
    return undefined;
  }
  const sourceTab = Array.from(
    document.querySelectorAll<HTMLElement>('[role="tab"][data-panel-id]')
  ).find((element) => panelIds.includes(element.dataset.panelId ?? ''));
  const panel = sourceTab?.closest<HTMLElement>('[data-dockable-group-key]');
  if (!panel) {
    return undefined;
  }
  const rect = panel.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
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

export function WorkspacePanelCoordinator({ children }: Readonly<{ children: React.ReactNode }>) {
  const ownerWindowName = getWindowIdentity();
  const {
    openPanels,
    nativeLocations,
    commitPanelWindow,
    dockPanelWindow,
    getOwnedPanel,
    panelIdsForCluster,
    nativeWindowNamesForCluster,
    syncPanelWindowSnapshot,
    removeOwnedPanel,
    upsertOwnedPanel,
  } = useObjectPanelState();
  const activeTabs = useObjectPanelActiveTabs();
  const { registerClusterClosePreflight } = useKubeconfig();
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
  const pendingFloatGroupIdsRef = useRef(new Map<string, GroupKey>());

  const settleApplicationQuit = useCallback(
    (transactionId: string, allowed: boolean, error?: unknown) => {
      const pending = pendingApplicationQuitRef.current;
      if (!pending || pending.transactionId !== transactionId) {
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
      pendingFloatGroupsRef.current.add(group.groupKey);
      pendingFloatGroupIdsRef.current.set(groupId, group.groupKey);
      void beginPanelWindowOpen(ownerWindowName, snapshot).catch((error) => {
        pendingFloatGroupsRef.current.delete(group.groupKey);
        pendingFloatGroupIdsRef.current.delete(groupId);
        reportOperationalError(error, {
          source: 'WorkspacePanelCoordinator',
          action: 'float-group',
        });
      });
      return true;
    },
    [activeTabs, guards, openPanels, ownerWindowName]
  );

  const handlePanelWindowOpened = useCallback(
    (event: panelwindow.WindowOpenedEvent) => {
      const sourceGroup = pendingFloatGroupIdsRef.current.get(event.groupId);
      if (sourceGroup) {
        pendingFloatGroupsRef.current.delete(sourceGroup);
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
        const existing = getOwnedPanel(event.clusterId, event.panelId);
        if (!existing) {
          return;
        }
        removeOwnedPanel(event.clusterId, event.panelId);
        void authorizePanelTabClose(ownerWindowName, event.sourceWindowName, event.panelId).catch(
          (error) => {
            upsertOwnedPanel(
              existing.objectRef,
              existing.activeView,
              existing.nativeLocation
                ? {
                    kind: 'panel-window',
                    windowName: existing.nativeLocation.windowName,
                    groupId: existing.nativeLocation.groupId,
                  }
                : { kind: 'docked', edge: existing.dockedEdge ?? 'right' }
            );
            reportOperationalError(error, {
              source: 'WorkspacePanelCoordinator',
              action: 'authorize-panel-tab-close',
              clusterId: event.clusterId,
            });
          }
        );
      }),
    [getOwnedPanel, ownerWindowName, removeOwnedPanel, upsertOwnedPanel]
  );

  const handlePanelWindowDockRequested = useCallback(
    (event: panelwindow.WindowDockRequestedEvent, targetPosition: 'right' | 'bottom') => {
      dockPanelWindow(event.snapshot, targetPosition);
      setPendingDockRequest(event);
    },
    [dockPanelWindow]
  );

  const handlePanelWindowClosed = useCallback((windowName: string, groupId?: string) => {
    if (groupId) {
      const sourceGroup = pendingFloatGroupIdsRef.current.get(groupId);
      if (sourceGroup) {
        pendingFloatGroupsRef.current.delete(sourceGroup);
        pendingFloatGroupIdsRef.current.delete(groupId);
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
    <DockablePanelProvider onGroupMoveRequest={handleGroupMove}>
      <WorkspaceObjectRouteCoordinator
        ownerWindowName={ownerWindowName}
        pendingDockRequest={pendingDockRequest}
        onWindowOpened={handlePanelWindowOpened}
        onDockRequest={handlePanelWindowDockRequested}
        onDockRequestSettled={handleDockRequestSettled}
        onOwnedPanelWindowClosed={handlePanelWindowClosed}
      >
        {children}
      </WorkspaceObjectRouteCoordinator>
    </DockablePanelProvider>
  );
}

function WorkspaceObjectRouteCoordinator({
  ownerWindowName,
  pendingDockRequest,
  onWindowOpened,
  onDockRequest,
  onDockRequestSettled,
  onOwnedPanelWindowClosed,
  children,
}: Readonly<{
  ownerWindowName: string;
  pendingDockRequest: panelwindow.WindowDockRequestedEvent | null;
  onWindowOpened: (event: panelwindow.WindowOpenedEvent) => void;
  onDockRequest: (
    request: panelwindow.WindowDockRequestedEvent,
    targetPosition: 'right' | 'bottom'
  ) => void;
  onDockRequestSettled: (request: panelwindow.WindowDockRequestedEvent, committed: boolean) => void;
  onOwnedPanelWindowClosed: (windowName: string, groupId?: string) => void;
  children: React.ReactNode;
}>) {
  const {
    getOwnedPanel,
    upsertOwnedPanel,
    removeOwnedPanel,
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
  const pendingDockedFocusRef = useRef<string | null>(null);
  const pendingObjectClaimsRef = useRef(new Set<string>());
  const dockAttemptRef = useRef<{
    key: string;
    timeout: number;
    acknowledging: boolean;
  } | null>(null);

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
    if (!attempt || attempt.key !== key || attempt.acknowledging) {
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
          return;
        }
        if (objectRef.clusterId === event.clusterId) {
          upsertOwnedPanel(objectRef, event.activeView as ViewType, {
            kind: 'panel-window',
            windowName: event.sourceWindowName,
            groupId: event.groupId,
          });
          void authorizePanelObjectOpen(
            ownerWindowName,
            event.sourceWindowName,
            panelId,
            event.objectRef,
            event.activeView
          ).catch((error) => {
            pendingObjectClaimsRef.current.delete(claimKey);
            removeOwnedPanel(objectRef.clusterId, panelId);
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
      removeOwnedPanel,
      selectedClusterIds,
      selectedKubeconfigs,
      setActiveKubeconfig,
      upsertOwnedPanel,
    ]
  );

  return children;
}
