const CLUSTER_INACTIVE_ERROR_PATTERN = /\bcluster\b.*\bnot active\b/i;

export const getPermissionResultErrorMessage = (result: {
  error?: string | null;
  reason?: string | null;
}): string => result.error || result.reason || '';

export const isTransientClusterInactivePermissionError = (message?: string | null): boolean =>
  CLUSTER_INACTIVE_ERROR_PATTERN.test(message ?? '');

export const isTransientPermissionResultError = (result: {
  source?: string | null;
  error?: string | null;
  reason?: string | null;
}): boolean => {
  if (result.source !== 'error' && !result.error) {
    return false;
  }
  return isTransientClusterInactivePermissionError(getPermissionResultErrorMessage(result));
};
