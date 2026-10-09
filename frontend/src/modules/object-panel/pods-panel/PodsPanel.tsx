/**
 * frontend/src/modules/object-panel/pods-panel/PodsPanel.tsx
 *
 * The Pods dock tab: the pods of one workload or node, opened from the
 * Workloads and Nodes tables while their "Show Pods" toggle is on. Like
 * Application Logs it is a standard dock tab, opening at the bottom; its
 * content is the object panel's Pods tab scoped to the target object.
 */

import { getKindColorClass } from '@shared/utils/kindBadgeColors';
import { DockablePanel, useDockablePanelContext } from '@ui/dockable';
import { getGroupForPanel, getGroupTabs } from '@ui/dockable/tabGroupState';
import { useEffect, useMemo, useRef } from 'react';
import { PanelLifecycleClusterSurface } from '@/core/panel-windows/panelLifecycleGuards';
import { PanelTabBoundary } from '../components/ObjectPanel/PanelTabBoundary';
import { PodsTab } from '../components/ObjectPanel/Pods/PodsTab';
import type { PodsPanelTarget } from '../contexts/PodsPanelStateContext';
import { CurrentObjectPanelContext } from '../hooks/useObjectPanel';
import '../components/ObjectPanel/ObjectPanel.css';
import { podsPanelId } from './podsPanelId';

export default function PodsPanel({
  target,
  onClose,
}: Readonly<{ target: PodsPanelTarget; onClose: () => void }>) {
  const { object, request } = target;
  const panelId = podsPanelId(object.clusterId);
  const { tabGroups, switchTab } = useDockablePanelContext();
  const groupKey = getGroupForPanel(tabGroups, panelId);
  const group = groupKey ? getGroupTabs(tabGroups, groupKey) : null;
  const isActiveTab = !group || group.activeTab === panelId;

  // Each request brings the tab to the front of its dock group without taking
  // keyboard focus, so the table keeps its place for the next row.
  const handledRequestRef = useRef(request);
  useEffect(() => {
    if (handledRequestRef.current === request) {
      return;
    }
    handledRequestRef.current = request;
    if (groupKey && !isActiveTab) {
      switchTab(groupKey, panelId);
    }
  }, [groupKey, isActiveTab, panelId, request, switchTab]);

  const currentPanel = useMemo(() => ({ objectData: object, panelId }), [object, panelId]);

  return (
    <CurrentObjectPanelContext.Provider value={currentPanel}>
      <DockablePanel
        panelId={panelId}
        title={`Pods · ${object.name}`}
        tabKindClass={getKindColorClass('Pod')}
        isOpen
        defaultPosition="bottom"
        className="object-panel-dockable"
        contentClassName="object-panel-body"
        closeActiveTabOnEscape
        allowMaximize
        maximizeTargetSelector=".content-body"
        onClose={onClose}
      >
        <PanelLifecycleClusterSurface clusterId={object.clusterId}>
          <div className="object-panel-content">
            <PanelTabBoundary
              scope="pods-panel"
              resetKeys={[object.namespace ?? '', object.name]}
              tabName="Pods"
              loadingName="pods"
            >
              <PodsTab isActive={isActiveTab} />
            </PanelTabBoundary>
          </div>
        </PanelLifecycleClusterSurface>
      </DockablePanel>
    </CurrentObjectPanelContext.Provider>
  );
}
