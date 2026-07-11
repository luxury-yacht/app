/**
 * frontend/src/shared/components/modals/DrainNodeModal.tsx
 *
 * Modal that owns the drain workflow for a single Node. Renders a drain
 * options form when the node has no active drain job and switches to a live
 * progress card once one is running. The modal is dismissible while a drain
 * runs — users reattach via the drain icon next to the node's status.
 */

import { buildObjectActionTarget, runStartDrain } from '@shared/actions/objectActionClient';
import { DrainProgressCard } from '@shared/components/drain/DrainProgressCard';
import { DrainIcon } from '@shared/components/icons/SharedIcons';
import Tooltip from '@shared/components/Tooltip';
import {
  type NodeDrainOperationPermissions,
  resolveDrainStartPermissionStatus,
} from '@shared/hooks/nodeActionPermissions';
import type { types } from '@wailsjs/go/models';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CancelDrainNodeJob } from '@/core/backend-api';
import { requestRefreshDomain, setRefreshDomainEnabled } from '@/core/data-access';
import { useRefreshScopedDomain } from '@/core/refresh';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { applyPassiveLoadingPolicy } from '@/core/refresh/loadingPolicy';
import type { NodeMaintenanceDrainJob, NodeMaintenanceSnapshotPayload } from '@/core/refresh/types';
import { errorHandler } from '@/utils/errorHandler';
import ModalHeader from './ModalHeader';
import ModalSurface from './ModalSurface';
import { useModalFocusTrap } from './useModalFocusTrap';
import './DrainNodeModal.css';

const NODE_SCOPE_PREFIX = 'node:';
const MAX_NODE_DRAIN_GRACE_SECONDS = 900;
const DEFAULT_NODE_DRAIN_TIMEOUT_SECONDS = 300;

const DRAIN_OPTION_TOOLTIPS = {
  ignoreDaemonSets:
    'DaemonSet pods are expected to run on every matching node. Leave this on for normal drains so those pods do not block the operation.',
  deleteEmptyDirData:
    'Allows draining pods that use emptyDir volumes. Data in those volumes is node-local and is lost when the pod is removed.',
  disableEviction:
    'Deletes pods directly instead of using the eviction API. This bypasses PodDisruptionBudget protection and should only be used when eviction cannot make progress.',
  skipWait:
    'Submits the pod evictions or deletions and completes the job without waiting for the pods to terminate.',
  gracePeriod:
    'Overrides each pod termination grace period. Leave disabled to use the grace period defined by each pod.',
  timeout:
    'Sets how long the drain waits for pod termination before failing. Leave disabled for no drain timeout.',
  force:
    'Allows deletion of pods that are not managed by a controller. Without this, unmanaged pods block the drain to avoid accidental workload loss.',
} as const;

type DrainOptionsState = Omit<types.DrainNodeOptions, 'gracePeriodSeconds' | 'timeoutSeconds'> & {
  gracePeriodSeconds?: number;
  timeoutSeconds?: number;
};

interface DrainNodeModalProps {
  isOpen: boolean;
  clusterId: string;
  clusterName?: string;
  nodeName: string;
  permissions?: NodeDrainOperationPermissions;
  onClose: () => void;
}

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

const toScope = (nodeName: string): string =>
  `${NODE_SCOPE_PREFIX}${nodeName.trim().toLowerCase()}`;

type NodeMaintenanceSnapshotPayloadState = ReturnType<typeof useRefreshScopedDomain> & {
  data: NodeMaintenanceSnapshotPayload | null;
};

const DrainNodeModal = ({
  isOpen,
  clusterId,
  clusterName,
  nodeName,
  permissions,
  onClose,
}: DrainNodeModalProps) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const { isPaused, isManualRefreshActive } = useAutoRefreshLoadingState();

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

  const scope = useMemo(() => {
    const trimmedNode = nodeName.trim();
    const trimmedCluster = clusterId.trim();
    if (!trimmedNode || !trimmedCluster) {
      return null;
    }
    return buildClusterScope(trimmedCluster, toScope(trimmedNode));
  }, [clusterId, nodeName]);

  const snapshot = useRefreshScopedDomain(
    'object-maintenance',
    scope ?? ''
  ) as NodeMaintenanceSnapshotPayloadState;

  useEffect(() => {
    if (!scope || !isOpen) {
      return;
    }
    setRefreshDomainEnabled({ domain: 'object-maintenance', scope, enabled: true });
    return () => {
      setRefreshDomainEnabled({ domain: 'object-maintenance', scope, enabled: false });
    };
  }, [scope, isOpen]);

  useEffect(() => {
    if (!scope || !isOpen) {
      return;
    }
    void requestRefreshDomain({
      domain: 'object-maintenance',
      scope,
      reason: 'startup',
    });
  }, [scope, isOpen]);

  const refreshMaintenance = useCallback(async () => {
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
        source: 'drain-modal-refresh',
      });
    }
  }, [scope]);

  const drains = useMemo(
    () => (scope ? (snapshot.data?.drains ?? []) : []),
    [scope, snapshot.data]
  );

  const activeDrainJob: NodeMaintenanceDrainJob | null = useMemo(
    () => drains.find((job) => job.status === 'running' || job.status === 'canceling') ?? null,
    [drains]
  );

  const mostRecentJob: NodeMaintenanceDrainJob | null = useMemo(() => drains[0] ?? null, [drains]);
  const primaryDrainJob = activeDrainJob ?? mostRecentJob;
  const earlierDrains = useMemo(
    () => (primaryDrainJob ? drains.filter((job) => job.id !== primaryDrainJob.id) : drains),
    [drains, primaryDrainJob]
  );

  const drainsLoadingState = applyPassiveLoadingPolicy({
    loading: scope
      ? snapshot.status === 'loading' || (snapshot.status === 'updating' && !snapshot.data)
      : false,
    hasLoaded: Boolean(snapshot.data),
    hasData: drains.length > 0,
    isPaused,
    isManualRefreshActive,
  });

  useModalFocusTrap({
    ref: modalRef,
    disabled: !isOpen,
    onEscape: () => {
      onClose();
      return true;
    },
  });

  const updateDrainOption = useCallback(
    <K extends keyof DrainOptionsState>(field: K, value: DrainOptionsState[K]) => {
      setDrainOptions((previous) => ({ ...previous, [field]: value }));
      setDrainError(null);
    },
    []
  );

  const hasCustomGrace =
    drainOptions.gracePeriodSeconds !== null &&
    drainOptions.gracePeriodSeconds !== undefined &&
    drainOptions.gracePeriodSeconds > 0;
  const hasCustomTimeout =
    drainOptions.timeoutSeconds !== null &&
    drainOptions.timeoutSeconds !== undefined &&
    drainOptions.timeoutSeconds > 0;
  const selectedStartPermission = permissions
    ? resolveDrainStartPermissionStatus({
        ...permissions,
        disableEviction: Boolean(drainOptions.disableEviction),
      })
    : null;
  const startPermissionReason = useMemo(() => {
    if (!permissions) {
      return null;
    }
    if (!permissions.nodeMutation || permissions.nodeMutation.pending) {
      return 'Checking Node maintenance permissions…';
    }
    if (!permissions.nodeMutation.allowed) {
      return 'You need permission to get and patch this Node before starting a drain.';
    }
    const selectedPodPermission = drainOptions.disableEviction
      ? permissions.podDelete
      : permissions.podEvictionCreate;
    if (!selectedPodPermission || selectedPodPermission.pending) {
      return drainOptions.disableEviction
        ? 'Checking Pod delete permission…'
        : 'Checking Pod eviction permission…';
    }
    if (!selectedPodPermission.allowed) {
      return drainOptions.disableEviction
        ? 'You need permission to delete Pods before using Delete instead of evict.'
        : 'You need permission to create Pod evictions before starting a drain.';
    }
    return null;
  }, [drainOptions.disableEviction, permissions]);
  const cancelPermissionReason = useMemo(() => {
    if (!permissions) {
      return null;
    }
    if (!permissions.nodeMutation || permissions.nodeMutation.pending) {
      return 'Checking Node maintenance permissions…';
    }
    if (!permissions.nodeMutation.allowed) {
      return 'You need permission to get and patch this Node before canceling a drain.';
    }
    return null;
  }, [permissions]);
  const startDisabled =
    drainPending || Boolean(startPermissionReason) || selectedStartPermission?.allowed === false;

  const executeDrain = useCallback(async () => {
    if (!nodeName || !clusterId || startDisabled) {
      return;
    }
    setDrainError(null);
    setDrainPending(true);
    try {
      const payload: types.DrainNodeOptions = {
        ignoreDaemonSets: drainOptions.ignoreDaemonSets,
        deleteEmptyDirData: drainOptions.deleteEmptyDirData,
        force: drainOptions.force,
        disableEviction: drainOptions.disableEviction,
        skipWaitForPodsToTerminate: drainOptions.skipWaitForPodsToTerminate,
      };
      if (
        drainOptions.gracePeriodSeconds !== null &&
        drainOptions.gracePeriodSeconds !== undefined
      ) {
        payload.gracePeriodSeconds = normalizeGraceSeconds(drainOptions.gracePeriodSeconds);
      }
      if (
        drainOptions.timeoutSeconds !== null &&
        drainOptions.timeoutSeconds !== undefined &&
        drainOptions.timeoutSeconds > 0
      ) {
        payload.timeoutSeconds = normalizeTimeoutSeconds(drainOptions.timeoutSeconds);
      }
      await runStartDrain(
        buildObjectActionTarget({ clusterId, kind: 'Node', name: nodeName }, 'drain'),
        payload
      );
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
        source: 'drain-modal',
        context: { nodeName },
      });
    } finally {
      setDrainPending(false);
    }
  }, [clusterId, drainOptions, nodeName, refreshMaintenance, startDisabled]);

  const cancelActiveDrain = useCallback(async () => {
    if (!clusterId || !activeDrainJob || cancelDrainPending) {
      return;
    }
    setDrainError(null);
    setCancelDrainPending(true);
    try {
      await CancelDrainNodeJob(clusterId, activeDrainJob.id);
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
          source: 'drain-modal',
          context: { action: 'cancel-drain', nodeName, jobId: activeDrainJob.id },
        }
      );
    } finally {
      setCancelDrainPending(false);
    }
  }, [activeDrainJob, cancelDrainPending, clusterId, nodeName, refreshMaintenance]);

  if (!isOpen) {
    return null;
  }

  // Drain options (Advanced Options) stay reachable except while a drain is
  // running, since the node may need to be drained again at any time.
  const showOptions = !activeDrainJob;
  const lastTerminalStatus = activeDrainJob ? null : (mostRecentJob?.status ?? null);
  const isRetry = lastTerminalStatus === 'failed' || lastTerminalStatus === 'cancelled';
  // Initial state — no jobs at all — gets a 'Cancel' label on the close
  // button; once a job exists the secondary action is 'Close' instead.
  const closeLabel = mostRecentJob ? 'Close' : 'Cancel';
  const startLabel = drainPending ? 'Starting…' : isRetry ? 'Retry' : 'Drain';

  return (
    <ModalSurface
      modalRef={modalRef}
      labelledBy="drain-node-modal-title"
      onClose={onClose}
      containerClassName="drain-node-modal"
      closeOnBackdrop={false}
    >
      <ModalHeader
        title="Drain Node"
        titleId="drain-node-modal-title"
        icon={DrainIcon}
        onClose={onClose}
      />
      <div className="drain-node-modal-body">
        <div className="drain-node-modal-target">
          <span className="drain-node-modal-label">Node:</span>
          <span className="drain-node-modal-value">{nodeName}</span>
          {!!clusterName && (
            <>
              <span className="drain-node-modal-label">Cluster:</span>
              <span className="drain-node-modal-value">{clusterName}</span>
            </>
          )}
        </div>

        {!!primaryDrainJob && (
          <div className="drain-node-modal-current">
            <DrainProgressCard
              job={primaryDrainJob}
              isActive={Boolean(activeDrainJob && activeDrainJob.id === primaryDrainJob.id)}
              onCancel={
                activeDrainJob && activeDrainJob.id === primaryDrainJob.id
                  ? () => void cancelActiveDrain()
                  : undefined
              }
              cancelDisabled={
                activeDrainJob && activeDrainJob.id === primaryDrainJob.id
                  ? cancelDrainPending || Boolean(cancelPermissionReason)
                  : undefined
              }
              cancelDisabledReason={
                activeDrainJob && activeDrainJob.id === primaryDrainJob.id
                  ? cancelPermissionReason
                  : undefined
              }
            />
          </div>
        )}

        {showOptions && (
          <details className="drain-node-modal-advanced">
            <summary>Advanced Options</summary>
            <fieldset className="drain-node-modal-options" disabled={drainPending}>
              <label className="drain-node-modal-checkbox">
                <input
                  data-test="drain-modal-ignore-daemonsets"
                  type="checkbox"
                  checked={Boolean(drainOptions.ignoreDaemonSets)}
                  onChange={(event) => updateDrainOption('ignoreDaemonSets', event.target.checked)}
                />
                <span>Ignore DaemonSet pods</span>
                <Tooltip content={DRAIN_OPTION_TOOLTIPS.ignoreDaemonSets} maxWidth={320} />
              </label>
              <label className="drain-node-modal-checkbox">
                <input
                  data-test="drain-modal-delete-emptydir"
                  type="checkbox"
                  checked={Boolean(drainOptions.deleteEmptyDirData)}
                  onChange={(event) =>
                    updateDrainOption('deleteEmptyDirData', event.target.checked)
                  }
                />
                <span>Remove pods with emptyDir volumes</span>
                <Tooltip content={DRAIN_OPTION_TOOLTIPS.deleteEmptyDirData} maxWidth={320} />
              </label>
              <label className="drain-node-modal-checkbox">
                <input
                  data-test="drain-modal-disable-eviction"
                  type="checkbox"
                  checked={Boolean(drainOptions.disableEviction)}
                  onChange={(event) => updateDrainOption('disableEviction', event.target.checked)}
                />
                <span>Delete instead of evict</span>
                <Tooltip content={DRAIN_OPTION_TOOLTIPS.disableEviction} maxWidth={320} />
              </label>
              <label className="drain-node-modal-checkbox">
                <input
                  data-test="drain-modal-skip-wait"
                  type="checkbox"
                  checked={Boolean(drainOptions.skipWaitForPodsToTerminate)}
                  onChange={(event) =>
                    updateDrainOption('skipWaitForPodsToTerminate', event.target.checked)
                  }
                />
                <span>Skip wait for pod termination</span>
                <Tooltip content={DRAIN_OPTION_TOOLTIPS.skipWait} maxWidth={320} />
              </label>
              <label className="drain-node-modal-checkbox">
                <input
                  data-test="drain-modal-force"
                  type="checkbox"
                  checked={Boolean(drainOptions.force)}
                  onChange={(event) => updateDrainOption('force', event.target.checked)}
                />
                <span>Allow deleting unmanaged pods</span>
                <Tooltip content={DRAIN_OPTION_TOOLTIPS.force} maxWidth={320} />
              </label>
              <label className="drain-node-modal-checkbox drain-node-modal-grace">
                <input
                  data-test="drain-modal-grace-toggle"
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
                <span className="drain-node-modal-grace-label">Override grace period</span>
                <input
                  type="number"
                  min={1}
                  max={MAX_NODE_DRAIN_GRACE_SECONDS}
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
                <span className="drain-node-modal-grace-unit">seconds</span>
                <Tooltip content={DRAIN_OPTION_TOOLTIPS.gracePeriod} maxWidth={320} />
              </label>
              <label className="drain-node-modal-checkbox drain-node-modal-grace">
                <input
                  data-test="drain-modal-timeout-toggle"
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
                <span className="drain-node-modal-grace-label">Drain timeout</span>
                <input
                  data-test="drain-modal-timeout-input"
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
                <span className="drain-node-modal-grace-unit">seconds</span>
                <Tooltip content={DRAIN_OPTION_TOOLTIPS.timeout} maxWidth={320} />
              </label>
            </fieldset>
          </details>
        )}

        {drainsLoadingState.loading && !primaryDrainJob && drains.length === 0 && (
          <div className="drain-node-modal-helper">Loading drain status…</div>
        )}

        {earlierDrains.length > 0 && (
          <div className="drain-node-modal-history">
            <div className="drain-node-modal-history-label">Earlier drains</div>
            {earlierDrains.map((job) => {
              return (
                <div key={job.id} className="drain-node-modal-history-entry">
                  <DrainProgressCard job={job} isActive={false} />
                </div>
              );
            })}
          </div>
        )}

        {!!drainError && <div className="drain-node-modal-error">{drainError}</div>}
        {!activeDrainJob && startPermissionReason && (
          <div className="drain-node-modal-helper" data-test="drain-modal-permission-reason">
            {startPermissionReason}
          </div>
        )}
      </div>

      <div className="modal-footer drain-node-modal-footer">
        <button type="button" className="button cancel" onClick={onClose}>
          {activeDrainJob ? 'Close' : (closeLabel ?? '')}
        </button>
        {!activeDrainJob && (
          <button
            type="button"
            className="button danger"
            onClick={() => void executeDrain()}
            disabled={startDisabled}
            data-test={isRetry ? 'drain-modal-retry' : 'drain-modal-start'}
          >
            {startLabel}
          </button>
        )}
      </div>
    </ModalSurface>
  );
};

export default DrainNodeModal;
