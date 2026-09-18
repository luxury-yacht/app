/** Maps permission outcomes to the capability state consumed by action and tab controls. */
import type { QueryResponseResult } from './permissionRead';
import type { PermissionStatus } from './permissionTypes';
import {
  getPermissionResultErrorMessage,
  isTransientClusterInactivePermissionError,
  isTransientPermissionResultError,
} from './transientPermissionErrors';
import type { CapabilityState } from './types';

export const capabilityStateFromResult = (result: QueryResponseResult): CapabilityState => {
  if (isTransientPermissionResultError(result)) {
    return {
      allowed: false,
      pending: true,
      status: 'loading',
      reason: getPermissionResultErrorMessage(result),
    };
  }
  if (result.source === 'error' || result.error) {
    return {
      allowed: false,
      pending: false,
      status: 'error',
      reason: result.error || result.reason,
    };
  }
  return {
    allowed: result.allowed,
    pending: false,
    status: 'ready',
    reason: result.reason || undefined,
  };
};

export const capabilityStateFromError = (reason: string): CapabilityState => {
  const pending = isTransientClusterInactivePermissionError(reason);
  return { allowed: false, pending, status: pending ? 'loading' : 'error', reason };
};

export const capabilityStateFromPermission = (
  permission: PermissionStatus | undefined
): CapabilityState => {
  if (!permission) {
    return { allowed: false, pending: true, status: 'idle' };
  }
  if (permission.pending) {
    return { allowed: false, pending: true, status: 'loading' };
  }
  if (permission.error && !permission.allowed) {
    return {
      allowed: false,
      pending: false,
      status: 'error',
      reason: permission.error ?? permission.reason,
    };
  }
  return {
    allowed: permission.allowed,
    pending: false,
    status: 'ready',
    reason: permission.reason ?? undefined,
  };
};
