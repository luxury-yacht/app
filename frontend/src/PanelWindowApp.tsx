import { AppearanceModeProvider } from '@core/contexts/AppearanceModeContext';
import { AuthErrorProvider } from '@core/contexts/AuthErrorContext';
import { ClusterLifecycleProvider } from '@core/contexts/ClusterLifecycleContext';
import { ErrorProvider } from '@core/contexts/ErrorContext';
import { ZoomProvider } from '@core/contexts/ZoomContext';
import { RefreshManagerProvider } from '@core/refresh';
import { FixedClusterProvider } from '@modules/kubernetes/config/KubeconfigContext';
import { NamespaceProvider } from '@modules/namespace/contexts/NamespaceContext';
import ObjectPanel from '@modules/object-panel/components/ObjectPanel/ObjectPanel';
import type { ViewType } from '@modules/object-panel/components/ObjectPanel/types';
import {
  ObjectPanelStateProvider,
  useObjectPanelActiveTabs,
  useObjectPanelState,
} from '@modules/object-panel/contexts/ObjectPanelStateContext';
import { TabDragProvider } from '@shared/components/tabs/dragCoordinator';
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
  onPanelObjectOpenAuthorized,
  type PanelWindowDescriptor,
  requestPanelTabClose,
} from '@/core/panel-windows';
import { PanelWindowRoleProvider } from '@/core/panel-windows/PanelWindowRoleContext';
import {
  PanelLifecycleGuardProvider,
  usePanelLifecycleGuardRegistry,
} from '@/core/panel-windows/panelLifecycleGuards';
import { resolvePanelWindowClusterName } from '@/core/panel-windows/panelWindowClusterName';
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

function PanelWindowSurface({ descriptor }: Readonly<{ descriptor: PanelWindowDescriptor }>) {
  const { openPanels, onRowClick, setObjectPanelActiveTab } = useObjectPanelState();
  const activeTabs = useObjectPanelActiveTabs();
  const guards = usePanelLifecycleGuardRegistry();
  const [ready, setReady] = useState(false);
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
    void acknowledgePanelWindowReady(descriptor.windowName, descriptor.snapshot.transferId)
      .then(() => setReady(true))
      .catch((error) => {
        acknowledgedTransfers.delete(descriptor.snapshot.transferId);
        void failPanelWindowTransfer(
          descriptor.windowName,
          descriptor.windowName,
          descriptor.snapshot.transferId
        );
        reportOperationalError(error, { source: 'PanelWindowApp', action: 'acknowledge-ready' });
      });
  }, [descriptor]);

  useEffect(
    () =>
      onPanelObjectOpenAuthorized((event) => {
        const panelId = onRowClick({ ...event.objectRef });
        if (panelId !== event.panelId) {
          reportOperationalError(new Error('Owner authorized an inconsistent panel identity'), {
            source: 'PanelWindowApp',
            action: 'authorize-object-identity',
          });
          return;
        }
        setObjectPanelActiveTab(panelId, event.activeView as ViewType);
      }),
    [onRowClick, setObjectPanelActiveTab]
  );

  const handleGroupMove = useCallback(
    (
      group: { tabs: string[]; activeTab: string | null },
      targetPosition: 'right' | 'bottom' | 'floating'
    ) => {
      if (targetPosition === 'floating') {
        return true;
      }
      const blocker = guards.firstBlocker(group.tabs);
      if (blocker) {
        blocker.focus();
        return true;
      }
      const snapshot: panelwindow.GroupSnapshot = {
        schemaVersion: 1,
        transferId: createTransferId(),
        ownerWindowName: descriptor.ownerWindowName,
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
      void beginPanelWindowDock(descriptor.windowName, targetPosition, snapshot).catch((error) =>
        reportOperationalError(error, { source: 'PanelWindowApp', action: 'dock-group' })
      );
      return true;
    },
    [activeTabs, descriptor, guards, openPanels]
  );

  return (
    <DockablePanelProvider
      initialTabGroups={initialTabGroups}
      onGroupMoveRequest={handleGroupMove}
      onTabCloseRequest={requestTabClose}
      nativeWindowMode={true}
    >
      <PanelWindowShortcuts descriptor={descriptor} ready={ready} />
      <TextContextMenu />
      <AppHeader mode="panel" />
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
                                <TabDragProvider>
                                  <PanelWindowSurface descriptor={descriptor} />
                                </TabDragProvider>
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
