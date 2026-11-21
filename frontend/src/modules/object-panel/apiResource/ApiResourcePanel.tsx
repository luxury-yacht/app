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
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KindReadTarget } from '@/core/data-access';
import { PanelLifecycleClusterSurface } from '@/core/panel-windows/panelLifecycleGuards';
import type { RefreshFailure } from '@/core/refresh/refreshFailure';
import type { ClusterAPIResourceEntry } from '@/core/refresh/types';
import { getPreference } from '@/core/settings/appPreferences';
import { TABS } from '../components/ObjectPanel/constants';
import ExplainTab from '../components/ObjectPanel/Explain/ExplainTab';
import { ObjectPanelHeader } from '../components/ObjectPanel/ObjectPanelHeader';
import { ObjectPanelTabs } from '../components/ObjectPanel/ObjectPanelTabs';
import { resolveObjectPanelOpenTarget } from '../components/ObjectPanel/objectPanelOpenTarget';
import type { ViewType } from '../components/ObjectPanel/types';
import { useObjectPanelActiveTab, useObjectPanelState } from '../contexts/ObjectPanelStateContext';
import { type ApiResourcePanelRef, isApiResourcePanelView } from '../panelTarget';
import {
  ApiResourceDetails,
  ApiResourceOutOfDateNotice,
  ApiResourceUnavailable,
  type KindAbsence,
} from './ApiResourceDetails';
import { useApiResourceDetails } from './useApiResourceDetails';
import '../components/ObjectPanel/ObjectPanel.css';
import '../components/ObjectPanel/Details/DetailsTab.css';

const tabs = [TABS.DETAILS, TABS.EXPLAIN];

/** What an answer with no row for the kind means. */
const kindAbsence = (answered: boolean, groupUnread: boolean): KindAbsence => {
  if (!answered) {
    return 'pending';
  }
  return groupUnread ? 'unread' : 'gone';
};

/**
 * The row the panel shows for its kind, and what having none means.
 *
 * The row is the one last read. The query holds no rows while another panel is
 * the group's front tab; keeping the last one keeps this panel's content, and
 * Explain's open fields and selection, mounted until it is shown again. Only
 * an answer read while in front replaces or clears it. A read that failed, or
 * one still out, is not an answer (the query's rows are then stale), so it
 * leaves the held row alone. So does an answer with no row from a discovery
 * that could not read the kind's group: it says nothing about the kind.
 */
function useKindRow(kind: ApiResourcePanelRef, enabled: boolean) {
  const query = useApiResourceDetails(kind, enabled);
  const liveRow = query.rows[0];
  const [heldRow, setHeldRow] = useState(liveRow);
  const answered = enabled && !query.pageStale;
  const groupUnread =
    Boolean(query.payload?.discoveryFailed) ||
    (query.payload?.unreadGroups ?? []).includes(kind.group);
  const conclusive = answered && (Boolean(liveRow) || !groupUnread);
  useEffect(() => {
    if (conclusive) {
      setHeldRow(liveRow);
    }
  }, [conclusive, liveRow]);
  // Whether the group was unread at the last answer, held like the row is: a
  // panel brought back to the front shows its held row before its read answers.
  const [heldUnread, setHeldUnread] = useState(false);
  useEffect(() => {
    if (answered) {
      setHeldUnread(groupUnread);
    }
  }, [answered, groupUnread]);
  const details = liveRow ?? heldRow;
  return {
    details,
    absence: kindAbsence(answered, groupUnread),
    // A row is shown, but discovery could not read its group: the row is what
    // was last read (the backend keeps an unreadable group's kinds too).
    outOfDate: Boolean(details) && (answered ? groupUnread : heldUnread),
    error: query.error,
  };
}

/** The active tab's content, or the row's loading, error, or gone state. */
function ApiResourcePanelContent({
  activeTab,
  details,
  explainTarget,
  absence,
  error,
  enabled,
}: Readonly<{
  activeTab: ViewType;
  details: ClusterAPIResourceEntry | undefined;
  explainTarget: KindReadTarget | null;
  /** What having no row means, when there is none. */
  absence: KindAbsence;
  error: RefreshFailure | null;
  enabled: boolean;
}>) {
  // A failed refresh does not take away a row the panel already holds. With no
  // row, the kind is gone only once the cluster has answered that it is.
  if (!details || !explainTarget) {
    return <ApiResourceUnavailable absence={absence} error={error} />;
  }
  return activeTab === 'explain' ? (
    <ExplainTab kind={explainTarget} isActive={enabled} />
  ) : (
    <ApiResourceDetails details={details} />
  );
}

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
  // The kind's row says what the cluster serves now. The panel is not tied to a
  // version: Explain reads whichever version the row currently prefers.
  const { details, absence, outOfDate, error } = useKindRow(kind, enabled);
  const servedKind = details?.kind;
  const servedVersion = details?.version;
  const explainTarget = useMemo(
    () =>
      servedKind && servedVersion
        ? {
            clusterId: kind.clusterId,
            group: kind.group,
            version: servedVersion,
            kind: servedKind,
            resource: kind.resource,
          }
        : null,
    [kind.clusterId, kind.group, kind.resource, servedKind, servedVersion]
  );
  const kindLabel = servedKind ?? kind.kind;
  // The fully qualified resource name, as kubectl accepts it.
  const name = kind.group ? `${kind.resource}.${kind.group}` : kind.resource;
  return (
    <DockablePanel
      panelId={panelId}
      title={name}
      tabKindClass={getKindColorClass(kindLabel)}
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
        <ObjectPanelHeader kind={kindLabel} kindAlias={null} name={name} />
        <ObjectPanelTabs tabs={tabs} activeTab={activeTab} onSelect={selectTab} />
        {outOfDate ? <ApiResourceOutOfDateNotice /> : null}
        <div className="object-panel-content">
          <ApiResourcePanelContent
            activeTab={activeTab}
            details={details}
            explainTarget={explainTarget}
            absence={absence}
            error={error}
            enabled={enabled}
          />
        </div>
      </PanelLifecycleClusterSurface>
    </DockablePanel>
  );
}
