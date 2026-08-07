import type { NodeDrainOperationPermissions } from '@shared/hooks/nodeActionPermissions';
import type { types } from '@wailsjs/go/models';
import type { NodeMaintenanceDrainJob } from '@/core/refresh/types';

export const MAX_NODE_DRAIN_GRACE_SECONDS = 900;
export const DEFAULT_NODE_DRAIN_TIMEOUT_SECONDS = 300;

export type DrainOptionsState = Omit<
  types.DrainNodeOptions,
  'gracePeriodSeconds' | 'timeoutSeconds'
> & {
  gracePeriodSeconds?: number;
  timeoutSeconds?: number;
};

export interface DrainJobPresentation {
  activeDrainJob: NodeMaintenanceDrainJob | null;
  primaryDrainJob: NodeMaintenanceDrainJob | null;
  earlierDrains: NodeMaintenanceDrainJob[];
  isRetry: boolean;
  closeLabel: 'Cancel' | 'Close';
}

export const normalizeGraceSeconds = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 30;
  }
  return Math.min(MAX_NODE_DRAIN_GRACE_SECONDS, Math.max(1, Math.floor(value)));
};

export const normalizeTimeoutSeconds = (value: number): number => {
  if (!Number.isFinite(value)) {
    return DEFAULT_NODE_DRAIN_TIMEOUT_SECONDS;
  }
  return Math.max(1, Math.floor(value));
};

export const hasPositiveDrainOption = (value: number | null | undefined): boolean =>
  value !== null && value !== undefined && value > 0;

export const buildDrainOptionsPayload = (options: DrainOptionsState): types.DrainNodeOptions => {
  const payload: types.DrainNodeOptions = {
    ignoreDaemonSets: options.ignoreDaemonSets,
    deleteEmptyDirData: options.deleteEmptyDirData,
    force: options.force,
    disableEviction: options.disableEviction,
    skipWaitForPodsToTerminate: options.skipWaitForPodsToTerminate,
  };
  if (options.gracePeriodSeconds !== null && options.gracePeriodSeconds !== undefined) {
    payload.gracePeriodSeconds = normalizeGraceSeconds(options.gracePeriodSeconds);
  }
  if (hasPositiveDrainOption(options.timeoutSeconds)) {
    payload.timeoutSeconds = normalizeTimeoutSeconds(options.timeoutSeconds as number);
  }
  return payload;
};

const resolveNodeMutationPermissionReason = (
  permissions: NodeDrainOperationPermissions,
  action: 'canceling' | 'starting'
): string | null => {
  if (!permissions.nodeMutation || permissions.nodeMutation.pending) {
    return 'Checking Node maintenance permissions…';
  }
  if (!permissions.nodeMutation.allowed) {
    return `You need permission to get and patch this Node before ${action} a drain.`;
  }
  return null;
};

export const resolveDrainStartPermissionReason = (
  permissions: NodeDrainOperationPermissions | undefined,
  disableEviction: boolean
): string | null => {
  if (!permissions) {
    return null;
  }
  const nodeReason = resolveNodeMutationPermissionReason(permissions, 'starting');
  if (nodeReason) {
    return nodeReason;
  }

  const selectedPodPermission = disableEviction
    ? permissions.podDelete
    : permissions.podEvictionCreate;
  if (!selectedPodPermission || selectedPodPermission.pending) {
    return disableEviction
      ? 'Checking Pod delete permission…'
      : 'Checking Pod eviction permission…';
  }
  if (selectedPodPermission.allowed) {
    return null;
  }
  return disableEviction
    ? 'You need permission to delete Pods before using Delete instead of evict.'
    : 'You need permission to create Pod evictions before starting a drain.';
};

export const resolveDrainCancelPermissionReason = (
  permissions: NodeDrainOperationPermissions | undefined
): string | null =>
  permissions ? resolveNodeMutationPermissionReason(permissions, 'canceling') : null;

export const buildDrainJobPresentation = (
  drains: NodeMaintenanceDrainJob[]
): DrainJobPresentation => {
  const activeDrainJob =
    drains.find((job) => job.status === 'running' || job.status === 'canceling') ?? null;
  const mostRecentJob = drains[0] ?? null;
  const primaryDrainJob = activeDrainJob ?? mostRecentJob;
  const earlierDrains = primaryDrainJob
    ? drains.filter((job) => job.id !== primaryDrainJob.id)
    : drains;
  const terminalStatus = activeDrainJob ? null : (mostRecentJob?.status ?? null);
  return {
    activeDrainJob,
    primaryDrainJob,
    earlierDrains,
    isRetry: terminalStatus === 'failed' || terminalStatus === 'cancelled',
    closeLabel: mostRecentJob ? 'Close' : 'Cancel',
  };
};

export const resolveDrainStartLabel = (pending: boolean, isRetry: boolean): string => {
  if (pending) {
    return 'Starting…';
  }
  return isRetry ? 'Retry' : 'Drain';
};
