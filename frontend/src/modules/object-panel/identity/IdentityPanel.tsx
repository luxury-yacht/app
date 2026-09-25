import { getKindColorClass } from '@shared/utils/kindBadgeColors';
import { DockablePanel, type DockPosition, useDockablePanelContext } from '@ui/dockable';
import { getGroupForPanel, getGroupTabs } from '@ui/dockable/tabGroupState';
import type { GroupKey } from '@ui/dockable/tabGroupTypes';
import { useCallback } from 'react';
import { PanelLifecycleClusterSurface } from '@/core/panel-windows/panelLifecycleGuards';
import { getDefaultObjectPanelPosition } from '@/core/settings/appPreferences';
import { ObjectPanelHeader } from '../components/ObjectPanel/ObjectPanelHeader';
import { ObjectPanelTabs } from '../components/ObjectPanel/ObjectPanelTabs';
import { resolveObjectPanelOpenTarget } from '../components/ObjectPanel/objectPanelOpenTarget';
import { useObjectPanelState } from '../contexts/ObjectPanelStateContext';
import type { IdentityPanelRef } from '../panelTarget';
import { IdentityDetails } from './IdentityDetails';
import '../components/ObjectPanel/ObjectPanel.css';
import '../components/ObjectPanel/Details/DetailsTab.css';

const tabs = [{ id: 'details', label: 'Details' }];
const keepDetails = () => undefined;

export function IdentityPanel({
  panelId,
  identity,
  defaultPosition,
  defaultGroupKey,
  suppressWorkspaceSurface = false,
}: Readonly<{
  panelId: string;
  identity: IdentityPanelRef;
  defaultPosition?: DockPosition;
  defaultGroupKey?: GroupKey;
  suppressWorkspaceSurface?: boolean;
}>) {
  const { closePanel } = useObjectPanelState();
  const { tabGroups, getPreferredOpenGroupKey } = useDockablePanelContext();
  const target = resolveObjectPanelOpenTarget(
    defaultPosition ?? getDefaultObjectPanelPosition(),
    defaultGroupKey,
    getPreferredOpenGroupKey
  );
  const groupKey = getGroupForPanel(tabGroups, panelId);
  const group = groupKey ? getGroupTabs(tabGroups, groupKey) : null;
  const enabled = (!group || group.activeTab === panelId) && !suppressWorkspaceSurface;
  const close = useCallback(
    () => closePanel(identity.clusterId, panelId),
    [closePanel, identity.clusterId, panelId]
  );
  return (
    <DockablePanel
      panelId={panelId}
      title={identity.name}
      tabKindClass={getKindColorClass(identity.kind)}
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
      <PanelLifecycleClusterSurface clusterId={identity.clusterId}>
        <ObjectPanelHeader kind={identity.kind} kindAlias={null} name={identity.name} />
        <ObjectPanelTabs tabs={tabs} activeTab="details" onSelect={keepDetails} />
        <div className="object-panel-content">
          <IdentityDetails identity={identity} enabled={enabled} />
        </div>
      </PanelLifecycleClusterSurface>
    </DockablePanel>
  );
}
