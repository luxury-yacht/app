/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Maintenance/NodeMaintenanceTab.tsx
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import ClusterDataPausedState from '@shared/components/ClusterDataPausedState';
import {
  CancelDrainNodeJob,
  CordonNode,
  DeleteNode,
  StartDrainNode,
  UncordonNode,
} from '@wailsjs/go/backend/App';
import { types } from '@wailsjs/go/models';
import ConfirmationModal from '@shared/components/modals/ConfirmationModal';
import Tooltip from '@shared/components/Tooltip';
import { requestRefreshDomain } from '@/core/data-access';
import { refreshOrchestrator, useRefreshScopedDomain } from '@/core/refresh';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { applyPassiveLoadingPolicy } from '@/core/refresh/loadingPolicy';
import type { NodeMaintenanceSnapshotPayload } from '@/core/refresh/types';
import { useCapabilities, type CapabilityDescriptor } from '@/core/capabilities';
import { errorHandler } from '@/utils/errorHandler';
import { INACTIVE_SCOPE } from '@modules/object-panel/components/ObjectPanel/constants';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { DrainProgressCard } from './DrainProgressCard';
import './MaintenanceTab.css';

type MaintenanceAction = 'cordon' | 'uncordon';

interface NodeMaintenanceTabProps {
  nodeDetails: types.NodeDetails | null;
  objectName?: string | null;
  onRefresh?: () => void;
  isActive: boolean;
  clusterId: string | null;
}

const CAPABILITY_PREFIX = 'object-maintenance';
const NODE_SCOPE_PREFIX = 'node:';
const MAX_NODE_DRAIN_GRACE_SECONDS = 900;
const DEFAULT_NODE_DRAIN_TIMEOUT_SECONDS = 300;

type DrainOptionsState = Omit<types.DrainNodeOptions, 'gracePeriodSeconds' | 'timeoutSeconds'> & {
  gracePeriodSeconds?: number;
  timeoutSeconds?: number;
};

const toScope = (nodeName?: string | null): string | null => {
  if (!nodeName) {
    return null;
  }
  const trimmed = nodeName.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  return `${NODE_SCOPE_PREFIX}${trimmed}`;
};

const normalizeGraceSeconds = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 30;
  }
  return Math.min(MAX_NODE_DRAIN_GRACE_SECONDS, Math.max(1, Math.floor(value)));
};

const normalizeTimeoutSeconds = (value: number): number => {
  if (!Number.isFinite(value)) {
    return DEFAULT_NODE_DRAIN_TIMEOUT_SECONDS;
  }
  return Math.max(1, Math.floor(value));
};

const useNodeMaintenanceDomain = (
  nodeName?: string | null,
  enabled?: boolean,
  clusterId?: string | null
) => {
  const scope = useMemo(() => {
    const rawScope = toScope(nodeName);
    const resolvedClusterId = clusterId?.trim();
    if (!rawScope || !resolvedClusterId) {
      return null;
    }
    return buildClusterScope(resolvedClusterId, rawScope);
  }, [clusterId, nodeName]);
  const snapshot = useRefreshScopedDomain(
    'object-maintenance',
    scope ?? INACTIVE_SCOPE
  ) as NodeMaintenanceSnapshotPayloadState;

  useEffect(() => {
    if (!scope) {
      return;
    }
    const active = Boolean(enabled && nodeName);
    refreshOrchestrator.setScopedDomainEnabled('object-maintenance', scope, active);
    return () => {
      refreshOrchestrator.setScopedDomainEnabled('object-maintenance', scope, false);
      refreshOrchestrator.resetScopedDomain('object-maintenance', scope);
    };
  }, [scope, enabled, nodeName]);

  const refresh = useCallback(async () => {
    if (!scope) {
      return;
    }
    try {
      await requestRefreshDomain({
        domain: 'object-maintenance',
        scope,
        reason: 'user',
      });
    } catch (error) {
      errorHandler.handle(error instanceof Error ? error : new Error(String(error)), {
        source: 'node-maintenance-refresh',
      });
    }
  }, [scope]);

  useEffect(() => {
    if (scope && enabled) {
      void requestRefreshDomain({
        domain: 'object-maintenance',
        scope,
        reason: 'startup',
      });
    }
  }, [enabled, scope]);

  return {
    scope,
    snapshot,
    refresh,
  };
};

type NodeMaintenanceSnapshotPayloadState = ReturnType<typeof useRefreshScopedDomain> & {
  data: NodeMaintenanceSnapshotPayload | null;
};

export function NodeMaintenanceTab({
  nodeDetails,
  objectName,
  onRefresh,
  isActive,
  clusterId,
}: NodeMaintenanceTabProps) {
  const { isPaused, isManualRefreshActive } = useAutoRefreshLoadingState();
  const [pendingAction, setPendingAction] = useState<MaintenanceAction | null>(null);
  const [cordonError, setCordonError] = useState<string | null>(null);
  const [drainOptions, setDrainOptions] = useState<DrainOptionsState>({
    ignoreDaemonSets: true,
    deleteEmptyDirData: true,
    force: false,
    disableEviction: false,
    skipWaitForPodsToTerminate: false,
  });
  const [customGraceSeconds, setCustomGraceSeconds] = useState(30);
  const [customTimeoutSeconds, setCustomTimeoutSeconds] = useState(
    DEFAULT_NODE_DRAIN_TIMEOUT_SECONDS
  );
  const [drainPending, setDrainPending] = useState(false);
  const [drainError, setDrainError] = useState<string | null>(null);
  const [cancelDrainPending, setCancelDrainPending] = useState(false);
  const [drainStartStatus, setDrainStartStatus] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteStatus, setDeleteStatus] = useState<string | null>(null);
  const [showCordonConfirm, setShowCordonConfirm] = useState(false);
  const [showDrainConfirm, setShowDrainConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const resolvedClusterId = clusterId?.trim() ?? '';

  const nodeName = useMemo(() => {
    const fromDetails = nodeDetails?.name?.trim();
    if (fromDetails) {
      return fromDetails;
    }
    const fromObject = objectName?.trim();
    return fromObject ?? '';
  }, [nodeDetails?.name, objectName]);

  const {
    scope: maintenanceScope,
    snapshot: maintenanceSnapshot,
    refresh: refreshMaintenance,
  } = useNodeMaintenanceDomain(nodeName, isActive && Boolean(nodeDetails), resolvedClusterId);

  const drains = useMemo(
    () => (maintenanceScope ? (maintenanceSnapshot.data?.drains ?? []) : []),
    [maintenanceScope, maintenanceSnapshot.data]
  );
  const activeDrainJob = useMemo(
    () => drains.find((job) => job.status === 'running' || job.status === 'canceling') ?? null,
    [drains]
  );
  const drainsLoadingState = applyPassiveLoadingPolicy({
    loading: maintenanceScope
      ? maintenanceSnapshot.status === 'loading' ||
        (maintenanceSnapshot.status === 'updating' && !maintenanceSnapshot.data)
      : false,
    hasLoaded: Boolean(maintenanceSnapshot.data),
    hasData: drains.length > 0,
    isPaused,
    isManualRefreshActive,
  });
  const drainsLoading = drainsLoadingState.loading;
  const showPausedDrainHistoryState = drainsLoadingState.showPausedEmptyState;

  const capabilityDescriptors = useMemo<CapabilityDescriptor[]>(() => {
    if (!nodeName || !resolvedClusterId) {
      return [];
    }
    // Node is core/v1. Group/version are required since PR #139 retired
    // kind-only resolution in the backend permission resolver.
    return [
      {
        id: `${CAPABILITY_PREFIX}:node-get:${nodeName}`,
        clusterId: resolvedClusterId,
        verb: 'get',
        group: '',
        version: 'v1',
        resourceKind: 'Node',
        name: nodeName,
      },
      {
        id: `${CAPABILITY_PREFIX}:cordon:${nodeName}`,
        clusterId: resolvedClusterId,
        verb: 'patch',
        group: '',
        version: 'v1',
        resourceKind: 'Node',
        name: nodeName,
      },
      {
        id: `${CAPABILITY_PREFIX}:drain:${nodeName}`,
        clusterId: resolvedClusterId,
        verb: 'patch',
        group: '',
        version: 'v1',
        resourceKind: 'Node',
        name: nodeName,
      },
      {
        id: `${CAPABILITY_PREFIX}:drain-pods:${drainOptions.disableEviction ? 'delete' : 'eviction'}:${nodeName}`,
        clusterId: resolvedClusterId,
        verb: drainOptions.disableEviction ? 'delete' : 'create',
        group: '',
        version: 'v1',
        resourceKind: 'Pod',
        subresource: drainOptions.disableEviction ? undefined : 'eviction',
      },
      {
        id: `${CAPABILITY_PREFIX}:delete:${nodeName}`,
        clusterId: resolvedClusterId,
        verb: 'delete',
        group: '',
        version: 'v1',
        resourceKind: 'Node',
        name: nodeName,
      },
    ];
  }, [drainOptions.disableEviction, nodeName, resolvedClusterId]);

  const { getState: getCapabilityState } = useCapabilities(capabilityDescriptors, {
    enabled: Boolean(nodeName && resolvedClusterId),
    refreshKey: `${resolvedClusterId}:${nodeName}`,
  });

  const cordonCapability = useMemo(() => {
    if (!nodeName) {
      return null;
    }
    return getCapabilityState(`${CAPABILITY_PREFIX}:cordon:${nodeName}`);
  }, [getCapabilityState, nodeName]);

  const nodeActionGetCapability = useMemo(() => {
    if (!nodeName) {
      return null;
    }
    return getCapabilityState(`${CAPABILITY_PREFIX}:node-get:${nodeName}`);
  }, [getCapabilityState, nodeName]);

  const drainCapability = useMemo(() => {
    if (!nodeName) {
      return null;
    }
    return getCapabilityState(`${CAPABILITY_PREFIX}:drain:${nodeName}`);
  }, [getCapabilityState, nodeName]);

  const drainPodCapability = useMemo(() => {
    if (!nodeName) {
      return null;
    }
    return getCapabilityState(
      `${CAPABILITY_PREFIX}:drain-pods:${drainOptions.disableEviction ? 'delete' : 'eviction'}:${nodeName}`
    );
  }, [drainOptions.disableEviction, getCapabilityState, nodeName]);

  const deleteCapability = useMemo(() => {
    if (!nodeName) {
      return null;
    }
    return getCapabilityState(`${CAPABILITY_PREFIX}:delete:${nodeName}`);
  }, [getCapabilityState, nodeName]);

  const cordonDisabledReason =
    nodeActionGetCapability && !nodeActionGetCapability.allowed && !nodeActionGetCapability.pending
      ? nodeActionGetCapability.reason || 'You do not have permission to read nodes.'
      : cordonCapability && !cordonCapability.allowed && !cordonCapability.pending
        ? cordonCapability.reason || 'You do not have permission to modify nodes.'
        : null;

  const drainDisabledReason =
    nodeActionGetCapability && !nodeActionGetCapability.allowed && !nodeActionGetCapability.pending
      ? nodeActionGetCapability.reason || 'You do not have permission to read nodes.'
      : drainCapability && !drainCapability.allowed && !drainCapability.pending
        ? drainCapability.reason || 'You do not have permission to patch nodes.'
        : drainPodCapability && !drainPodCapability.allowed && !drainPodCapability.pending
          ? drainPodCapability.reason ||
            (drainOptions.disableEviction
              ? 'You do not have permission to delete pods.'
              : 'You do not have permission to evict pods.')
          : null;

  const deleteDisabledReason =
    deleteCapability && !deleteCapability.allowed && !deleteCapability.pending
      ? deleteCapability.reason || 'You do not have permission to delete nodes.'
      : null;

  const unschedulable = Boolean(nodeDetails?.unschedulable);
  const actionForState: MaintenanceAction = unschedulable ? 'uncordon' : 'cordon';

  const updateDrainOption = useCallback(
    <K extends keyof DrainOptionsState>(field: K, value: DrainOptionsState[K]) => {
      setDrainOptions((previous) => ({ ...previous, [field]: value }));
      setDrainError(null);
      setDrainStartStatus(null);
    },
    []
  );

  const executeAction = useCallback(
    async (action: MaintenanceAction) => {
      if (!nodeName || !resolvedClusterId || pendingAction) {
        return;
      }

      setCordonError(null);
      setPendingAction(action);
      try {
        if (action === 'cordon') {
          await CordonNode(resolvedClusterId, nodeName);
        } else {
          await UncordonNode(resolvedClusterId, nodeName);
        }
        onRefresh?.();
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : typeof error === 'string'
              ? error
              : 'Unknown error';
        setCordonError(message);
        errorHandler.handle(
          error instanceof Error ? error : new Error(message || 'Node maintenance failed'),
          {
            source: 'object-maintenance',
            context: { action, nodeName },
          }
        );
      } finally {
        setPendingAction(null);
      }
    },
    [nodeName, pendingAction, onRefresh, resolvedClusterId]
  );

  const hasCustomGrace = useMemo(() => {
    const raw = drainOptions.gracePeriodSeconds;
    if (raw == null) {
      return false;
    }
    return raw > 0;
  }, [drainOptions.gracePeriodSeconds]);

  const hasCustomTimeout = useMemo(() => {
    const raw = drainOptions.timeoutSeconds;
    if (raw == null) {
      return false;
    }
    return raw > 0;
  }, [drainOptions.timeoutSeconds]);

  const customizedDrainOptionCount = useMemo(() => {
    let count = 0;
    if (!drainOptions.ignoreDaemonSets) count += 1;
    if (!drainOptions.deleteEmptyDirData) count += 1;
    if (drainOptions.force) count += 1;
    if (drainOptions.disableEviction) count += 1;
    if (drainOptions.skipWaitForPodsToTerminate) count += 1;
    if (hasCustomGrace) count += 1;
    if (hasCustomTimeout) count += 1;
    return count;
  }, [
    drainOptions.deleteEmptyDirData,
    drainOptions.disableEviction,
    drainOptions.force,
    drainOptions.ignoreDaemonSets,
    drainOptions.skipWaitForPodsToTerminate,
    hasCustomGrace,
    hasCustomTimeout,
  ]);

  const drainConfirmationMessage = useMemo(() => {
    const graceText = hasCustomGrace ? `${drainOptions.gracePeriodSeconds ?? 0}s` : 'Pod defaults';
    const timeoutText = hasCustomTimeout ? `${drainOptions.timeoutSeconds ?? 0}s` : 'No timeout';
    const lines = [
      `Grace period: ${graceText}`,
      `Drain timeout: ${timeoutText}`,
      drainOptions.disableEviction ? 'Delete pods directly' : 'Use eviction API',
      drainOptions.ignoreDaemonSets ? 'Ignore DaemonSets' : 'Respect DaemonSets',
      drainOptions.deleteEmptyDirData ? 'Delete emptyDir data' : 'Preserve emptyDir data',
      drainOptions.force ? 'Allow unmanaged pods' : 'Refuse unmanaged pods',
    ];
    return `Drain node "${nodeName}" with the following options:\n• ${lines.join('\n• ')}`;
  }, [
    drainOptions.deleteEmptyDirData,
    drainOptions.disableEviction,
    drainOptions.force,
    drainOptions.gracePeriodSeconds,
    drainOptions.ignoreDaemonSets,
    drainOptions.timeoutSeconds,
    hasCustomGrace,
    hasCustomTimeout,
    nodeName,
  ]);

  const executeDrain = useCallback(async () => {
    if (!nodeName || !resolvedClusterId || drainPending) {
      return;
    }
    setDrainError(null);
    setDrainStartStatus(null);
    setDrainPending(true);
    try {
      const payload: types.DrainNodeOptions = {
        ignoreDaemonSets: drainOptions.ignoreDaemonSets,
        deleteEmptyDirData: drainOptions.deleteEmptyDirData,
        force: drainOptions.force,
        disableEviction: drainOptions.disableEviction,
        skipWaitForPodsToTerminate: drainOptions.skipWaitForPodsToTerminate,
      };
      if (drainOptions.gracePeriodSeconds != null) {
        payload.gracePeriodSeconds = normalizeGraceSeconds(drainOptions.gracePeriodSeconds);
      }
      if (drainOptions.timeoutSeconds != null && drainOptions.timeoutSeconds > 0) {
        payload.timeoutSeconds = normalizeTimeoutSeconds(drainOptions.timeoutSeconds);
      }
      const jobId = await StartDrainNode(resolvedClusterId, nodeName, payload);
      setDrainStartStatus(`Drain job ${jobId} started.`);
      onRefresh?.();
      await refreshMaintenance();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Unknown error';
      setDrainError(message);
      errorHandler.handle(error instanceof Error ? error : new Error(message || 'Drain failed'), {
        source: 'object-maintenance',
        context: { action: 'drain', nodeName },
      });
    } finally {
      setDrainPending(false);
    }
  }, [nodeName, drainPending, drainOptions, onRefresh, refreshMaintenance, resolvedClusterId]);

  const cancelActiveDrain = useCallback(async () => {
    if (!resolvedClusterId || !activeDrainJob || cancelDrainPending) {
      return;
    }
    setDrainError(null);
    setCancelDrainPending(true);
    try {
      await CancelDrainNodeJob(resolvedClusterId, activeDrainJob.id);
      setDrainStartStatus('Drain cancellation requested.');
      await refreshMaintenance();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Unknown error';
      setDrainError(message);
      errorHandler.handle(
        error instanceof Error ? error : new Error(message || 'Cancel drain failed'),
        {
          source: 'object-maintenance',
          context: { action: 'cancel-drain', nodeName, jobId: activeDrainJob.id },
        }
      );
    } finally {
      setCancelDrainPending(false);
    }
  }, [activeDrainJob, cancelDrainPending, nodeName, refreshMaintenance, resolvedClusterId]);

  const handleDeleteNode = useCallback(async () => {
    if (!nodeName || !resolvedClusterId || deletePending) {
      return;
    }
    setDeleteError(null);
    setDeleteStatus(null);
    setDeletePending(true);
    try {
      await DeleteNode(resolvedClusterId, nodeName);
      setDeleteStatus('Delete requested. Refresh cluster nodes to verify removal.');
      onRefresh?.();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : 'Unknown error';
      setDeleteError(message);
      errorHandler.handle(error instanceof Error ? error : new Error(message || 'Delete failed'), {
        source: 'object-maintenance',
        context: { action: 'delete', nodeName },
      });
    } finally {
      setDeletePending(false);
    }
  }, [deletePending, nodeName, onRefresh, resolvedClusterId]);

  if (!nodeName) {
    return (
      <div className="node-maintenance-tab">
        <div className="node-maintenance-empty">
          Unable to determine node identity. Close and reopen the panel to retry.
        </div>
      </div>
    );
  }

  if (!resolvedClusterId) {
    return (
      <div className="node-maintenance-tab">
        <div className="node-maintenance-empty">
          Unable to determine cluster identity. Close and reopen the panel to retry.
        </div>
      </div>
    );
  }

  if (!nodeDetails) {
    return (
      <div className="node-maintenance-tab">
        <div className="node-maintenance-empty">Loading maintenance data…</div>
      </div>
    );
  }

  const isActionPending = pendingAction === actionForState;
  const nodeActionGetCapabilityReady = nodeActionGetCapability
    ? !nodeActionGetCapability.pending
    : false;
  const cordonCapabilityReady = cordonCapability ? !cordonCapability.pending : false;
  const canReadNodeForAction = Boolean(nodeActionGetCapability?.allowed);
  const canMutate = Boolean(cordonCapability?.allowed && canReadNodeForAction);
  const cordonDisabled =
    !nodeActionGetCapabilityReady || !cordonCapabilityReady || !canMutate || isActionPending;

  const drainCapabilityReady = drainCapability ? !drainCapability.pending : false;
  const drainPodCapabilityReady = drainPodCapability ? !drainPodCapability.pending : false;
  const canDrain = Boolean(
    nodeActionGetCapability?.allowed && drainCapability?.allowed && drainPodCapability?.allowed
  );
  const drainActionDisabled =
    !nodeActionGetCapabilityReady ||
    !drainCapabilityReady ||
    !canDrain ||
    drainPending ||
    Boolean(activeDrainJob);
  const drainDisabled = drainActionDisabled || !drainPodCapabilityReady;
  const deleteCapabilityReady = deleteCapability ? !deleteCapability.pending : false;
  const canDeleteNode = Boolean(deleteCapability?.allowed);
  const deleteActionDisabled = !deleteCapabilityReady || !canDeleteNode || deletePending;

  const baseReadinessClass =
    nodeDetails.status === 'Ready'
      ? 'success'
      : nodeDetails.status?.toLowerCase().includes('ready')
        ? 'warning'
        : 'error';
  const statusClass = unschedulable ? 'warning' : baseReadinessClass;
  const statusText = unschedulable
    ? `${nodeDetails.status || 'Unknown'}, Cordoned`
    : nodeDetails.status || 'Unknown';

  return (
    <div className="node-maintenance-tab">
      <div className="node-maintenance-status-header">
        <div className="node-maintenance-stat">
          <span className="node-maintenance-stat-label">Status</span>
          <span
            className={`node-maintenance-stat-value ${statusClass}`}
            title={unschedulable ? 'Node is cordoned and unschedulable.' : undefined}
          >
            <span className={`node-maintenance-status-dot ${statusClass}`} aria-hidden />
            {statusText}
          </span>
        </div>
        <div className="node-maintenance-stat">
          <span className="node-maintenance-stat-label">Pods</span>
          <span className="node-maintenance-stat-value">
            {nodeDetails.podsCount}
            {nodeDetails.podsAllocatable ? (
              <span className="node-maintenance-stat-aux"> / {nodeDetails.podsAllocatable}</span>
            ) : null}
          </span>
        </div>
        <div className="node-maintenance-stat">
          <span className="node-maintenance-stat-label">Age</span>
          <span className="node-maintenance-stat-value">{nodeDetails.age || '—'}</span>
        </div>
      </div>

      <section className="object-panel-section node-maintenance-panel">
        <div className="node-maintenance-action-bar">
          <div className="node-maintenance-action-group">
            <button
              className={`button ${unschedulable ? 'generic' : 'warning'}`}
              onClick={() => setShowCordonConfirm(true)}
              disabled={cordonDisabled}
              title={cordonDisabledReason ?? undefined}
              type="button"
              data-maintenance-action="cordon"
            >
              {getActionLabel(actionForState, isActionPending)}
            </button>
            <Tooltip
              content="Cordoning marks the node unschedulable so Kubernetes won't place new pods on it. Existing pods keep running until they exit or are evicted. Reversible with Uncordon."
              maxWidth={320}
            />
          </div>
          <div className="node-maintenance-action-group">
            <button
              className="button danger"
              onClick={() => setShowDrainConfirm(true)}
              disabled={drainDisabled}
              title={drainDisabledReason ?? undefined}
              type="button"
              data-maintenance-action="drain"
            >
              {activeDrainJob ? 'Drain Running' : drainPending ? 'Starting…' : 'Drain'}
            </button>
            <Tooltip
              content="Draining cordons the node and then evicts its pods so the scheduler places them on other nodes. DaemonSet pods stay — they're per-node by design. The eviction API respects PodDisruptionBudgets; if pods can't be evicted within the timeout the drain fails and the node remains cordoned."
              maxWidth={360}
            />
          </div>
          <div className="node-maintenance-action-group">
            <button
              className="button danger"
              onClick={() => setShowDeleteConfirm(true)}
              disabled={deleteActionDisabled}
              title={deleteDisabledReason ?? undefined}
              type="button"
              data-maintenance-action="delete"
            >
              {deletePending ? 'Deleting…' : 'Delete'}
            </button>
            <Tooltip
              content="Deleting removes the Node object from the cluster API. It does not terminate the underlying machine — that's your infrastructure's responsibility. Drain the node first, or pods still scheduled on it will be orphaned. This action cannot be undone."
              maxWidth={360}
            />
          </div>
        </div>
        {cordonError && (
          <div className="node-maintenance-error node-maintenance-row-feedback">{cordonError}</div>
        )}

        <details className="node-maintenance-advanced-options">
          <summary>
            Drain options
            {customizedDrainOptionCount > 0 && (
              <span className="node-maintenance-advanced-badge">
                {customizedDrainOptionCount} customized
              </span>
            )}
          </summary>
          <div className="node-maintenance-drain-options">
            <label className="node-maintenance-checkbox">
              <input
                data-test="node-maintenance-ignore-daemonsets"
                type="checkbox"
                checked={Boolean(drainOptions.ignoreDaemonSets)}
                onChange={(event) => updateDrainOption('ignoreDaemonSets', event.target.checked)}
              />
              <span>Ignore DaemonSet pods (--ignore-daemonsets)</span>
            </label>
            <label className="node-maintenance-checkbox">
              <input
                data-test="node-maintenance-delete-emptydir"
                type="checkbox"
                checked={Boolean(drainOptions.deleteEmptyDirData)}
                onChange={(event) => updateDrainOption('deleteEmptyDirData', event.target.checked)}
              />
              <span>Remove pods with emptyDir volumes (--delete-emptydir-data)</span>
            </label>
            <label className="node-maintenance-checkbox">
              <input
                data-test="node-maintenance-disable-eviction"
                type="checkbox"
                checked={Boolean(drainOptions.disableEviction)}
                onChange={(event) => updateDrainOption('disableEviction', event.target.checked)}
              />
              <span>Delete instead of Evict (--disable-eviction)</span>
            </label>
            <label className="node-maintenance-checkbox node-maintenance-grace-option">
              <input
                data-test="node-maintenance-grace-toggle"
                type="checkbox"
                checked={hasCustomGrace}
                onChange={(event) => {
                  if (!event.target.checked) {
                    updateDrainOption('gracePeriodSeconds', undefined);
                  } else {
                    updateDrainOption('gracePeriodSeconds', customGraceSeconds);
                  }
                }}
              />
              <div className="node-maintenance-grace-inline">
                <span>Override pod grace period (--grace-period)</span>
                <input
                  type="number"
                  min={1}
                  max={900}
                  value={customGraceSeconds}
                  disabled={!hasCustomGrace}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    const normalized = normalizeGraceSeconds(next);
                    setCustomGraceSeconds(normalized);
                    if (hasCustomGrace) {
                      updateDrainOption('gracePeriodSeconds', normalized);
                    }
                  }}
                />
                <span className="node-maintenance-grace-unit">seconds</span>
              </div>
            </label>
            <label className="node-maintenance-checkbox node-maintenance-grace-option">
              <input
                data-test="node-maintenance-timeout-toggle"
                type="checkbox"
                checked={hasCustomTimeout}
                onChange={(event) => {
                  if (!event.target.checked) {
                    updateDrainOption('timeoutSeconds', undefined);
                  } else {
                    updateDrainOption('timeoutSeconds', customTimeoutSeconds);
                  }
                }}
              />
              <div className="node-maintenance-grace-inline">
                <span>Drain timeout (--timeout)</span>
                <input
                  data-test="node-maintenance-timeout-input"
                  type="number"
                  min={1}
                  value={customTimeoutSeconds}
                  disabled={!hasCustomTimeout}
                  onChange={(event) => {
                    const next = Number(event.target.value);
                    const normalized = normalizeTimeoutSeconds(next);
                    setCustomTimeoutSeconds(normalized);
                    if (hasCustomTimeout) {
                      updateDrainOption('timeoutSeconds', normalized);
                    }
                  }}
                />
                <span className="node-maintenance-grace-unit">seconds</span>
              </div>
            </label>
            <label className="node-maintenance-checkbox">
              <input
                data-test="node-maintenance-force"
                type="checkbox"
                checked={Boolean(drainOptions.force)}
                onChange={(event) => updateDrainOption('force', event.target.checked)}
              />
              <span>Allow deleting unmanaged pods (--force)</span>
            </label>
          </div>
        </details>
        {drainError && (
          <div className="node-maintenance-error node-maintenance-row-feedback">{drainError}</div>
        )}
        {drainStartStatus && (
          <div className="node-maintenance-status node-maintenance-row-feedback">
            {drainStartStatus}
          </div>
        )}

        {deleteError && (
          <div className="node-maintenance-error node-maintenance-row-feedback">{deleteError}</div>
        )}
        {deleteStatus && (
          <div className="node-maintenance-status node-maintenance-row-feedback">
            {deleteStatus}
          </div>
        )}

        {drains.length > 0 && (
          <div className="node-maintenance-history">
            {drains.map((job) => {
              const isActive = job.id === activeDrainJob?.id;
              return (
                <DrainProgressCard
                  key={job.id}
                  job={job}
                  isActive={isActive}
                  onCancel={isActive ? () => void cancelActiveDrain() : undefined}
                  cancelDisabled={isActive ? cancelDrainPending : undefined}
                />
              );
            })}
          </div>
        )}
        {drainsLoading && drains.length === 0 && (
          <p className="node-maintenance-helper node-maintenance-row-feedback">
            Loading drain history…
          </p>
        )}
        {showPausedDrainHistoryState && (
          <ClusterDataPausedState className="node-maintenance-helper node-maintenance-row-feedback" />
        )}
      </section>

      <ConfirmationModal
        isOpen={showCordonConfirm}
        title={unschedulable ? 'Uncordon Node' : 'Cordon Node'}
        message={
          unschedulable
            ? `Uncordon node "${nodeName}"?\n\nNew workloads will be allowed to schedule.`
            : `Cordon node "${nodeName}"?\n\nThis prevents new workloads from being scheduled until it is uncordoned.`
        }
        confirmText={unschedulable ? 'Uncordon' : 'Cordon'}
        confirmButtonClass={unschedulable ? 'warning' : 'warning'}
        onConfirm={() => {
          setShowCordonConfirm(false);
          void executeAction(actionForState);
        }}
        onCancel={() => setShowCordonConfirm(false)}
      />

      <ConfirmationModal
        isOpen={showDrainConfirm}
        title="Drain Node"
        message={drainConfirmationMessage}
        confirmText="Drain Node"
        confirmButtonClass="danger"
        onConfirm={() => {
          setShowDrainConfirm(false);
          void executeDrain();
        }}
        onCancel={() => setShowDrainConfirm(false)}
      />

      <ConfirmationModal
        isOpen={showDeleteConfirm}
        title="Delete Node"
        message={`Delete node "${nodeName}"?\n\nThis removes the Node object from the cluster API.`}
        confirmText="Delete"
        confirmButtonClass="danger"
        onConfirm={() => {
          setShowDeleteConfirm(false);
          void handleDeleteNode();
        }}
        onCancel={() => setShowDeleteConfirm(false)}
      />
    </div>
  );
}

function getActionLabel(action: MaintenanceAction, inProgress: boolean): string {
  if (!inProgress) {
    return action === 'cordon' ? 'Cordon' : 'Uncordon';
  }
  return action === 'cordon' ? 'Cordoning…' : 'Uncordoning…';
}
