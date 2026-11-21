/**
 * frontend/src/modules/object-panel/apiResource/ApiResourcePanel.tsx
 *
 * The panel for a kind the cluster serves (not an object of that kind):
 * Details from API discovery, and Explain with the kind's schema.
 */

import { getKindColorClass } from '@shared/utils/kindBadgeColors';
import { DockablePanel, type DockPosition, useDockablePanelContext } from '@ui/dockable';
import { getGroupForPanel, getGroupTabs } from '@ui/dockable/tabGroupState';
import type { GroupKey } from '@ui/dockable/tabGroupTypes';
import { useCallback, useMemo } from 'react';
import { PanelLifecycleClusterSurface } from '@/core/panel-windows/panelLifecycleGuards';
import { getPreference } from '@/core/settings/appPreferences';
import { TABS } from '../components/ObjectPanel/constants';
import ExplainTab from '../components/ObjectPanel/Explain/ExplainTab';
import { ObjectPanelHeader } from '../components/ObjectPanel/ObjectPanelHeader';
import { ObjectPanelTabs } from '../components/ObjectPanel/ObjectPanelTabs';
import { resolveObjectPanelOpenTarget } from '../components/ObjectPanel/objectPanelOpenTarget';
import type { ViewType } from '../components/ObjectPanel/types';
import { useObjectPanelActiveTab, useObjectPanelState } from '../contexts/ObjectPanelStateContext';
import { type ApiResourcePanelRef, isApiResourcePanelView } from '../panelTarget';
import { ApiResourceDetails } from './ApiResourceDetails';
import '../components/ObjectPanel/ObjectPanel.css';
import '../components/ObjectPanel/Details/DetailsTab.css';

const tabs = [TABS.DETAILS, TABS.EXPLAIN];

export function ApiResourcePanel({
  panelId,
  kind,
  defaultPosition,
  defaultGroupKey,
  suppressWorkspaceSurface = false,
}: Readonly<{
  panelId: string;
  kind: ApiResourcePanelRef;
  defaultPosition?: DockPosition;
  defaultGroupKey?: GroupKey;
  suppressWorkspaceSurface?: boolean;
}>) {
  const { closePanel, setObjectPanelActiveTab } = useObjectPanelState();
  const { tabGroups, getPreferredOpenGroupKey } = useDockablePanelContext();
  const target = resolveObjectPanelOpenTarget(
    defaultPosition ?? getPreference('defaultObjectPanelPosition'),
    defaultGroupKey,
    getPreferredOpenGroupKey
  );
  const groupKey = getGroupForPanel(tabGroups, panelId);
  const group = groupKey ? getGroupTabs(tabGroups, groupKey) : null;
  const enabled = (!group || group.activeTab === panelId) && !suppressWorkspaceSurface;
  const storedTab = useObjectPanelActiveTab(panelId) ?? 'details';
  // A view only object panels have falls back to the kind's details.
  const activeTab: ViewType = isApiResourcePanelView(storedTab) ? storedTab : 'details';
  const close = useCallback(
    () => closePanel(kind.clusterId, panelId),
    [closePanel, kind.clusterId, panelId]
  );
  const selectTab = useCallback(
    (tab: ViewType) => setObjectPanelActiveTab(kind.clusterId, panelId, tab),
    [setObjectPanelActiveTab, kind.clusterId, panelId]
  );
  const explainTarget = useMemo(
    () => ({
      clusterId: kind.clusterId,
      group: kind.group,
      version: kind.version,
      kind: kind.kind,
      resource: kind.resource,
    }),
    [kind.clusterId, kind.group, kind.version, kind.kind, kind.resource]
  );
  // The fully qualified resource name, as kubectl accepts it.
  const name = kind.group ? `${kind.resource}.${kind.group}` : kind.resource;
  return (
    <DockablePanel
      panelId={panelId}
      title={name}
      tabKindClass={getKindColorClass(kind.kind)}
      isOpen
      defaultPosition={target.position}
      defaultGroupKey={target.groupKey}
      suppressSurface={suppressWorkspaceSurface}
      className="object-panel-dockable"
      contentClassName="object-panel-body"
      closeActiveTabOnEscape
      allowMaximize
      maximizeTargetSelector=".content-body"
      onClose={close}
    >
      <PanelLifecycleClusterSurface clusterId={kind.clusterId}>
        <ObjectPanelHeader kind={kind.kind} kindAlias={null} name={name} />
        <ObjectPanelTabs tabs={tabs} activeTab={activeTab} onSelect={selectTab} />
        <div className="object-panel-content">
          {activeTab === 'explain' ? (
            <ExplainTab kind={explainTarget} isActive={enabled} />
          ) : (
            <ApiResourceDetails kind={kind} enabled={enabled} />
          )}
        </div>
      </PanelLifecycleClusterSurface>
    </DockablePanel>
  );
}
