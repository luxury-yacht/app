import { AppearanceModeProvider } from '@core/contexts/AppearanceModeContext';
import { AuthErrorProvider } from '@core/contexts/AuthErrorContext';
import { ClusterLifecycleProvider } from '@core/contexts/ClusterLifecycleContext';
import { ErrorProvider } from '@core/contexts/ErrorContext';
import { ZoomProvider } from '@core/contexts/ZoomContext';
import { RefreshManagerProvider } from '@core/refresh';
import { FixedClusterProvider } from '@modules/kubernetes/config/KubeconfigContext';
import { NamespaceProvider } from '@modules/namespace/contexts/NamespaceContext';
import ObjectPanel from '@modules/object-panel/components/ObjectPanel/ObjectPanel';
import {
  ObjectPanelStateProvider,
  useObjectPanelActiveTabs,
  useObjectPanelState,
} from '@modules/object-panel/contexts/ObjectPanelStateContext';
import { ErrorNotificationSystem } from '@shared/components/errors/ErrorNotificationSystem';
import { DockablePanelProvider } from '@ui/dockable';
import type { TabGroupState } from '@ui/dockable/tabGroupTypes';
import { AppErrorBoundary, PanelErrorBoundary } from '@ui/errors';
import AppHeader from '@ui/layout/AppHeader';
import { KeyboardProvider } from '@ui/shortcuts';
import TextContextMenu from '@ui/shortcuts/components/TextContextMenu';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { panelwindow } from '@/core/backend-api/models';
import { useClusterWorkspaceSnapshot } from '@/core/cluster-workspace/useClusterWorkspace';
import {
  acknowledgePanelWindowReady,
  beginPanelWindowDock,
  failPanelWindowTransfer,
  onPanelWindowTransferFailed,
  type PanelWindowDescriptor,
  requestPanelTabClose,
  requestPanelTabTransfer,
} from '@/core/panel-windows';
import { PanelWindowRoleProvider } from '@/core/panel-windows/PanelWindowRoleContext';
import {
  PanelLifecycleGuardProvider,
  usePanelLifecycleGuardRegistry,
} from '@/core/panel-windows/panelLifecycleGuards';
import { resolvePanelWindowClusterName } from '@/core/panel-windows/panelWindowClusterName';
import { nativePanelPublication } from '@/core/panel-windows/publicationQueue';
import {
  type DockableTabDragPayload,
  objectPanelTabSnapshot,
  tabTransferRequestFromDragPayload,
} from '@/core/panel-windows/tabTransfer';
import { PanelWindowShortcuts } from '@/ui/shortcuts/components/PanelWindowShortcuts';
import { reportOperationalError } from '@/utils/errorHandler';
import '@styles/index.css';
import './App.css';
import './PanelWindowApp.css';

const acknowledgedTransfers = new Set<string>();

const initialGroups = (snapshot: panelwindow.GroupSnapshot): TabGroupState => ({
  right: {
    tabs: snapshot.tabs?.map((tab) => tab.panelId) ?? [],
    activeTab: snapshot.activePanelId,
  },
  bottom: { tabs: [], activeTab: null },
  floating: [],
});

const createTransferId = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `panel-transfer-${Date.now()}`;

function PanelWindowSurface({
  descriptor,
  clusterName,
}: Readonly<{ descriptor: PanelWindowDescriptor; clusterName: string }>) {
  const { openPanels } = useObjectPanelState();
  const activeTabs = useObjectPanelActiveTabs();
  const guards = usePanelLifecycleGuardRegistry();
  const [ready, setReady] = useState(false);
  useEffect(
    () =>
      onPanelWindowTransferFailed((event) => {
        if (event.windowName === descriptor.windowName) {
          guards.releaseTransfer(event.transferId);
        }
      }),
    [descriptor.windowName, guards]
  );
  const initialTabGroups = useMemo(() => initialGroups(descriptor.snapshot), [descriptor.snapshot]);

  const requestTabClose = useCallback(
    (panelId: string) => {
      void requestPanelTabClose(descriptor.windowName, panelId).catch((error) =>
        reportOperationalError(error, {
          source: 'PanelWindowApp',
          action: 'request-tab-close',
          clusterId: descriptor.clusterId,
        })
      );
    },
    [descriptor.clusterId, descriptor.windowName]
  );

  useEffect(() => {
    if (acknowledgedTransfers.has(descriptor.snapshot.transferId)) {
      return;
    }
    acknowledgedTransfers.add(descriptor.snapshot.transferId);
    const acknowledgeReady = async () => {
      try {
        await acknowledgePanelWindowReady(descriptor.windowName, descriptor.snapshot.transferId);
        setReady(true);
      } catch (error) {
        acknowledgedTransfers.delete(descriptor.snapshot.transferId);
        try {
          await failPanelWindowTransfer(
            descriptor.windowName,
            descriptor.windowName,
            descriptor.snapshot.transferId
          );
        } catch (cleanupError) {
          reportOperationalError(cleanupError, {
            source: 'PanelWindowApp',
            action: 'fail-ready-transfer',
          });
        }
        reportOperationalError(error, { source: 'PanelWindowApp', action: 'acknowledge-ready' });
      }
    };
    void acknowledgeReady();
  }, [descriptor]);

  const handleGroupMove = useCallback(
    (
      group: { tabs: string[]; activeTab: string | null },
      targetPosition: 'right' | 'bottom' | 'floating'
    ): undefined => {
      if (targetPosition !== 'floating') {
        const blocker = guards.firstBlocker(group.tabs);
        if (blocker) {
          blocker.focus();
        } else {
          const snapshot: panelwindow.GroupSnapshot = {
            schemaVersion: 1,
            transferId: createTransferId(),
            sourceWindowName: descriptor.windowName,
            clusterId: descriptor.clusterId,
            groupId: descriptor.groupId,
            tabs: group.tabs.flatMap((panelId) => {
              const objectRef = openPanels.get(panelId);
              return objectRef
                ? [
                    {
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
                      activeView: activeTabs.get(panelId) ?? 'details',
                    },
                  ]
                : [];
            }),
            activePanelId: group.activeTab ?? group.tabs[0] ?? '',
          };
          guards.freeze(snapshot.transferId, group.tabs);
          void nativePanelPublication
            .flush()
            .then(() => beginPanelWindowDock(descriptor.windowName, targetPosition, snapshot))
            .catch((error) => {
              guards.releaseTransfer(snapshot.transferId);
              reportOperationalError(error, { source: 'PanelWindowApp', action: 'dock-group' });
            });
        }
      }
    },
    [activeTabs, descriptor, guards, openPanels]
  );

  const getTabSnapshot = useCallback(
    (panelId: string) => {
      const objectRef = openPanels.get(panelId);
      return objectRef
        ? objectPanelTabSnapshot(panelId, objectRef, activeTabs.get(panelId) ?? 'details')
        : undefined;
    },
    [activeTabs, openPanels]
  );

  const tabDragIdentity = useMemo(
    () => ({
      windowName: descriptor.windowName,
      clusterId: descriptor.clusterId,
      nativeGroupId: descriptor.groupId,
      getTabSnapshot,
    }),
    [descriptor, getTabSnapshot]
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
    (payload: DockableTabDragPayload, _targetGroupId: string, insertIndex: number) => {
      const request = tabTransferRequestFromDragPayload(payload, {
        transferId: createTransferId(),
        targetWindowName: descriptor.windowName,
        targetGroupId: descriptor.groupId,
        targetIndex: insertIndex,
        targetKind: 'panel-window' as panelwindow.TabTransferTarget,
      });
      if (!request) {
        return;
      }
      void requestPanelTabTransfer(descriptor.windowName, request).catch((error) =>
        reportOperationalError(error, {
          source: 'PanelWindowApp',
          action: 'request-tab-drop',
          clusterId: descriptor.clusterId,
        })
      );
    },
    [descriptor]
  );

  const handleTabTearOff = useCallback(
    (payload: DockableTabDragPayload, cursor: { x: number; y: number }) => {
      if (payload.sourceWindowName !== descriptor.windowName) {
        return;
      }
      const request = tabTransferRequestFromDragPayload(payload, {
        transferId: createTransferId(),
        targetWindowName: '',
        targetGroupId: `panel-group-${createTransferId()}`,
        targetIndex: 0,
        targetKind: 'new-window' as panelwindow.TabTransferTarget,
        cursor,
      });
      if (!request) {
        return;
      }
      void requestPanelTabTransfer(descriptor.windowName, request).catch((error) =>
        reportOperationalError(error, {
          source: 'PanelWindowApp',
          action: 'tear-off-tab',
          clusterId: descriptor.clusterId,
        })
      );
    },
    [descriptor]
  );

  return (
    <DockablePanelProvider
      initialTabGroups={initialTabGroups}
      onGroupMoveRequest={handleGroupMove}
      onTabCloseRequest={requestTabClose}
      nativeWindowMode={true}
      tabDragIdentity={tabDragIdentity}
      onExternalTabDrop={handleExternalTabDrop}
      onTabTearOff={handleTabTearOff}
      canStartTabDrag={canStartTabDrag}
    >
      <PanelWindowShortcuts descriptor={descriptor} ready={ready} />
      <TextContextMenu />
      <AppHeader mode="panel" clusterName={clusterName} />
      <ErrorNotificationSystem />
      <div className="panel-window-content content">
        {Array.from(openPanels.entries()).map(([panelId, objectRef]) => (
          <PanelErrorBoundary
            key={panelId}
            onClose={() => requestTabClose(panelId)}
            panelName="object-details"
          >
            <ObjectPanel
              panelId={panelId}
              objectRef={objectRef}
              defaultPosition="right"
              defaultGroupKey="right"
            />
          </PanelErrorBoundary>
        ))}
      </div>
    </DockablePanelProvider>
  );
}

export default function PanelWindowApp({
  descriptor,
}: Readonly<{ descriptor: PanelWindowDescriptor }>) {
  const clusterWorkspace = useClusterWorkspaceSnapshot();
  const clusterName = resolvePanelWindowClusterName(
    clusterWorkspace.clusters,
    descriptor.clusterId
  );
  return (
    <AppErrorBoundary>
      <ErrorProvider>
        <ZoomProvider>
          <KeyboardProvider>
            <AuthErrorProvider>
              <div
                className="app panel-window-app"
                data-native-panel-window={descriptor.windowName}
              >
                <PanelWindowRoleProvider descriptor={descriptor}>
                  <AppearanceModeProvider>
                    <RefreshManagerProvider>
                      <FixedClusterProvider
                        clusterId={descriptor.clusterId}
                        clusterName={clusterName}
                      >
                        <ObjectPanelStateProvider initialGroupSnapshot={descriptor.snapshot}>
                          <ClusterLifecycleProvider>
                            <NamespaceProvider>
                              <PanelLifecycleGuardProvider>
                                <PanelWindowSurface
                                  descriptor={descriptor}
                                  clusterName={clusterName}
                                />
                              </PanelLifecycleGuardProvider>
                            </NamespaceProvider>
                          </ClusterLifecycleProvider>
                        </ObjectPanelStateProvider>
                      </FixedClusterProvider>
                    </RefreshManagerProvider>
                  </AppearanceModeProvider>
                </PanelWindowRoleProvider>
              </div>
            </AuthErrorProvider>
          </KeyboardProvider>
        </ZoomProvider>
      </ErrorProvider>
    </AppErrorBoundary>
  );
}
