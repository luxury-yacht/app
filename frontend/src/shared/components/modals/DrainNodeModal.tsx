/**
 * frontend/src/shared/components/modals/DrainNodeModal.tsx
 *
 * Modal that owns the drain workflow for a single Node. Renders a drain
 * options form when the node has no active drain job and switches to a live
 * progress card once one is running. The modal is dismissible while a drain
 * runs — users reattach via the drain icon next to the node's status.
 */

import { buildObjectActionTarget, runStartDrain } from '@shared/actions/objectActionClient';
import {
  type NodeDrainOperationPermissions,
  resolveDrainStartPermissionStatus,
} from '@shared/hooks/nodeActionPermissions';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CancelDrainNodeJob } from '@/core/backend-api';
import { requestRefreshDomain, setRefreshDomainEnabled } from '@/core/data-access';
import { useRefreshScopedDomain } from '@/core/refresh';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import { useAutoRefreshLoadingState } from '@/core/refresh/hooks/useAutoRefreshLoadingState';
import { applyPassiveLoadingPolicy } from '@/core/refresh/loadingPolicy';
import type { NodeMaintenanceSnapshotPayload } from '@/core/refresh/types';
import { errorHandler } from '@/utils/errorHandler';
import { DrainNodeModalView } from './DrainNodeModalView';
import {
  buildDrainJobPresentation,
  buildDrainOptionsPayload,
  DEFAULT_NODE_DRAIN_TIMEOUT_SECONDS,
  type DrainOptionsState,
  hasPositiveDrainOption,
  resolveDrainCancelPermissionReason,
  resolveDrainStartPermissionReason,
} from './drainNodeModalModel';
import { useModalFocusTrap } from './useModalFocusTrap';
import './DrainNodeModal.css';

const NODE_SCOPE_PREFIX = 'node:';

interface DrainNodeModalProps {
  isOpen: boolean;
  clusterId: string;
  clusterName?: string;
  nodeName: string;
  permissions?: NodeDrainOperationPermissions;
  onClose: () => void;
}

const toScope = (nodeName: string): string =>
  `${NODE_SCOPE_PREFIX}${nodeName.trim().toLowerCase()}`;

type NodeMaintenanceSnapshotPayloadState = ReturnType<typeof useRefreshScopedDomain> & {
  data: NodeMaintenanceSnapshotPayload | null;
};

const toDrainOperationError = (value: unknown, fallback: string): Error =>
  value instanceof Error ? value : new Error(typeof value === 'string' ? value : fallback);

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

  const drainJobs = useMemo(() => buildDrainJobPresentation(drains), [drains]);
  const { activeDrainJob, primaryDrainJob, earlierDrains, isRetry, closeLabel } = drainJobs;

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

  const hasCustomGrace = hasPositiveDrainOption(drainOptions.gracePeriodSeconds);
  const hasCustomTimeout = hasPositiveDrainOption(drainOptions.timeoutSeconds);
  const disableEviction = Boolean(drainOptions.disableEviction);
  const selectedStartPermission = permissions
    ? resolveDrainStartPermissionStatus({
        ...permissions,
        disableEviction,
      })
    : null;
  const startPermissionReason = useMemo(
    () => resolveDrainStartPermissionReason(permissions, disableEviction),
    [disableEviction, permissions]
  );
  const cancelPermissionReason = useMemo(
    () => resolveDrainCancelPermissionReason(permissions),
    [permissions]
  );
  const startDisabled =
    drainPending || Boolean(startPermissionReason) || selectedStartPermission?.allowed === false;

  const executeDrain = useCallback(async () => {
    if (!nodeName || !clusterId || startDisabled) {
      return;
    }
    setDrainError(null);
    setDrainPending(true);
    try {
      await runStartDrain(
        buildObjectActionTarget({ clusterId, kind: 'Node', name: nodeName }, 'drain'),
        buildDrainOptionsPayload(drainOptions)
      );
      await refreshMaintenance();
    } catch (error) {
      const details = errorHandler.handle(toDrainOperationError(error, 'Drain failed'), {
        source: 'drain-modal',
        context: { nodeName },
      });
      setDrainError(details.message);
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
      const details = errorHandler.handle(toDrainOperationError(error, 'Cancel drain failed'), {
        source: 'drain-modal',
        context: { action: 'cancel-drain', nodeName, jobId: activeDrainJob.id },
      });
      setDrainError(details.message);
    } finally {
      setCancelDrainPending(false);
    }
  }, [activeDrainJob, cancelDrainPending, clusterId, nodeName, refreshMaintenance]);

  if (!isOpen) {
    return null;
  }

  return (
    <DrainNodeModalView
      modalRef={modalRef}
      clusterName={clusterName}
      nodeName={nodeName}
      activeDrainJob={activeDrainJob}
      primaryDrainJob={primaryDrainJob}
      earlierDrains={earlierDrains}
      cancelDrainPending={cancelDrainPending}
      cancelPermissionReason={cancelPermissionReason}
      drainsLoading={drainsLoadingState.loading}
      drainError={drainError}
      startPermissionReason={startPermissionReason}
      startDisabled={startDisabled}
      isRetry={isRetry}
      closeLabel={closeLabel}
      drainPending={drainPending}
      options={drainOptions}
      hasCustomGrace={hasCustomGrace}
      hasCustomTimeout={hasCustomTimeout}
      customGraceSeconds={customGraceSeconds}
      customTimeoutSeconds={customTimeoutSeconds}
      setCustomGraceSeconds={setCustomGraceSeconds}
      setCustomTimeoutSeconds={setCustomTimeoutSeconds}
      updateDrainOption={updateDrainOption}
      onClose={onClose}
      onStart={() => void executeDrain()}
      onCancel={() => void cancelActiveDrain()}
    />
  );
};

export default DrainNodeModal;
