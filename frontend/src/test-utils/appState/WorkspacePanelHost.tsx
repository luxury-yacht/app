/**
 * frontend/src/test-utils/appState/WorkspacePanelHost.tsx
 *
 * Hosts the open object panels the way the workspace window does, without
 * their content: the content element with the dock's panel layer
 * (ui/layout/AppLayout.tsx), and one dock panel per open object panel at its
 * resolved mount target, suppressed while it waits for a native window, inside
 * its cluster's lifecycle surface (AppLayout.tsx object panels,
 * ObjectPanel.tsx). Provider-mode suites that drive the panel lifecycle mount
 * it in place of AppLayout.
 */

import type { ReactNode } from 'react';
import { PanelLifecycleClusterSurface } from '@/core/panel-windows/panelLifecycleGuards';
import { getPreference } from '@/core/settings/appPreferences';
import { useObjectPanelState } from '@/modules/object-panel/contexts/ObjectPanelStateContext';
import { DockablePanel, DockablePanelLayer, useDockablePanelContext } from '@/ui/dockable';
import { getGroupForPanel } from '@/ui/dockable/tabGroupState';
import { resolveObjectPanelMountTarget } from '@/ui/layout/objectPanelMountTarget';

export function WorkspacePanelHost({
  renderContent,
}: Readonly<{ renderContent?: (panelId: string) => ReactNode }>) {
  const { openPanels, pendingNativeOpenPanelIds, closePanel } = useObjectPanelState();
  const { tabGroups } = useDockablePanelContext();
  return (
    <>
      <div className="content">
        <DockablePanelLayer />
        <div className="content-body" />
      </div>
      {Array.from(openPanels.entries()).map(([panelId, target]) => {
        const pendingNative = pendingNativeOpenPanelIds.has(panelId);
        const mountTarget = resolveObjectPanelMountTarget(
          getGroupForPanel(tabGroups, panelId),
          getPreference('defaultObjectPanelPosition'),
          pendingNative ? panelId : undefined
        );
        return (
          <DockablePanel
            key={panelId}
            panelId={panelId}
            title={panelId}
            isOpen
            defaultPosition={mountTarget.position}
            defaultGroupKey={mountTarget.groupKey}
            suppressSurface={pendingNative}
            onClose={() => closePanel(target.clusterId, panelId)}
          >
            <PanelLifecycleClusterSurface clusterId={target.clusterId}>
              {renderContent?.(panelId)}
            </PanelLifecycleClusterSurface>
          </DockablePanel>
        );
      })}
    </>
  );
}
