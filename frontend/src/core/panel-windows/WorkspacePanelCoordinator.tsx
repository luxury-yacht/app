import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { panelwindow } from '@/core/backend-api/models';
import { getWindowIdentity } from '@/core/desktop-runtime';
import { getObjectPanelLayoutDefaults } from '@/core/settings/appPreferences';
import { useKubeconfig } from '@/modules/kubernetes/config/KubeconfigContext';
import {
  useObjectPanelActiveTabs,
  useObjectPanelState,
} from '@/modules/object-panel/contexts/ObjectPanelStateContext';
import type { DockPosition } from '@/ui/dockable';
import { DockablePanelProvider, useDockablePanelContext } from '@/ui/dockable';
import { getGroupForPanel } from '@/ui/dockable/tabGroupState';
import type { GroupKey } from '@/ui/dockable/tabGroupTypes';
import { reportOperationalError } from '@/utils/errorHandler';
import { ClusterTabTransferCoordinator } from './ClusterTabTransferCoordinator';
import { canMoveClusterToNewWindow } from './clusterTabTransferPolicy';
import {
  acceptPanelTabTransfer,
  acknowledgePanelWindowDock,
  beginPanelWindowOpen,
  failPanelTabTransfer,
  failPanelWindowTransfer,
  onPanelTabTransferCommitted,
  onPanelTabTransferFailed,
  onPanelTabTransferInsertRequested,
  onPanelTabTransferRequested,
  onPanelWindowClosed,
  onPanelWindowDockRequested,
  onPanelWindowOpened,
  onPanelWindowTransferFailed,
  onPanelWorkspaceFocusRequested,
  requestClusterTabTransfer,
  requestPanelTabTransfer,
} from './index';
import { usePanelLifecycleGuardRegistry } from './panelLifecycleGuards';
import { requestPanelTabMove } from './panelTabActions';
import { workspacePanelPublication } from './publicationQueue';
import {
  type DockableTabDragPayload,
  objectPanelTabSnapshot,
  singleTabGroupSnapshot,
  tabTransferRequestFromDragPayload,
  tornOffTabSnapshot,
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

type OwnedPanel = Parameters<typeof sameTransferredTab>[0];

const isAuthoritativeTransferSource = (
  request: panelwindow.TabTransferRequest,
  owned: OwnedPanel | null,
  sourceGroup: GroupKey | null,
  windowName: string
): boolean => {
  if (!owned || !sameTransferredTab(owned, request.tab)) {
    return false;
  }
  if (request.sourceWindowName === windowName) {
    return !owned.nativeLocation && sourceGroup === request.sourceGroupId;
  }
  return (
    owned.nativeLocation?.windowName === request.sourceWindowName &&
    owned.nativeLocation.groupId === request.sourceGroupId
  );
};

import { WorkspacePanelLifecycle } from './WorkspacePanelLifecycle';
import { usePanelWorkspaceSync, WorkspacePanelSync } from './WorkspacePanelSync';
export function WorkspacePanelCoordinator({ children }: Readonly<{ children: React.ReactNode }>) {
  const windowName = getWindowIdentity();
  const { openPanels, pendingNativeOpenPanelIds, dockPanelWindow, removeOwnedPanel } =
    useObjectPanelState();
  const activeTabs = useObjectPanelActiveTabs();
  const { selectedClusterId, selectedClusterIds } = useKubeconfig();
  const guards = usePanelLifecycleGuardRegistry();
  const [pendingDockRequest, setPendingDockRequest] =
    useState<panelwindow.WindowDockRequestedEvent | null>(null);
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
      setPendingAutoFloatRollbacks((current) => [...current, snapshot]);
    },
    [dockPanelWindow]
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
        sourceWindowName: windowName,
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
      guards.freeze(snapshot.transferId, group.tabs);
      void workspacePanelPublication
        .flush()
        .then(() => beginPanelWindowOpen(windowName, snapshot))
        .catch((error) => {
          guards.releaseTransfer(snapshot.transferId);
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
    [activeTabs, guards, openPanels, windowName, pendingNativeOpenPanelIds, queueAutoFloatRollback]
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
      windowName,
      clusterId: selectedClusterId,
      getTabSnapshot,
    }),
    [getTabSnapshot, windowName, selectedClusterId]
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
        targetWindowName: windowName,
        targetGroupId,
        targetIndex: insertIndex,
        targetKind: 'workspace' as panelwindow.TabTransferTarget,
      });
      if (!request) {
        return;
      }
      void requestPanelTabTransfer(windowName, request).catch((error) =>
        reportOperationalError(error, {
          source: 'WorkspacePanelCoordinator',
          action: 'request-tab-drop',
          clusterId: request.clusterId,
        })
      );
    },
    [windowName]
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
      if (request?.sourceWindowName !== windowName) {
        return;
      }
      void requestPanelTabTransfer(windowName, request).catch((error) =>
        reportOperationalError(error, {
          source: 'WorkspacePanelCoordinator',
          action: 'tear-off-tab',
          clusterId: request.clusterId,
        })
      );
    },
    [windowName]
  );

  const handlePanelWindowOpened = useCallback(
    (event: panelwindow.WindowOpenedEvent) => {
      const pending = pendingFloatGroupIdsRef.current.get(event.groupId);
      if (pending) {
        pendingFloatGroupsRef.current.delete(pending.sourceGroup);
        pendingFloatGroupIdsRef.current.delete(event.groupId);
      }
      for (const tab of event.snapshot.tabs ?? []) {
        removeOwnedPanel(event.clusterId, tab.panelId);
      }
      guards.releaseTransfer(event.snapshot.transferId);
    },
    [removeOwnedPanel, guards.releaseTransfer]
  );
  const handlePanelWindowClosed = useCallback(
    (_windowName: string, groupId?: string) => {
      const pending = groupId ? pendingFloatGroupIdsRef.current.get(groupId) : undefined;
      if (!pending || !groupId) {
        return;
      }
      guards.releaseTransfer(pending.snapshot.transferId);
      pendingFloatGroupsRef.current.delete(pending.sourceGroup);
      pendingFloatGroupIdsRef.current.delete(groupId);
      if (pending.autoFloat) {
        queueAutoFloatRollback(pending.snapshot);
      }
    },
    [queueAutoFloatRollback, guards.releaseTransfer]
  );
  const handleDockRequest = useCallback(
    (request: panelwindow.WindowDockRequestedEvent, edge: 'right' | 'bottom') => {
      dockPanelWindow(request.snapshot, edge);
      setPendingDockRequest(request);
    },
    [dockPanelWindow]
  );
  const handleDockRequestSettled = useCallback(
    (request: panelwindow.WindowDockRequestedEvent, committed: boolean) => {
      if (!committed) {
        for (const tab of request.snapshot.tabs ?? []) {
          removeOwnedPanel(request.snapshot.clusterId, tab.panelId);
        }
      }
      setPendingDockRequest((current) =>
        current?.transferId === request.transferId ? null : current
      );
    },
    [removeOwnedPanel]
  );
  const handleAutoFloatRollbackSettled = useCallback((transferId: string) => {
    setPendingAutoFloatRollbacks((current) =>
      current.filter((snapshot) => snapshot.transferId !== transferId)
    );
  }, []);
  return (
    <DockablePanelProvider
      onGroupMoveRequest={handleGroupMove}
      onTabMoveRequest={(payload, target) => {
        void requestPanelTabMove(payload, target, workspacePanelPublication, windowName).catch(
          (error) =>
            reportOperationalError(error, {
              source: 'WorkspacePanelCoordinator',
              action: 'move-panel-tab',
              clusterId: payload.clusterId,
            })
        );
      }}
      tabDragIdentity={tabDragIdentity}
      onClusterTabTearOff={(payload, cursor) => {
        if (
          payload.sourceWindowName !== windowName ||
          !canMoveClusterToNewWindow(payload.clusterId, selectedClusterIds)
        ) {
          return;
        }
        void requestClusterTabTransfer(windowName, {
          transferId: newIdentity('cluster-transfer'),
          dropPosition: { x: Math.round(cursor.x), y: Math.round(cursor.y) },
          sourceWindowName: windowName,
          targetWindowName: '',
          clusterId: payload.clusterId,
          targetIndex: 0,
        }).catch((error) =>
          reportOperationalError(error, {
            source: 'WorkspacePanelCoordinator',
            action: 'tear-off-cluster',
            clusterId: payload.clusterId,
          })
        );
      }}
      onExternalTabDrop={handleExternalTabDrop}
      onTabTearOff={handleTabTearOff}
      canStartTabDrag={canStartTabDrag}
    >
      <WorkspacePanelSync>
        <WorkspacePanelLifecycle />
        <ClusterTabTransferCoordinator />
        <WorkspaceObjectRouteCoordinator
          windowName={windowName}
          pendingDockRequest={pendingDockRequest}
          pendingAutoFloatRollbacks={pendingAutoFloatRollbacks}
          onWindowOpened={handlePanelWindowOpened}
          onDockRequest={handleDockRequest}
          onDockRequestSettled={handleDockRequestSettled}
          onOwnedPanelWindowClosed={handlePanelWindowClosed}
          onAutoFloatRollbackSettled={handleAutoFloatRollbackSettled}
        >
          {children}
        </WorkspaceObjectRouteCoordinator>
      </WorkspacePanelSync>
    </DockablePanelProvider>
  );
}
function WorkspaceObjectRouteCoordinator({
  windowName,
  pendingDockRequest,
  pendingAutoFloatRollbacks,
  onWindowOpened,
  onDockRequest,
  onDockRequestSettled,
  onOwnedPanelWindowClosed,
  onAutoFloatRollbackSettled,
  children,
}: Readonly<{
  windowName: string;
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
  const { dockPanelWindow, getOwnedPanel, removeOwnedPanel } = useObjectPanelState();
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
  const pendingTargets = useRef(new Map<string, panelwindow.TabTransferRequest>());
  const pendingDockedFocusRef = useRef<string | null>(null);
  const sync = usePanelWorkspaceSync();
  const flushPublication = sync.flush;
  const dockAttemptRef = useRef<{ key: string; timeout: number; acknowledging: boolean } | null>(
    null
  );
  const activateCluster = useCallback(
    (clusterId: string) => {
      const selection = selectedKubeconfigs.find(
        (candidate) => getClusterMeta(candidate).id === clusterId
      );
      if (selection) {
        setActiveKubeconfig(selection);
      }
    },
    [selectedKubeconfigs, getClusterMeta, setActiveKubeconfig]
  );
  const removeLocalTabs = useCallback(
    (clusterId: string, ids: string[]) => {
      detachPanelGroup(clusterId, ids);
      discardPanelLayouts(clusterId, ids);
      for (const id of ids) {
        removeOwnedPanel(clusterId, id);
      }
    },
    [detachPanelGroup, discardPanelLayouts, removeOwnedPanel]
  );

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
  }, [pendingAutoFloatRollbacks, dockPanelGroup, onAutoFloatRollbackSettled]);

  useEffect(
    () =>
      onPanelTabTransferRequested(({ request }) => {
        if (request.sourceWindowName !== windowName) {
          return;
        }
        const owned = getOwnedPanel(request.clusterId, request.tab.panelId);
        const sourceGroup = getGroupForPanel(tabGroups, request.tab.panelId);
        const blocker = guards.firstBlocker([request.tab.panelId]);
        if (
          guards.isFrozen() ||
          !isAuthoritativeTransferSource(request, owned, sourceGroup, windowName) ||
          blocker
        ) {
          blocker?.focus();
          void failPanelTabTransfer(windowName, request.transferId);
          return;
        }
        guards.freeze(request.transferId, [request.tab.panelId]);
        void flushPublication()
          .then(() => acceptPanelTabTransfer(windowName, request.transferId))
          .then(() => {
            if (request.targetKind === 'new-window') {
              return beginPanelWindowOpen(
                windowName,
                tornOffTabSnapshot(request, initialWindowBounds([request.tab.panelId]))
              );
            }
          })
          .catch((error) => {
            void failPanelTabTransfer(windowName, request.transferId);
            reportOperationalError(error, {
              source: 'WorkspacePanelCoordinator',
              action: 'accept-tab-transfer',
              clusterId: request.clusterId,
            });
          });
      }),
    [windowName, getOwnedPanel, tabGroups, guards, flushPublication]
  );

  useEffect(
    () =>
      onPanelTabTransferInsertRequested(({ request }) => {
        if (request.targetWindowName !== windowName) {
          return;
        }
        if (
          guards.isFrozen(request.transferId) ||
          !selectedClusterIds.includes(request.clusterId) ||
          (request.targetGroupId !== 'right' && request.targetGroupId !== 'bottom') ||
          getOwnedPanel(request.clusterId, request.tab.panelId)
        ) {
          void failPanelTabTransfer(windowName, request.transferId);
          return;
        }
        guards.freeze(request.transferId, [request.tab.panelId]);
        sync.stage(request.transferId, [
          {
            clusterId: request.clusterId,
            groupId: request.targetGroupId,
            tabs: [request.tab],
            activePanelId: request.tab.panelId,
          },
        ]);
        pendingTargets.current.set(request.transferId, request);
        activateCluster(request.clusterId);
        dockPanelWindow(singleTabGroupSnapshot(request), request.targetGroupId);
        dockPanelGroup(
          request.clusterId,
          [request.tab.panelId],
          request.tab.panelId,
          request.targetGroupId,
          request.targetIndex
        );
      }),
    [
      windowName,
      selectedClusterIds,
      getOwnedPanel,
      activateCluster,
      dockPanelWindow,
      dockPanelGroup,
      guards,
      sync.stage,
    ]
  );

  useEffect(
    () =>
      onPanelTabTransferCommitted(({ request }) => {
        guards.releaseTransfer(request.transferId);
        sync.settle(request.transferId);
        pendingTargets.current.delete(request.transferId);
        if (request.sourceWindowName === windowName) {
          removeLocalTabs(request.clusterId, [request.tab.panelId]);
        }
      }),
    [windowName, removeLocalTabs, guards.releaseTransfer, sync.settle]
  );
  useEffect(
    () =>
      onPanelTabTransferFailed(({ request }) => {
        guards.releaseTransfer(request.transferId);
        sync.settle(request.transferId);
        if (!pendingTargets.current.delete(request.transferId)) {
          return;
        }
        removeLocalTabs(request.clusterId, [request.tab.panelId]);
      }),
    [removeLocalTabs, sync.settle, guards.releaseTransfer]
  );
  useEffect(
    () =>
      onPanelWindowOpened((event) => {
        if (event.snapshot.sourceWindowName !== windowName) {
          return;
        }
        const ids = (event.snapshot.tabs ?? []).map((tab) => tab.panelId);
        detachPanelGroup(event.snapshot.clusterId, ids);
        discardPanelLayouts(event.snapshot.clusterId, ids);
        onWindowOpened(event);
      }),
    [windowName, detachPanelGroup, discardPanelLayouts, onWindowOpened]
  );
  useEffect(
    () =>
      onPanelWindowDockRequested((event) => {
        if (guards.isFrozen(event.transferId)) {
          void failPanelWindowTransfer(windowName, event.windowName, event.transferId).catch(
            (error) =>
              reportOperationalError(error, {
                source: 'WorkspacePanelCoordinator',
                action: 'reject-dock-during-close',
                clusterId: event.snapshot.clusterId,
              })
          );
          return;
        }
        if (
          !selectedClusterIds.includes(event.snapshot.clusterId) ||
          (event.targetPosition !== 'right' && event.targetPosition !== 'bottom')
        ) {
          return;
        }
        guards.freeze(
          event.transferId,
          (event.snapshot.tabs ?? []).map((tab) => tab.panelId)
        );
        sync.stage(event.transferId, [
          {
            clusterId: event.snapshot.clusterId,
            groupId: event.targetPosition,
            tabs: event.snapshot.tabs,
            activePanelId: event.snapshot.activePanelId,
          },
        ]);
        dockPanelGroup(
          event.snapshot.clusterId,
          (event.snapshot.tabs ?? []).map((tab) => tab.panelId),
          event.snapshot.activePanelId,
          event.targetPosition
        );
        onDockRequest(event, event.targetPosition);
      }),
    [selectedClusterIds, dockPanelGroup, onDockRequest, sync.stage, guards, windowName]
  );
  useEffect(
    () =>
      onPanelWindowClosed(({ windowName: closedWindowName, groupId }) =>
        onOwnedPanelWindowClosed(closedWindowName, groupId)
      ),
    [onOwnedPanelWindowClosed]
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
        const panelIds = (request.snapshot.tabs ?? []).map((tab) => tab.panelId);
        detachPanelGroup(request.snapshot.clusterId, panelIds);
        discardPanelLayouts(request.snapshot.clusterId, panelIds);
      }
      guards.releaseTransfer(request.transferId);
      sync.settle(request.transferId);
      onDockRequestSettled(request, committed);
      if (error) {
        reportOperationalError(error, {
          source: 'WorkspacePanelCoordinator',
          action: committed ? 'acknowledge-dock' : 'rollback-dock',
          clusterId: request.snapshot.clusterId,
        });
      }
    },
    [
      detachPanelGroup,
      discardPanelLayouts,
      onDockRequestSettled,
      sync.settle,
      guards.releaseTransfer,
    ]
  );

  useEffect(
    () =>
      onPanelWindowTransferFailed((event) => {
        if (event.transferId !== pendingDockRequest?.transferId) {
          return;
        }
        settleDockAttempt(pendingDockRequest, false);
      }),
    [pendingDockRequest, settleDockAttempt]
  );

  const beginDockAttempt = useCallback(
    (request: panelwindow.WindowDockRequestedEvent, key: string) => {
      if (dockAttemptRef.current?.key !== key) {
        if (dockAttemptRef.current) {
          window.clearTimeout(dockAttemptRef.current.timeout);
        }
        const timeout = window.setTimeout(() => {
          if (dockAttemptRef.current?.key !== key || dockAttemptRef.current.acknowledging) {
            return;
          }
          void failPanelWindowTransfer(windowName, request.windowName, request.transferId).catch(
            (error) =>
              reportOperationalError(error, {
                source: 'WorkspacePanelCoordinator',
                action: 'fail-dock-timeout',
                clusterId: request.snapshot.clusterId,
              })
          );
          settleDockAttempt(
            request,
            false,
            new Error(`Panel dock timed out for ${request.windowName}`)
          );
        }, 15_000);
        dockAttemptRef.current = { key, timeout, acknowledging: false };
      }
    },
    [windowName, settleDockAttempt]
  );

  useEffect(() => {
    if (!pendingDockRequest) {
      return;
    }
    const key = `${pendingDockRequest.windowName}\0${pendingDockRequest.transferId}`;
    beginDockAttempt(pendingDockRequest, key);
    if (selectedClusterId !== pendingDockRequest.snapshot.clusterId) {
      activateCluster(pendingDockRequest.snapshot.clusterId);
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
    void flushPublication()
      .then(() =>
        acknowledgePanelWindowDock(
          windowName,
          pendingDockRequest.windowName,
          pendingDockRequest.transferId
        )
      )
      .then(() => settleDockAttempt(pendingDockRequest, true))
      .catch((error) => {
        void failPanelWindowTransfer(
          windowName,
          pendingDockRequest.windowName,
          pendingDockRequest.transferId
        );
        settleDockAttempt(pendingDockRequest, false, error);
      });
  }, [
    beginDockAttempt,
    windowName,
    pendingDockRequest,
    selectedClusterId,
    settleDockAttempt,
    flushPublication,
    tabGroups,
    activateCluster,
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

  useEffect(
    () =>
      onPanelWorkspaceFocusRequested(({ clusterId, panelId }) => {
        activateCluster(clusterId);
        pendingDockedFocusRef.current = panelId;
        if (getGroupForPanel(tabGroups, panelId)) {
          pendingDockedFocusRef.current = null;
          focusPanel(panelId);
        }
      }),
    [activateCluster, focusPanel, tabGroups]
  );
  useEffect(() => {
    const panelId = pendingDockedFocusRef.current;
    if (panelId && getGroupForPanel(tabGroups, panelId)) {
      pendingDockedFocusRef.current = null;
      focusPanel(panelId);
    }
  }, [tabGroups, focusPanel]);
  return children;
}
