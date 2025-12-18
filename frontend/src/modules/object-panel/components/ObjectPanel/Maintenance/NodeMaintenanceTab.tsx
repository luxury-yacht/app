import { useCallback, useEffect, useMemo, useState } from 'react';
import { CordonNode, DrainNode, DeleteNode, UncordonNode } from '@wailsjs/go/backend/App';
import { types } from '@wailsjs/go/models';
import ConfirmationModal from '@components/modals/ConfirmationModal';
import { refreshOrchestrator, useRefreshScopedDomain } from '@/core/refresh';
import type { NodeMaintenanceSnapshotPayload } from '@/core/refresh/types';
import { useCapabilities, type CapabilityDescriptor } from '@/core/capabilities';
import { errorHandler } from '@/utils/errorHandler';
import { INACTIVE_SCOPE } from '@modules/object-panel/components/ObjectPanel/constants';
import './MaintenanceTab.css';

type MaintenanceAction = 'cordon' | 'uncordon';

interface NodeMaintenanceTabProps {
  nodeDetails: types.NodeDetails | null;
  objectName?: string | null;
  onRefresh?: () => void;
  isActive: boolean;
}

const CAPABILITY_PREFIX = 'node-maintenance';
const NODE_SCOPE_PREFIX = 'node:';

const formatTimestamp = (value?: number | null): string => {
  if (!value || Number.isNaN(value)) {
    return '—';
  }
  return new Date(value).toLocaleString();
};

const formatDuration = (startedAt?: number, completedAt?: number): string => {
  if (!startedAt) {
    return '—';
  }
  const end = completedAt ?? Date.now();
  const delta = Math.max(0, end - startedAt);
  if (delta < 1000) {
    return `${delta}ms`;
  }
  if (delta < 60_000) {
    return `${(delta / 1000).toFixed(delta < 10_000 ? 1 : 0)}s`;
  }
  const minutes = delta / 60_000;
  return `${minutes.toFixed(minutes < 10 ? 1 : 0)}m`;
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

const useNodeMaintenanceDomain = (nodeName?: string | null, enabled?: boolean) => {
  const scope = useMemo(() => toScope(nodeName), [nodeName]);
  const snapshot = useRefreshScopedDomain(
    'node-maintenance',
    scope ?? INACTIVE_SCOPE
  ) as NodeMaintenanceSnapshotPayloadState;

  useEffect(() => {
    if (!scope) {
      return;
    }
    const active = Boolean(enabled && nodeName);
    refreshOrchestrator.setScopedDomainEnabled('node-maintenance', scope, active);
    return () => {
      refreshOrchestrator.setScopedDomainEnabled('node-maintenance', scope, false);
      refreshOrchestrator.resetScopedDomain('node-maintenance', scope);
    };
  }, [scope, enabled, nodeName]);

  const refresh = useCallback(async () => {
    if (!scope) {
      return;
    }
    try {
      await refreshOrchestrator.fetchScopedDomain('node-maintenance', scope, { isManual: true });
    } catch (error) {
      errorHandler.handle(error instanceof Error ? error : new Error(String(error)), {
        source: 'node-maintenance-refresh',
      });
    }
  }, [scope]);

  useEffect(() => {
    if (scope && enabled) {
      void refresh();
    }
  }, [enabled, scope, refresh]);

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
}: NodeMaintenanceTabProps) {
  const [pendingAction, setPendingAction] = useState<MaintenanceAction | null>(null);
  const [cordonError, setCordonError] = useState<string | null>(null);
  const [drainOptions, setDrainOptions] = useState<types.DrainNodeOptions>({
    gracePeriodSeconds: 0,
    ignoreDaemonSets: true,
    deleteEmptyDirData: true,
    force: false,
    disableEviction: false,
    skipWaitForPodsToTerminate: false,
  });
  const [customGraceSeconds, setCustomGraceSeconds] = useState(30);
  const [drainPending, setDrainPending] = useState(false);
  const [drainError, setDrainError] = useState<string | null>(null);
  const [deletePending, setDeletePending] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleteStatus, setDeleteStatus] = useState<string | null>(null);
  const [showCordonConfirm, setShowCordonConfirm] = useState(false);
  const [showDrainConfirm, setShowDrainConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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
  } = useNodeMaintenanceDomain(nodeName, isActive && Boolean(nodeDetails));

  const drains = useMemo(
    () => (maintenanceScope ? (maintenanceSnapshot.data?.drains ?? []) : []),
    [maintenanceScope, maintenanceSnapshot.data]
  );
  const drainsLoading = maintenanceScope
    ? maintenanceSnapshot.status === 'loading' ||
      (maintenanceSnapshot.status === 'updating' && !maintenanceSnapshot.data)
    : false;

  const capabilityDescriptors = useMemo<CapabilityDescriptor[]>(() => {
    if (!nodeName) {
      return [];
    }
    return [
      {
        id: `${CAPABILITY_PREFIX}:cordon:${nodeName}`,
        verb: 'patch',
        resourceKind: 'Node',
        name: nodeName,
      },
      {
        id: `${CAPABILITY_PREFIX}:drain:${nodeName}`,
        verb: 'patch',
        resourceKind: 'Node',
        name: nodeName,
      },
      {
        id: `${CAPABILITY_PREFIX}:delete:${nodeName}`,
        verb: 'delete',
        resourceKind: 'Node',
        name: nodeName,
      },
    ];
  }, [nodeName]);

  const { getState: getCapabilityState } = useCapabilities(capabilityDescriptors, {
    enabled: Boolean(nodeName),
    refreshKey: nodeName,
  });

  const cordonCapability = useMemo(() => {
    if (!nodeName) {
      return null;
    }
    return getCapabilityState(`${CAPABILITY_PREFIX}:cordon:${nodeName}`);
  }, [getCapabilityState, nodeName]);

  const drainCapability = useMemo(() => {
    if (!nodeName) {
      return null;
    }
    return getCapabilityState(`${CAPABILITY_PREFIX}:drain:${nodeName}`);
  }, [getCapabilityState, nodeName]);

  const deleteCapability = useMemo(() => {
    if (!nodeName) {
      return null;
    }
    return getCapabilityState(`${CAPABILITY_PREFIX}:delete:${nodeName}`);
  }, [getCapabilityState, nodeName]);

  const cordonDisabledReason =
    cordonCapability && !cordonCapability.allowed && !cordonCapability.pending
      ? cordonCapability.reason || 'You do not have permission to modify nodes.'
      : null;

  const drainDisabledReason =
    drainCapability && !drainCapability.allowed && !drainCapability.pending
      ? drainCapability.reason || 'You do not have permission to drain nodes.'
      : null;

  const deleteDisabledReason =
    deleteCapability && !deleteCapability.allowed && !deleteCapability.pending
      ? deleteCapability.reason || 'You do not have permission to delete nodes.'
      : null;

  const unschedulable = Boolean(nodeDetails?.unschedulable);
  const actionForState: MaintenanceAction = unschedulable ? 'uncordon' : 'cordon';

  const updateDrainOption = useCallback(
    <K extends keyof types.DrainNodeOptions>(field: K, value: types.DrainNodeOptions[K]) => {
      setDrainOptions((previous) => ({ ...previous, [field]: value }));
      setDrainError(null);
    },
    []
  );

  const executeAction = useCallback(
    async (action: MaintenanceAction) => {
      if (!nodeName || pendingAction) {
        return;
      }

      setCordonError(null);
      setPendingAction(action);
      try {
        if (action === 'cordon') {
          await CordonNode(nodeName);
        } else {
          await UncordonNode(nodeName);
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
            source: 'node-maintenance',
            context: { action, nodeName },
          }
        );
      } finally {
        setPendingAction(null);
      }
    },
    [nodeName, pendingAction, onRefresh]
  );

  const hasCustomGrace = useMemo(() => {
    const raw = drainOptions.gracePeriodSeconds;
    if (raw == null) {
      return false;
    }
    return raw > 0;
  }, [drainOptions.gracePeriodSeconds]);

  const drainConfirmationMessage = useMemo(() => {
    const graceText = hasCustomGrace ? `${drainOptions.gracePeriodSeconds ?? 0}s` : 'Pod defaults';
    const lines = [
      `Grace period: ${graceText}`,
      drainOptions.ignoreDaemonSets ? 'Ignore DaemonSets' : 'Respect DaemonSets',
      drainOptions.deleteEmptyDirData ? 'Delete emptyDir data' : 'Preserve emptyDir data',
      drainOptions.force ? 'Force continue on failures' : 'Stop on first error',
    ];
    return `Drain node "${nodeName}" with the following options:\n• ${lines.join('\n• ')}`;
  }, [
    drainOptions.deleteEmptyDirData,
    drainOptions.force,
    drainOptions.gracePeriodSeconds,
    drainOptions.ignoreDaemonSets,
    hasCustomGrace,
    nodeName,
  ]);

  const executeDrain = useCallback(async () => {
    if (!nodeName || drainPending) {
      return;
    }
    setDrainError(null);
    setDrainPending(true);
    try {
      const payload: types.DrainNodeOptions = {
        ...drainOptions,
        gracePeriodSeconds: Math.max(0, Math.floor(drainOptions.gracePeriodSeconds ?? 0)),
      };
      await DrainNode(nodeName, payload);
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
        source: 'node-maintenance',
        context: { action: 'drain', nodeName },
      });
    } finally {
      setDrainPending(false);
    }
  }, [nodeName, drainPending, drainOptions, onRefresh, refreshMaintenance]);

  const handleDeleteNode = useCallback(async () => {
    if (!nodeName || deletePending) {
      return;
    }
    setDeleteError(null);
    setDeleteStatus(null);
    setDeletePending(true);
    try {
      await DeleteNode(nodeName);
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
        source: 'node-maintenance',
        context: { action: 'delete', nodeName },
      });
    } finally {
      setDeletePending(false);
    }
  }, [deletePending, nodeName, onRefresh]);

  if (!nodeName) {
    return (
      <div className="node-maintenance-tab">
        <div className="node-maintenance-empty">
          Unable to determine node identity. Close and reopen the panel to retry.
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
  const cordonCapabilityReady = cordonCapability ? !cordonCapability.pending : false;
  const canMutate = Boolean(cordonCapability?.allowed);
  const cordonDisabled = !cordonCapabilityReady || !canMutate || isActionPending;

  const drainCapabilityReady = drainCapability ? !drainCapability.pending : false;
  const canDrain = Boolean(drainCapability?.allowed);
  const drainActionDisabled = !drainCapabilityReady || !canDrain || drainPending;
  const deleteCapabilityReady = deleteCapability ? !deleteCapability.pending : false;
  const canDeleteNode = Boolean(deleteCapability?.allowed);
  const deleteActionDisabled = !deleteCapabilityReady || !canDeleteNode || deletePending;

  const statusClass = unschedulable ? 'warning' : 'success';
  const statusLabel = unschedulable ? 'Cordoned' : 'Schedulable';
  const statusDescription = unschedulable
    ? 'Node is unschedulable until it is uncordoned.'
    : 'Node currently accepts new workloads.';

  return (
    <div className="node-maintenance-tab">
      <section className="object-panel-section">
        <header className="node-maintenance-header">
          <div>
            <h3>Cordon</h3>
            <p>
              <strong className={`node-maintenance-status-label ${statusClass}`}>
                {statusLabel}
              </strong>{' '}
              — {statusDescription}
            </p>
          </div>
        </header>
        <div className="node-maintenance-actions">
          <button
            className={`button ${unschedulable ? 'primary' : 'warning'}`}
            onClick={() => setShowCordonConfirm(true)}
            disabled={cordonDisabled}
            title={cordonDisabledReason ?? undefined}
            type="button"
            data-maintenance-action="cordon"
          >
            {getActionLabel(actionForState, isActionPending)}
          </button>
        </div>
        {cordonDisabledReason && !cordonCapability?.pending && (
          <p className="node-maintenance-helper">{cordonDisabledReason}</p>
        )}
        {cordonError && <div className="node-maintenance-error">{cordonError}</div>}
      </section>

      <section className="object-panel-section">
        <header className="node-maintenance-header">
          <div>
            <h3>Drain</h3>
            <p>Evict pods and mark the node unschedulable.</p>
          </div>
        </header>
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
                  updateDrainOption('gracePeriodSeconds', 0);
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
                  const normalized = Number.isNaN(next) ? 30 : Math.max(1, next);
                  setCustomGraceSeconds(normalized);
                  if (hasCustomGrace) {
                    updateDrainOption('gracePeriodSeconds', normalized);
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
            <span>Force continue on failures (--force)</span>
          </label>
        </div>
        <div className="node-maintenance-actions">
          <button
            className="button danger"
            onClick={() => setShowDrainConfirm(true)}
            disabled={drainActionDisabled}
            title={drainDisabledReason ?? undefined}
            type="button"
            data-maintenance-action="drain"
          >
            {drainPending ? 'Draining…' : 'Drain Node'}
          </button>
        </div>
        {drainDisabledReason && !drainCapability?.pending && (
          <p className="node-maintenance-helper">{drainDisabledReason}</p>
        )}
        {drainError && <div className="node-maintenance-error">{drainError}</div>}
        <div className="node-maintenance-history">
          {drainsLoading && <div className="node-maintenance-helper">Loading drain history…</div>}
          {!drainsLoading && drains.length === 0 && (
            <div className="node-maintenance-helper">No drain activity recorded yet.</div>
          )}
          {drains.map((job) => (
            <div key={job.id} className="node-maintenance-job">
              <div className="node-maintenance-job-header">
                <span className={`status-badge ${getStatusClass(job.status)}`}>
                  {job.status === 'running'
                    ? 'Running'
                    : job.status === 'failed'
                      ? 'Failed'
                      : 'Completed'}
                </span>
                <div className="node-maintenance-job-meta">
                  <span>Started {formatTimestamp(job.startedAt)}</span>
                  <span>Duration {formatDuration(job.startedAt, job.completedAt)}</span>
                </div>
              </div>
              {job.message && <p className="node-maintenance-helper">{job.message}</p>}
              {job.events?.length > 0 && (
                <ul className="node-maintenance-job-events">
                  {job.events.map((event) => (
                    <li
                      key={event.id}
                      className={`node-maintenance-job-event ${
                        event.kind === 'error' ? 'error' : undefined
                      }`}
                    >
                      <span className="node-maintenance-job-event-time">
                        {formatTimestamp(event.timestamp)}
                      </span>
                      <span className="node-maintenance-job-event-label">
                        {event.phase || event.kind}
                      </span>
                      <span className="node-maintenance-job-event-message">
                        {event.podNamespace && event.podName
                          ? `${event.podNamespace}/${event.podName}${
                              event.message ? ` – ${event.message}` : ''
                            }`
                          : event.message || '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="object-panel-section node-maintenance-danger">
        <header className="node-maintenance-header">
          <div>
            <h3>Delete</h3>
            <p>Deleting a node removes it from Kubernetes. This cannot be undone.</p>
          </div>
        </header>
        <div className="node-maintenance-actions">
          <button
            className="button danger"
            onClick={() => setShowDeleteConfirm(true)}
            disabled={deleteActionDisabled}
            title={deleteDisabledReason ?? undefined}
            type="button"
            data-maintenance-action="delete"
          >
            {deletePending ? 'Deleting…' : 'Delete Node'}
          </button>
        </div>
        {deleteDisabledReason && !deleteCapability?.pending && (
          <p className="node-maintenance-helper">{deleteDisabledReason}</p>
        )}
        {deleteError && <div className="node-maintenance-error">{deleteError}</div>}
        {deleteStatus && <div className="node-maintenance-status">{deleteStatus}</div>}
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
        confirmButtonClass={unschedulable ? 'primary' : 'warning'}
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

function getStatusClass(status: string): string {
  if (status === 'running') {
    return 'info';
  }
  if (status === 'failed') {
    return 'error';
  }
  return 'success';
}

function getActionLabel(action: MaintenanceAction, inProgress: boolean): string {
  if (!inProgress) {
    return action === 'cordon' ? 'Cordon Node' : 'Uncordon Node';
  }
  return action === 'cordon' ? 'Cordoning…' : 'Uncordoning…';
}
