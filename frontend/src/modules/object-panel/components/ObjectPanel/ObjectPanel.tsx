/**
 * frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.tsx
 *
 * Renders one Kubernetes object as a dockable object-panel tab, deriving the
 * shared scopes, permissions, available tabs, actions, and refresh lifecycle
 * from the canonical object reference.
 */

import { getDefaultObjectPanelPosition } from '@core/settings/appPreferences';
import type { DetailsTabProps } from '@modules/object-panel/components/ObjectPanel/Details/DetailsTab';
import {
  useObjectPanelActiveTab,
  useObjectPanelState,
} from '@modules/object-panel/contexts/ObjectPanelStateContext';
import { CurrentObjectPanelContext } from '@modules/object-panel/hooks/useObjectPanel';
import {
  clearRequestedObjectPanelTab,
  getRequestedObjectPanelTab,
  subscribeObjectPanelTabRequests,
} from '@modules/object-panel/objectPanelTabRequests';
import { DockablePanel, useDockablePanelContext } from '@ui/dockable';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { queryNamespacePermissions } from '@/core/capabilities';
import './ObjectPanel.css';
import {
  CLUSTER_SCOPE,
  RESOURCE_CAPABILITIES,
} from '@modules/object-panel/components/ObjectPanel/constants';
import { useObjectPanelCapabilities } from '@modules/object-panel/components/ObjectPanel/hooks/useObjectPanelCapabilities';
import { useObjectPanelFeatureSupport } from '@modules/object-panel/components/ObjectPanel/hooks/useObjectPanelFeatureSupport';
import { useObjectPanelRefresh } from '@modules/object-panel/components/ObjectPanel/hooks/useObjectPanelRefresh';
import { useObjectPanelTabs } from '@modules/object-panel/components/ObjectPanel/hooks/useObjectPanelTabs';
import { ObjectPanelContent } from '@modules/object-panel/components/ObjectPanel/ObjectPanelContent';
import { ObjectPanelHeader } from '@modules/object-panel/components/ObjectPanel/ObjectPanelHeader';
import { ObjectPanelTabs } from '@modules/object-panel/components/ObjectPanel/ObjectPanelTabs';
import type { ViewType } from '@modules/object-panel/components/ObjectPanel/types';
import type { ObjectPanelRef } from '@modules/object-panel/objectPanelRef';
import { getObjectPanelScopes } from '@modules/object-panel/objectPanelRef';
import { getKindColorClass } from '@shared/utils/kindBadgeColors';
import type { DockPosition } from '@ui/dockable';
import { getGroupForPanel, getGroupTabs } from '@ui/dockable/tabGroupState';
import { buildObjectDetailModel } from './Details/objectDetailModel';
import { resetObjectPanelScopedDomain } from './hooks/useObjectPanelScopedDomainLifecycle';

// ============================================================================
// COMPONENT PROPS
// ============================================================================
interface ObjectPanelProps {
  /** Unique panel ID derived from the object identity. */
  panelId: string;
  /** The cluster-complete object reference this panel displays. */
  objectRef: ObjectPanelRef;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
function ObjectPanel({ panelId, objectRef }: ObjectPanelProps) {
  const objectData = objectRef;
  const { closePanel, setObjectPanelActiveTab } = useObjectPanelState();
  const { tabGroups, getPreferredOpenGroupKey } = useDockablePanelContext();
  const openTargetGroupKey = getPreferredOpenGroupKey(getDefaultObjectPanelPosition());
  const openTargetPosition: DockPosition =
    openTargetGroupKey === 'right' || openTargetGroupKey === 'bottom'
      ? openTargetGroupKey
      : 'floating';

  // Determine whether this tab is active within its group (for polling control).
  const groupKey = getGroupForPanel(tabGroups, panelId);
  const groupInfo = groupKey ? getGroupTabs(tabGroups, groupKey) : null;
  const isActiveTab = groupInfo ? groupInfo.activeTab === panelId : true;

  // This panel is always "open" while it exists in the render tree.
  const isOpen = true;

  // Close handler removes this panel from the context.
  const close = useCallback(() => {
    closePanel(panelId);
  }, [closePanel, panelId]);

  // Keep tab labels concise and consistent: object name only.
  const tabTitle = objectData?.name?.trim() || 'Object';
  const tabKindClass = getKindColorClass(objectData?.kind || objectData?.kindAlias || '');

  // Resource-deleted is panel lifecycle state (the object vanished out from
  // under us, or a user delete closed the panel) — it is local because it
  // resets correctly on the unmount/remount caused by cluster switching. All
  // action execution + modals now live in the shared object action controller
  // (via ActionsMenu), so the panel no longer carries action/modal flags. The
  // active sub-tab lives in ObjectPanelStateContext so it survives remount.
  const [resourceDeleted, setResourceDeleted] = useState(false);
  const [deletedResourceName, setDeletedResourceName] = useState('');
  const activeTab: ViewType = useObjectPanelActiveTab(panelId) ?? 'details';

  const {
    objectKind,
    detailScope,
    eventsScope,
    containerLogsScope,
    mapScope,
    helmScope,
    isHelmRelease,
    isEvent,
  } = getObjectPanelScopes(objectData, {
    clusterScope: CLUSTER_SCOPE,
  });

  const lastEvaluatedNamespaceRef = useRef<string | null>(null);
  useEffect(() => {
    const namespace = objectData?.namespace?.trim();
    if (!namespace) {
      return;
    }

    const normalized = namespace.toLowerCase();
    if (lastEvaluatedNamespaceRef.current === normalized) {
      return;
    }

    lastEvaluatedNamespaceRef.current = normalized;
    queryNamespacePermissions(namespace, objectData?.clusterId ?? null);
  }, [objectData?.clusterId, objectData?.namespace]);

  const featureSupport = useObjectPanelFeatureSupport(
    objectKind,
    RESOURCE_CAPABILITIES,
    isHelmRelease
  );

  const { capabilities, capabilityReasons, nodeLogsState, nodeLogSources } =
    useObjectPanelCapabilities({
      objectData,
      objectKind,
      detailScope,
      featureSupport,
    });

  // Only poll when this tab is active in its group (Step 8: active-tab-only polling).
  const {
    detailPayload,
    creationTimestamp,
    lastModified,
    detailsLoading,
    detailsError,
    fetchResourceDetails,
  } = useObjectPanelRefresh({
    detailScope,
    objectKind,
    objectData,
    panelId,
    isOpen: isOpen && isActiveTab,
    resourceDeleted,
  });

  const objectIdentityKey = useMemo(() => {
    const clusterKey = objectData?.clusterId?.trim().toLowerCase() ?? '';
    const name = objectData?.name?.trim().toLowerCase() ?? '';
    const namespace = objectData?.namespace?.trim().toLowerCase() ?? '';
    const kindKey = objectKind?.toLowerCase() ?? '';
    return [clusterKey, kindKey, namespace, name].filter(Boolean).join('/');
  }, [objectData?.clusterId, objectData?.name, objectData?.namespace, objectKind]);

  const previousIdentityRef = useRef<string | null>(null);
  useEffect(() => {
    if (!objectIdentityKey) {
      return;
    }
    if (previousIdentityRef.current !== objectIdentityKey) {
      previousIdentityRef.current = objectIdentityKey;
      if (resourceDeleted) {
        setResourceDeleted(false);
        setDeletedResourceName('');
      }
    }
  }, [objectIdentityKey, resourceDeleted]);

  const isNotFoundError = useMemo(() => {
    if (!detailsError) {
      return false;
    }
    const normalized = detailsError.toLowerCase();
    return (
      normalized.includes('not found') ||
      normalized.includes('was not found') ||
      normalized.includes('could not find')
    );
  }, [detailsError]);

  useEffect(() => {
    if (!isNotFoundError || resourceDeleted) {
      return;
    }
    setResourceDeleted(true);
    setDeletedResourceName(objectData?.name ?? '');
    if (detailScope) {
      resetObjectPanelScopedDomain({ domain: 'object-details', scope: detailScope });
    }
  }, [detailScope, isNotFoundError, objectData?.name, resourceDeleted]);

  // Wrap setObjectPanelActiveTab into a panelId-bound callback so the hook
  // doesn't have to know about panel identity. The wrapper is stable
  // across renders.
  const setActiveTab = useCallback(
    (tab: ViewType) => setObjectPanelActiveTab(panelId, tab),
    [panelId, setObjectPanelActiveTab]
  );

  // Get available tabs based on capabilities
  const { availableTabs } = useObjectPanelTabs({
    capabilities,
    objectData,
    isHelmRelease,
    isEvent,
    isOpen,
    setActiveTab,
    currentTab: activeTab,
  });
  const visibleActiveTab: ViewType = useMemo(
    () => (availableTabs.some((tab) => tab.id === activeTab) ? activeTab : 'details'),
    [activeTab, availableTabs]
  );

  // Keep DetailsTab props derived from this memoized model, not from the
  // enclosing props object; ObjectPanelContent depends on that stability.
  const detailModel = useMemo(
    () => buildObjectDetailModel(objectData ?? null, objectKind, detailPayload),
    [detailPayload, objectData, objectKind]
  );

  // The shared object action controller (in ActionsMenu) executes every action
  // and owns its confirmation/scale/rollback/port-forward modals. The panel
  // only supplies lifecycle hooks: close after a delete, refetch after any
  // other mutating action.
  const handleAfterDelete = useCallback(() => {
    close();
  }, [close]);

  const handleAfterAction = useCallback(() => {
    void fetchResourceDetails('user');
  }, [fetchResourceDetails]);

  const handleTabSelect = useCallback(
    (tab: ViewType) => {
      setObjectPanelActiveTab(panelId, tab);
    },
    [panelId, setObjectPanelActiveTab]
  );

  const applyRequestedTab = useCallback(
    (requestedTab?: ViewType) => {
      if (!requestedTab) {
        return;
      }
      const isAvailable = availableTabs.some((tab) => tab.id === requestedTab);
      if (!isAvailable) {
        return;
      }
      if (activeTab !== requestedTab) {
        setObjectPanelActiveTab(panelId, requestedTab);
      }
      clearRequestedObjectPanelTab(panelId);
    },
    [availableTabs, panelId, activeTab, setObjectPanelActiveTab]
  );

  useEffect(() => {
    applyRequestedTab(getRequestedObjectPanelTab(panelId));
  }, [applyRequestedTab, panelId]);

  useEffect(() => {
    return subscribeObjectPanelTabRequests((targetPanelId, requestedTab) => {
      if (targetPanelId !== panelId) {
        return;
      }
      applyRequestedTab(requestedTab);
    });
  }, [applyRequestedTab, panelId]);

  const detailTabProps: DetailsTabProps | null = objectData
    ? {
        objectData,
        detailModel,
        isActive: isOpen && visibleActiveTab === 'details',
        detailsLoading,
        detailsError,
        resourceDeleted,
        deletedResourceName,
        onAfterDelete: handleAfterDelete,
        onAfterAction: handleAfterAction,
      }
    : null;

  const panelScopeRef = useRef<HTMLDivElement>(null);

  // Memoize the per-instance context value so child components get the correct objectData.
  // creationTimestamp (→ Age) and lastModified ride along so the shared
  // ResourceHeader can render both for every kind without each per-kind overview
  // having to thread them through.
  const currentObjectPanelValue = useMemo(
    () => ({ objectData, panelId, creationTimestamp, lastModified }),
    [objectData, panelId, creationTimestamp, lastModified]
  );

  return (
    <CurrentObjectPanelContext.Provider value={currentObjectPanelValue}>
      <DockablePanel
        panelRef={panelScopeRef}
        panelId={panelId}
        title={tabTitle}
        isOpen={isOpen}
        defaultPosition={openTargetPosition}
        defaultGroupKey={openTargetGroupKey}
        className="object-panel-dockable"
        tabKindClass={tabKindClass}
        closeActiveTabOnEscape
        allowMaximize
        maximizeTargetSelector=".content-body"
        onClose={close}
        contentClassName="object-panel-body"
      >
        {/* The provider must wrap the CHILDREN handed to DockablePanel, not
            just this component's subtree: in a tab group, the group LEADER
            renders every tab's captured children inside the leader's own
            React tree, and context resolves at the render site. Without this
            inner provider, a tab's content would read the leader panel's
            objectData (wrong GVK → wrong permission keys → gated actions
            silently disappear from grouped panels). */}
        <CurrentObjectPanelContext.Provider value={currentObjectPanelValue}>
          {/* Kind badge + name toolbar */}
          <div>
            <ObjectPanelHeader
              kind={objectData?.kind ?? null}
              kindAlias={objectData?.kindAlias ?? null}
              name={objectData?.name ?? null}
            />
          </div>

          <ObjectPanelTabs
            tabs={availableTabs}
            activeTab={visibleActiveTab}
            onSelect={handleTabSelect}
          />

          <ObjectPanelContent
            activeTab={visibleActiveTab}
            detailTabProps={detailTabProps}
            isPanelOpen={isOpen && isActiveTab}
            capabilities={capabilities}
            capabilityReasons={capabilityReasons}
            nodeLogsState={nodeLogsState}
            nodeLogSources={nodeLogSources}
            detailScope={detailScope}
            eventsScope={eventsScope}
            containerLogsScope={containerLogsScope}
            mapScope={mapScope}
            helmScope={helmScope}
            objectData={objectData}
            objectKind={objectKind}
            resourceDeleted={resourceDeleted}
            deletedResourceName={deletedResourceName}
            onClosePanel={close}
            onRefreshDetails={fetchResourceDetails}
            panelId={panelId}
          />
        </CurrentObjectPanelContext.Provider>
      </DockablePanel>
    </CurrentObjectPanelContext.Provider>
  );
}

export default ObjectPanel;
