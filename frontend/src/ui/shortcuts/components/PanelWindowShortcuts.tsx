import { useCallback, useEffect, useRef } from 'react';
import { type DesktopEventName, focusWindow, onEvent } from '@/core/desktop-runtime';
import type { PanelWindowDescriptor } from '@/core/panel-windows';
import {
  acknowledgePanelWindowClose,
  acknowledgePanelWindowGuard,
  onPanelTabCloseAuthorized,
  onPanelWindowCloseRequested,
  onPanelWindowFocusRequested,
  onPanelWindowGuardRequested,
  requestPanelTabClose,
  routePanelWindowCommand,
  updatePanelWindowSnapshot,
} from '@/core/panel-windows';
import type { PanelLifecycleBlocker } from '@/core/panel-windows/panelLifecycleGuards';
import { usePanelLifecycleGuardRegistry } from '@/core/panel-windows/panelLifecycleGuards';
import {
  useObjectPanelActiveTabs,
  useObjectPanelState,
} from '@/modules/object-panel/contexts/ObjectPanelStateContext';
import { useDockablePanelContext } from '@/ui/dockable';
import { getGroupTabs } from '@/ui/dockable/tabGroupState';
import { reportOperationalError } from '@/utils/errorHandler';

const OWNER_ROUTED_EVENTS: DesktopEventName[] = [
  'open-about',
  'open-cluster',
  'open-command-palette',
  'open-settings',
  'toggle-app-logs-panel',
  'toggle-diagnostics',
  'toggle-object-diff',
  'toggle-sidebar',
];

export function PanelWindowShortcuts({
  descriptor,
  ready,
}: Readonly<{ descriptor: PanelWindowDescriptor; ready: boolean }>) {
  const { openPanels } = useObjectPanelState();
  const activeTabs = useObjectPanelActiveTabs();
  const { tabGroups, focusPanel, commitTabClose } = useDockablePanelContext();
  const guards = usePanelLifecycleGuardRegistry();
  const snapshotUpdateQueueRef = useRef<Promise<void>>(Promise.resolve());
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

  useEffect(() => {
    const disposers = OWNER_ROUTED_EVENTS.map((eventName) =>
      onEvent(eventName, () => {
        void routePanelWindowCommand(descriptor.windowName, eventName).catch((error) =>
          reportOperationalError(error, {
            source: 'PanelWindowShortcuts',
            action: 'route-owner-command',
          })
        );
      })
    );
    return () => {
      for (const dispose of disposers) {
        dispose();
      }
    };
  }, [descriptor.windowName]);

  return null;
}
