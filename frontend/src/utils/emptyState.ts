/**
 * frontend/src/utils/emptyState.ts
 *
 * Utility helpers for emptyState.
 * Provides shared helper functions for the frontend.
 */

import { isPermissionDenied, type RefreshFailure } from '@/core/refresh/refreshFailure';

/** An empty view names a permission denial; any other failure shows the fallback. */
export const resolveEmptyStateMessage = (
  failure?: RefreshFailure | null,
  fallback: string = 'No data available'
): string => (isPermissionDenied(failure) ? 'Insufficient permissions' : fallback);
