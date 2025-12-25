/**
 * frontend/src/utils/emptyState.ts
 *
 * Utility helpers for emptyState.
 * Provides shared helper functions for the frontend.
 */

export const resolveEmptyStateMessage = (
  error?: string | null,
  fallback: string = 'No data available'
): string => {
  if (!error) {
    return fallback;
  }

  const normalized = error.toLowerCase();
  if (
    normalized.includes('forbidden') ||
    normalized.includes('permission') ||
    normalized.includes('access denied') ||
    normalized.includes('unauthorized') ||
    normalized.includes('not authorized') ||
    normalized.includes('rbac') ||
    normalized.includes('cannot list resource') ||
    normalized.includes('cannot get resource') ||
    normalized.includes('403')
  ) {
    return 'Insufficient permissions';
  }

  return fallback;
};
