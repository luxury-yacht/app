/**
 * frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.tsx
 *
 * Each instance renders a single object as a dockable tab.
 * Accepts objectRef and panelId as props; uses CurrentObjectPanelContext
 * so child components can access the correct object data.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import RollbackModal from '@shared/components/modals/RollbackModal';
import type { DetailsTabProps } from '@modules/object-panel/components/ObjectPanel/Details/DetailsTab';
import {
  buildObjectActionTarget,
  runCronJobSuspend,
  runCronJobTrigger,
} from '@shared/actions/objectActionClient';
import { DockablePanel, useDockablePanelContext } from '@ui/dockable';
import { getDefaultObjectPanelPosition } from '@core/settings/appPreferences';
import { errorHandler } from '@utils/errorHandler';
import { CurrentObjectPanelContext } from '@modules/object-panel/hooks/useObjectPanel';
import { useObjectPanelState } from '@modules/object-panel/contexts/ObjectPanelStateContext';
import { queryNamespacePermissions } from '@/core/capabilities';
import {
  clearRequestedObjectPanelTab,
  getRequestedObjectPanelTab,
  subscribeObjectPanelTabRequests,
} from '@modules/object-panel/objectPanelTabRequests';
import './ObjectPanel.css';
import { getObjectPanelKind } from '@modules/object-panel/components/ObjectPanel/hooks/getObjectPanelKind';
import { useObjectPanelFeatureSupport } from '@modules/object-panel/components/ObjectPanel/hooks/useObjectPanelFeatureSupport';
import { useObjectPanelCapabilities } from '@modules/object-panel/components/ObjectPanel/hooks/useObjectPanelCapabilities';
import { useObjectPanelActions } from '@modules/object-panel/components/ObjectPanel/hooks/useObjectPanelActions';
import { useObjectPanelRefresh } from '@modules/object-panel/components/ObjectPanel/hooks/useObjectPanelRefresh';
import { useObjectPanelTabs } from '@modules/object-panel/components/ObjectPanel/hooks/useObjectPanelTabs';
import { useObjectPanelPods } from '@modules/object-panel/components/ObjectPanel/hooks/useObjectPanelPods';
import { ObjectPanelTabs } from '@modules/object-panel/components/ObjectPanel/ObjectPanelTabs';
import { ObjectPanelHeader } from '@modules/object-panel/components/ObjectPanel/ObjectPanelHeader';
import { getKindColorClass } from '@shared/utils/kindBadgeColors';
import { ObjectPanelContent } from '@modules/object-panel/components/ObjectPanel/ObjectPanelContent';
import {
  CLUSTER_SCOPE,
  RESOURCE_CAPABILITIES,
} from '@modules/object-panel/components/ObjectPanel/constants';
import type {
  PanelAction,
  PanelState,
  ViewType,
} from '@modules/object-panel/components/ObjectPanel/types';
import type { KubernetesObjectReference } from '@/types/view-state';
import { refreshOrchestrator } from '@/core/refresh/orchestrator';
import { getGroupForPanel, getGroupTabs } from '@ui/dockable/tabGroupState';
import type { DockPosition } from '@ui/dockable';
import { buildObjectDetailModel } from './Details/objectDetailModel';

// ============================================================================
// REDUCER
// ============================================================================
// activeTab is intentionally NOT in this reducer — it lives in
// ObjectPanelStateContext so it survives unmount/remount caused by
// cluster switching. The reducer's local state is reset on remount,
// which is the right behavior for modal flags but the wrong behavior
// for "which tab was the user looking at."
const INITIAL_PANEL_STATE: PanelState = {
  actionLoading: false,
  actionError: null,
  scaleReplicas: 1,
  showScaleInput: false,
  showRestartConfirm: false,
  showDeleteConfirm: false,
  showRollbackModal: false,
  resourceDeleted: false,
  deletedResourceName: '',
};

function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'SET_ACTION_LOADING':
      return { ...state, actionLoading: action.payload };
    case 'SET_ACTION_ERROR':
      return { ...state, actionError: action.payload };
    case 'SET_SCALE_REPLICAS':
      return { ...state, scaleReplicas: action.payload };
    case 'SHOW_SCALE_INPUT':
      return { ...state, showScaleInput: action.payload };
    case 'SHOW_RESTART_CONFIRM':
      return { ...state, showRestartConfirm: action.payload };
    case 'SHOW_DELETE_CONFIRM':
      return { ...state, showDeleteConfirm: action.payload };
    case 'SHOW_ROLLBACK_MODAL':
      return { ...state, showRollbackModal: action.payload };
    case 'SET_RESOURCE_DELETED':
      return {
        ...state,
        resourceDeleted: action.payload.deleted,
        deletedResourceName: action.payload.name,
      };
    case 'RESET_STATE':
      return { ...INITIAL_PANEL_STATE };
    default:
      return state;
  }
}

// ============================================================================
// COMPONENT PROPS
// ============================================================================
interface ObjectPanelProps {
  /** Unique panel ID derived from the object identity. */
  panelId: string;
  /** The Kubernetes object reference this panel displays. */
  objectRef: KubernetesObjectReference;
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================
function ObjectPanel({ panelId, objectRef }: ObjectPanelProps) {
  const objectData = objectRef;
  const { closePanel, getObjectPanelActiveTab, setObjectPanelActiveTab } = useObjectPanelState();
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

  // Use reducer for transient panel state (modal flags, action loading,
  // delete confirmation, etc.). The active sub-tab is intentionally NOT
  // in this reducer — it lives in ObjectPanelStateContext so it survives
  // unmount/remount caused by cluster switching. The reducer's local
  // state is reset on remount, which is the right behavior for modal
  // flags but the wrong behavior for "which tab was the user looking at."
  const [state, dispatch] = useReducer(panelReducer, INITIAL_PANEL_STATE);
  const activeTab: ViewType = getObjectPanelActiveTab(panelId) ?? 'details';

  const {
    objectKind,
    detailScope,
    eventsScope,
    containerLogsScope,
    mapScope,
    helmScope,
    isHelmRelease,
    isEvent,
  } = getObjectPanelKind(objectData, {
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
  const { detailPayload, detailsLoading, detailsError, fetchResourceDetails } =
    useObjectPanelRefresh({
      detailScope,
      objectKind,
      objectData,
      isOpen: isOpen && isActiveTab,
      resourceDeleted: state.resourceDeleted,
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
      if (state.resourceDeleted) {
        dispatch({ type: 'SET_RESOURCE_DELETED', payload: { deleted: false, name: '' } });
      }
    }
  }, [objectIdentityKey, state.resourceDeleted]);

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
    if (!isNotFoundError || state.resourceDeleted) {
      return;
    }
    dispatch({
      type: 'SET_RESOURCE_DELETED',
      payload: { deleted: true, name: objectData?.name ?? '' },
    });
    if (detailScope) {
      refreshOrchestrator.setScopedDomainEnabled('object-details', detailScope, false);
      refreshOrchestrator.resetScopedDomain('object-details', detailScope);
    }
  }, [detailScope, isNotFoundError, objectData?.name, state.resourceDeleted]);

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
    dispatch,
    currentTab: activeTab,
  });
  const visibleActiveTab: ViewType = useMemo(
    () => (availableTabs.some((tab) => tab.id === activeTab) ? activeTab : 'details'),
    [activeTab, availableTabs]
  );

  const podsState = useObjectPanelPods({
    objectData,
    objectKind,
    isOpen,
    activeTab: visibleActiveTab,
  });

  const {
    handleAction,
    setScaleReplicas,
    showScaleInput: openScaleInput,
    hideScaleInput: closeScaleInput,
    showRestartConfirm: openRestartConfirm,
    hideRestartConfirm: closeRestartConfirm,
    showDeleteConfirm: openDeleteConfirm,
    hideDeleteConfirm: closeDeleteConfirm,
    showRollbackModal: openRollbackModal,
    hideRollbackModal: closeRollbackModal,
  } = useObjectPanelActions({
    objectData,
    objectKind,
    isHelmRelease,
    state,
    dispatch,
    close,
    fetchResourceDetails,
  });

  // Keep DetailsTab props derived from this memoized model, not from the
  // enclosing props object; ObjectPanelContent depends on that stability.
  const detailModel = useMemo(
    () => buildObjectDetailModel(objectData ?? null, objectKind, detailPayload),
    [detailPayload, objectData, objectKind]
  );

  // CronJob trigger handler
  const handleTriggerClick = useCallback(async () => {
    if (!objectData?.name || !objectData?.namespace) return;
    dispatch({ type: 'SET_ACTION_LOADING', payload: true });
    try {
      // Multi-cluster rule (AGENTS.md): every backend command must
      // carry a resolved clusterId.
      if (!objectData.clusterId) {
        throw new Error(`Cannot trigger CronJob/${objectData.name}: clusterId is missing`);
      }
      await runCronJobTrigger(buildObjectActionTarget(objectData, 'trigger'));
    } catch (err) {
      errorHandler.handle(err, { action: 'trigger', kind: 'CronJob', name: objectData.name });
    } finally {
      dispatch({ type: 'SET_ACTION_LOADING', payload: false });
    }
  }, [objectData, dispatch]);

  // CronJob suspend/resume handler
  const handleSuspendToggle = useCallback(async () => {
    if (!objectData?.name || !objectData?.namespace) return;
    const isSuspended = detailModel.cronJobSuspended;
    dispatch({ type: 'SET_ACTION_LOADING', payload: true });
    try {
      // Multi-cluster rule (AGENTS.md): every backend command must
      // carry a resolved clusterId.
      if (!objectData.clusterId) {
        throw new Error(
          `Cannot ${isSuspended ? 'resume' : 'suspend'} CronJob/${objectData.name}: clusterId is missing`
        );
      }
      await runCronJobSuspend(
        buildObjectActionTarget(objectData, isSuspended ? 'resume' : 'suspend'),
        !isSuspended
      );
      await fetchResourceDetails('user');
    } catch (err) {
      errorHandler.handle(err, {
        action: isSuspended ? 'resume' : 'suspend',
        kind: 'CronJob',
        name: objectData.name,
      });
    } finally {
      dispatch({ type: 'SET_ACTION_LOADING', payload: false });
    }
  }, [detailModel, objectData, dispatch, fetchResourceDetails]);

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
        resourceDeleted: state.resourceDeleted,
        deletedResourceName: state.deletedResourceName,
        canRestart: capabilities.canRestart,
        canScale: capabilities.canScale,
        canDelete: capabilities.canDelete,
        canTrigger: capabilities.canTrigger,
        canSuspend: capabilities.canSuspend,
        restartDisabledReason: capabilityReasons.restart,
        scaleDisabledReason: capabilityReasons.scale,
        deleteDisabledReason: capabilityReasons.delete,
        actionLoading: state.actionLoading,
        actionError: state.actionError,
        scaleReplicas: state.scaleReplicas,
        showScaleInput: state.showScaleInput,
        onRestartClick: openRestartConfirm,
        onRollbackClick: openRollbackModal,
        onDeleteClick: openDeleteConfirm,
        onScaleClick: (replicas?: number) => {
          if (replicas !== undefined) {
            setScaleReplicas(replicas);
            void handleAction('scale', undefined, replicas);
          }
        },
        onScaleCancel: closeScaleInput,
        onScaleReplicasChange: setScaleReplicas,
        onShowScaleInput: () => {
          openScaleInput(detailModel.desiredScaleReplicas);
        },
        onTriggerClick: handleTriggerClick,
        onSuspendToggle: handleSuspendToggle,
      }
    : null;

  const panelScopeRef = useRef<HTMLDivElement>(null);

  // Memoize the per-instance context value so child components get the correct objectData.
  const currentObjectPanelValue = useMemo(() => ({ objectData, panelId }), [objectData, panelId]);

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
        {/* Kind badge + name toolbar */}
        <div onMouseDown={(e) => e.stopPropagation()}>
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
          resourceDeleted={state.resourceDeleted}
          deletedResourceName={state.deletedResourceName}
          onClosePanel={close}
          onRefreshDetails={fetchResourceDetails}
          podsState={podsState}
          panelId={panelId}
        />
      </DockablePanel>

      {/* Confirmation Modals */}
      <ConfirmationModal
        isOpen={state.showRestartConfirm}
        title="Restart Workload"
        message={`Are you sure you want to restart ${objectData?.kind} "${objectData?.name}"?\n\nThis will trigger a rolling restart of all pods.`}
        confirmText="Restart"
        cancelText="Cancel"
        confirmButtonClass="warning"
        onConfirm={() => handleAction('restart', 'showRestartConfirm')}
        onCancel={closeRestartConfirm}
      />

      <ConfirmationModal
        isOpen={state.showDeleteConfirm}
        title={`Delete ${objectData?.kind || 'Resource'}`}
        message={`Are you sure you want to delete ${objectData?.kind?.toLowerCase() || 'resource'} "${objectData?.name}"?\n\nThis action cannot be undone.`}
        confirmText="Delete"
        cancelText="Cancel"
        confirmButtonClass="danger"
        onConfirm={() => handleAction('delete', 'showDeleteConfirm')}
        onCancel={closeDeleteConfirm}
      />

      {/* Rollback Modal — opens the revision history picker for rollbackable workloads.
          Only mounted when objectData has a resolved clusterId + kind + name + namespace —
          the modal's confirm button issues a backend command and per the multi-cluster
          rule (AGENTS.md) every command must carry a cluster identity. */}
      {state.showRollbackModal &&
        objectData?.clusterId &&
        objectData.kind &&
        objectData.version &&
        objectData.name &&
        objectData.namespace && (
          <RollbackModal
            isOpen={true}
            onClose={closeRollbackModal}
            clusterId={objectData.clusterId}
            namespace={objectData.namespace}
            group={objectData.group ?? ''}
            version={objectData.version}
            name={objectData.name}
            kind={objectData.kind}
          />
        )}
    </CurrentObjectPanelContext.Provider>
  );
}

export default ObjectPanel;
