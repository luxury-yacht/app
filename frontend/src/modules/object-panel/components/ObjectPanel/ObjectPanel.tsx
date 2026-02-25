/**
 * frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.tsx
 *
 * Each instance renders a single object as a dockable tab.
 * Accepts objectRef and panelId as props; uses CurrentObjectPanelContext
 * so child components can access the correct object data.
 */

import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import type { DetailsTabProps } from '@modules/object-panel/components/ObjectPanel/Details/DetailsTab';
import { types } from '@wailsjs/go/models';
import { TriggerCronJob, SuspendCronJob } from '@wailsjs/go/backend/App';
import { DockablePanel, useDockablePanelContext } from '@ui/dockable';
import { errorHandler } from '@utils/errorHandler';
import { CurrentObjectPanelContext } from '@modules/object-panel/hooks/useObjectPanel';
import { useObjectPanelState } from '@/core/contexts/ObjectPanelStateContext';
import { evaluateNamespacePermissions } from '@/core/capabilities';
import {
  clearRequestedObjectPanelTab,
  getRequestedObjectPanelTab,
  subscribeObjectPanelTabRequests,
} from '@modules/object-panel/objectPanelTabRequests';
import './ObjectPanel.css';
import '@shared/components/tabs/Tabs/Tabs.css';
import { getObjectPanelKind } from '@modules/object-panel/components/ObjectPanel/hooks/getObjectPanelKind';
import { useObjectPanelFeatureSupport } from '@modules/object-panel/components/ObjectPanel/hooks/useObjectPanelFeatureSupport';
import { useObjectPanelCapabilities } from '@modules/object-panel/components/ObjectPanel/hooks/useObjectPanelCapabilities';
import { useObjectPanelActions } from '@modules/object-panel/components/ObjectPanel/hooks/useObjectPanelActions';
import { useObjectPanelRefresh } from '@modules/object-panel/components/ObjectPanel/hooks/useObjectPanelRefresh';
import { useObjectPanelTabs } from '@modules/object-panel/components/ObjectPanel/hooks/useObjectPanelTabs';
import { useObjectPanelPods } from '@modules/object-panel/components/ObjectPanel/hooks/useObjectPanelPods';
import { ObjectPanelTabs } from '@modules/object-panel/components/ObjectPanel/ObjectPanelTabs';
import { ObjectPanelHeader } from '@modules/object-panel/components/ObjectPanel/ObjectPanelHeader';
import { ObjectPanelContent } from '@modules/object-panel/components/ObjectPanel/ObjectPanelContent';
import {
  CLUSTER_SCOPE,
  RESOURCE_CAPABILITIES,
  WORKLOAD_KIND_API_NAMES,
} from '@modules/object-panel/components/ObjectPanel/constants';
import type {
  PanelAction,
  PanelState,
  ViewType,
} from '@modules/object-panel/components/ObjectPanel/types';
import type { KubernetesObjectReference } from '@/types/view-state';
import { useKeyboardNavigationScope } from '@ui/shortcuts';
import { KeyboardScopePriority } from '@ui/shortcuts/priorities';
import { refreshOrchestrator } from '@/core/refresh/orchestrator';
import { getGroupForPanel, getGroupTabs } from '@ui/dockable/tabGroupState';
import type { DockPosition } from '@ui/dockable';

// Tab configuration
type DetailsSnapshotProps = Pick<
  DetailsTabProps,
  | 'podDetails'
  | 'deploymentDetails'
  | 'replicaSetDetails'
  | 'daemonSetDetails'
  | 'statefulSetDetails'
  | 'jobDetails'
  | 'cronJobDetails'
  | 'configMapDetails'
  | 'secretDetails'
  | 'helmReleaseDetails'
  | 'serviceDetails'
  | 'ingressDetails'
  | 'networkPolicyDetails'
  | 'endpointSliceDetails'
  | 'pvcDetails'
  | 'pvDetails'
  | 'storageClassDetails'
  | 'serviceAccountDetails'
  | 'roleDetails'
  | 'roleBindingDetails'
  | 'clusterRoleDetails'
  | 'clusterRoleBindingDetails'
  | 'hpaDetails'
  | 'pdbDetails'
  | 'resourceQuotaDetails'
  | 'limitRangeDetails'
  | 'nodeDetails'
  | 'namespaceDetails'
  | 'ingressClassDetails'
  | 'crdDetails'
  | 'mutatingWebhookDetails'
  | 'validatingWebhookDetails'
>;

const EMPTY_DETAILS: DetailsSnapshotProps = {
  podDetails: null,
  deploymentDetails: null,
  replicaSetDetails: null,
  daemonSetDetails: null,
  statefulSetDetails: null,
  jobDetails: null,
  cronJobDetails: null,
  configMapDetails: null,
  secretDetails: null,
  helmReleaseDetails: null,
  serviceDetails: null,
  ingressDetails: null,
  networkPolicyDetails: null,
  endpointSliceDetails: null,
  pvcDetails: null,
  pvDetails: null,
  storageClassDetails: null,
  serviceAccountDetails: null,
  roleDetails: null,
  roleBindingDetails: null,
  clusterRoleDetails: null,
  clusterRoleBindingDetails: null,
  hpaDetails: null,
  pdbDetails: null,
  resourceQuotaDetails: null,
  limitRangeDetails: null,
  nodeDetails: null,
  namespaceDetails: null,
  ingressClassDetails: null,
  crdDetails: null,
  mutatingWebhookDetails: null,
  validatingWebhookDetails: null,
};

// ============================================================================
// REDUCER
// ============================================================================
const INITIAL_PANEL_STATE: PanelState = {
  activeTab: 'details',
  actionLoading: false,
  actionError: null,
  scaleReplicas: 1,
  showScaleInput: false,
  showRestartConfirm: false,
  showDeleteConfirm: false,
  resourceDeleted: false,
  deletedResourceName: '',
};

function panelReducer(state: PanelState, action: PanelAction): PanelState {
  switch (action.type) {
    case 'SET_ACTIVE_TAB':
      return { ...state, activeTab: action.payload };
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
  const { closePanel } = useObjectPanelState();
  const { tabGroups, getPreferredOpenGroupKey } = useDockablePanelContext();
  const openTargetGroupKey = getPreferredOpenGroupKey('right');
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
  const tabKindClass = (objectData?.kind || objectData?.kindAlias || 'object')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

  // Use reducer for state management
  const [state, dispatch] = useReducer(panelReducer, INITIAL_PANEL_STATE);

  const { objectKind, detailScope, helmScope, isHelmRelease, isEvent } = getObjectPanelKind(
    objectData,
    {
      clusterScope: CLUSTER_SCOPE,
    }
  );

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
    evaluateNamespacePermissions(namespace, { clusterId: objectData?.clusterId ?? null });
  }, [objectData?.clusterId, objectData?.namespace]);

  const featureSupport = useObjectPanelFeatureSupport(objectKind, RESOURCE_CAPABILITIES);

  const { capabilities, capabilityReasons } = useObjectPanelCapabilities({
    objectData,
    objectKind,
    detailScope,
    featureSupport,
    workloadKindApiNames: WORKLOAD_KIND_API_NAMES,
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

  // Get available tabs based on capabilities
  const { availableTabs } = useObjectPanelTabs({
    capabilities,
    objectData,
    isHelmRelease,
    isEvent,
    isOpen,
    dispatch,
    close,
    currentTab: state.activeTab,
  });

  const podsState = useObjectPanelPods({
    objectData,
    objectKind,
    isOpen,
    activeTab: state.activeTab,
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
  } = useObjectPanelActions({
    objectData,
    objectKind,
    state,
    dispatch,
    close,
    fetchResourceDetails,
    workloadKindApiNames: WORKLOAD_KIND_API_NAMES,
  });

  // CronJob trigger handler
  const handleTriggerClick = useCallback(async () => {
    if (!objectData?.name || !objectData?.namespace) return;
    dispatch({ type: 'SET_ACTION_LOADING', payload: true });
    try {
      await TriggerCronJob(objectData.clusterId ?? '', objectData.namespace, objectData.name);
    } catch (err) {
      errorHandler.handle(err, { action: 'trigger', kind: 'CronJob', name: objectData.name });
    } finally {
      dispatch({ type: 'SET_ACTION_LOADING', payload: false });
    }
  }, [objectData, dispatch]);

  // CronJob suspend/resume handler
  const handleSuspendToggle = useCallback(async () => {
    if (!objectData?.name || !objectData?.namespace) return;
    const cronJobDetails = detailPayload as types.CronJobDetails | null;
    const isSuspended = cronJobDetails?.suspend ?? false;
    dispatch({ type: 'SET_ACTION_LOADING', payload: true });
    try {
      await SuspendCronJob(
        objectData.clusterId ?? '',
        objectData.namespace,
        objectData.name,
        !isSuspended
      );
      await fetchResourceDetails(true);
    } catch (err) {
      errorHandler.handle(err, {
        action: isSuspended ? 'resume' : 'suspend',
        kind: 'CronJob',
        name: objectData.name,
      });
    } finally {
      dispatch({ type: 'SET_ACTION_LOADING', payload: false });
    }
  }, [objectData, detailPayload, dispatch, fetchResourceDetails]);

  const handleTabSelect = useCallback(
    (tab: ViewType) => {
      dispatch({ type: 'SET_ACTIVE_TAB', payload: tab });
    },
    [dispatch]
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
      if (state.activeTab !== requestedTab) {
        dispatch({ type: 'SET_ACTIVE_TAB', payload: requestedTab });
      }
      clearRequestedObjectPanelTab(panelId);
    },
    [availableTabs, panelId, state.activeTab]
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

  // Extract details props for DetailsTab - provide all required props with defaults
  const detailsProps = useMemo<DetailsSnapshotProps>(() => {
    if (!detailPayload || !objectKind) {
      return EMPTY_DETAILS;
    }

    switch (objectKind) {
      case 'pod':
        return { ...EMPTY_DETAILS, podDetails: detailPayload as types.PodDetailInfo };
      case 'deployment':
        return { ...EMPTY_DETAILS, deploymentDetails: detailPayload as types.DeploymentDetails };
      case 'replicaset':
        return { ...EMPTY_DETAILS, replicaSetDetails: detailPayload as types.ReplicaSetDetails };
      case 'daemonset':
        return { ...EMPTY_DETAILS, daemonSetDetails: detailPayload as types.DaemonSetDetails };
      case 'statefulset':
        return {
          ...EMPTY_DETAILS,
          statefulSetDetails: detailPayload as types.StatefulSetDetails,
        };
      case 'job':
        return { ...EMPTY_DETAILS, jobDetails: detailPayload as types.JobDetails };
      case 'cronjob':
        return { ...EMPTY_DETAILS, cronJobDetails: detailPayload as types.CronJobDetails };
      case 'configmap':
        return { ...EMPTY_DETAILS, configMapDetails: detailPayload as types.ConfigMapDetails };
      case 'secret':
        return { ...EMPTY_DETAILS, secretDetails: detailPayload as types.SecretDetails };
      case 'helmrelease':
        return {
          ...EMPTY_DETAILS,
          helmReleaseDetails: detailPayload as types.HelmReleaseDetails,
        };
      case 'service':
        return { ...EMPTY_DETAILS, serviceDetails: detailPayload as types.ServiceDetails };
      case 'ingress':
        return { ...EMPTY_DETAILS, ingressDetails: detailPayload as types.IngressDetails };
      case 'networkpolicy':
        return {
          ...EMPTY_DETAILS,
          networkPolicyDetails: detailPayload as types.NetworkPolicyDetails,
        };
      case 'endpointslice':
        return {
          ...EMPTY_DETAILS,
          endpointSliceDetails: detailPayload as types.EndpointSliceDetails,
        };
      case 'persistentvolumeclaim':
        return {
          ...EMPTY_DETAILS,
          pvcDetails: detailPayload as types.PersistentVolumeClaimDetails,
        };
      case 'persistentvolume':
        return { ...EMPTY_DETAILS, pvDetails: detailPayload as types.PersistentVolumeDetails };
      case 'storageclass':
        return {
          ...EMPTY_DETAILS,
          storageClassDetails: detailPayload as types.StorageClassDetails,
        };
      case 'serviceaccount':
        return {
          ...EMPTY_DETAILS,
          serviceAccountDetails: detailPayload as types.ServiceAccountDetails,
        };
      case 'role':
        return { ...EMPTY_DETAILS, roleDetails: detailPayload as types.RoleDetails };
      case 'rolebinding':
        return {
          ...EMPTY_DETAILS,
          roleBindingDetails: detailPayload as types.RoleBindingDetails,
        };
      case 'clusterrole':
        return {
          ...EMPTY_DETAILS,
          clusterRoleDetails: detailPayload as types.ClusterRoleDetails,
        };
      case 'clusterrolebinding':
        return {
          ...EMPTY_DETAILS,
          clusterRoleBindingDetails: detailPayload as types.ClusterRoleBindingDetails,
        };
      case 'horizontalpodautoscaler':
        return {
          ...EMPTY_DETAILS,
          hpaDetails: detailPayload as types.HorizontalPodAutoscalerDetails,
        };
      case 'poddisruptionbudget':
        return {
          ...EMPTY_DETAILS,
          pdbDetails: detailPayload as types.PodDisruptionBudgetDetails,
        };
      case 'resourcequota':
        return {
          ...EMPTY_DETAILS,
          resourceQuotaDetails: detailPayload as types.ResourceQuotaDetails,
        };
      case 'limitrange':
        return { ...EMPTY_DETAILS, limitRangeDetails: detailPayload as types.LimitRangeDetails };
      case 'node':
        return { ...EMPTY_DETAILS, nodeDetails: detailPayload as types.NodeDetails };
      case 'namespace':
        return { ...EMPTY_DETAILS, namespaceDetails: detailPayload as types.NamespaceDetails };
      case 'ingressclass':
        return {
          ...EMPTY_DETAILS,
          ingressClassDetails: detailPayload as types.IngressClassDetails,
        };
      case 'customresourcedefinition':
        return {
          ...EMPTY_DETAILS,
          crdDetails: detailPayload as types.CustomResourceDefinitionDetails,
        };
      case 'mutatingwebhookconfiguration':
        return {
          ...EMPTY_DETAILS,
          mutatingWebhookDetails: detailPayload as types.MutatingWebhookConfigurationDetails,
        };
      case 'validatingwebhookconfiguration':
        return {
          ...EMPTY_DETAILS,
          validatingWebhookDetails: detailPayload as types.ValidatingWebhookConfigurationDetails,
        };
      default:
        return EMPTY_DETAILS;
    }
  }, [detailPayload, objectKind]);

  const detailTabProps: DetailsTabProps | null = objectData
    ? {
        ...detailsProps,
        objectData,
        isActive: isOpen && state.activeTab === 'details',
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
          const currentReplicas = (() => {
            if (objectKind === 'deployment') {
              const details = detailPayload as types.DeploymentDetails | null | undefined;
              return details?.desiredReplicas ?? 1;
            }
            if (objectKind === 'statefulset') {
              const details = detailPayload as types.StatefulSetDetails | null | undefined;
              return details?.desiredReplicas ?? 1;
            }
            return 1;
          })();
          openScaleInput(currentReplicas);
        },
        onTriggerClick: handleTriggerClick,
        onSuspendToggle: handleSuspendToggle,
      }
    : null;

  const panelScopeRef = useRef<HTMLDivElement>(null);

  const getFocusableElements = useCallback(() => {
    if (!panelScopeRef.current) {
      return [];
    }
    const nodes = Array.from(
      panelScopeRef.current.querySelectorAll<HTMLElement>('[data-object-panel-focusable="true"]')
    );
    return nodes.filter((node) => !node.hasAttribute('disabled'));
  }, []);

  const focusElementAt = useCallback(
    (index: number) => {
      const items = getFocusableElements();
      if (index < 0 || index >= items.length) {
        return false;
      }
      items[index].focus();
      return true;
    },
    [getFocusableElements]
  );

  const focusFirstControl = useCallback(() => focusElementAt(0), [focusElementAt]);
  const focusLastControl = useCallback(() => {
    const items = getFocusableElements();
    return focusElementAt(items.length - 1);
  }, [focusElementAt, getFocusableElements]);

  const findFocusedIndex = useCallback(() => {
    const active = document.activeElement as HTMLElement | null;
    if (!active) {
      return -1;
    }
    const items = getFocusableElements();
    return items.findIndex((item) => item === active || item.contains(active));
  }, [getFocusableElements]);

  useKeyboardNavigationScope({
    ref: panelScopeRef,
    priority: KeyboardScopePriority.OBJECT_PANEL,
    disabled: !isActiveTab,
    allowNativeSelector: '.object-panel-body *',
    onNavigate: ({ direction }) => {
      const items = getFocusableElements();
      if (items.length === 0) {
        return 'bubble';
      }
      const currentIndex = findFocusedIndex();
      if (currentIndex === -1) {
        return direction === 'forward'
          ? focusFirstControl()
            ? 'handled'
            : 'bubble'
          : focusLastControl()
            ? 'handled'
            : 'bubble';
      }
      const nextIndex = direction === 'forward' ? currentIndex + 1 : currentIndex - 1;
      if (nextIndex < 0 || nextIndex >= items.length) {
        return 'bubble';
      }
      focusElementAt(nextIndex);
      return 'handled';
    },
    onEnter: ({ direction }) => {
      if (direction === 'forward') {
        focusFirstControl();
      } else {
        focusLastControl();
      }
    },
  });

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
          activeTab={state.activeTab}
          onSelect={handleTabSelect}
        />

        <ObjectPanelContent
          activeTab={state.activeTab}
          detailTabProps={detailTabProps}
          isPanelOpen={isOpen}
          capabilities={capabilities}
          capabilityReasons={capabilityReasons}
          detailScope={detailScope}
          helmScope={helmScope}
          objectData={objectData}
          objectKind={objectKind}
          resourceDeleted={state.resourceDeleted}
          deletedResourceName={state.deletedResourceName}
          onClosePanel={close}
          onRefreshDetails={fetchResourceDetails}
          podsState={podsState}
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
    </CurrentObjectPanelContext.Provider>
  );
}

export default ObjectPanel;
