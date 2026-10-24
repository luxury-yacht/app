/**
 * frontend/src/core/refresh/permissionErrors.ts
 *
 * Recognizes and formats the refresh layer's permission denials.
 */

import { errorStatusOf } from '@utils/errorStatus';
import type { ErrorStatus } from './types';

// A refresh request the backend refused for lack of RBAC permission: a settled
// answer for that scope, so automatic retries stop.
export const isSnapshotPermissionDenied = (error: unknown): boolean =>
  errorStatusOf(error)?.reason === 'Forbidden';

const permissionDeniedBaseMessage = (status: ErrorStatus): string =>
  status.message.trim() || 'Permission denied';

const permissionDeniedDetailParts = (status: ErrorStatus, base: string): string[] => {
  const parts: string[] = [];
  const domain = status.details?.domain?.trim();
  const resource = status.details?.resource?.trim();
  const kind = status.details?.kind?.trim();
  const name = status.details?.name?.trim();
  if (domain && !base.toLowerCase().includes(`domain ${domain.toLowerCase()}`)) {
    parts.push(`domain ${domain}`);
  }
  if (resource && !base.includes(resource)) {
    parts.push(`resource ${resource}`);
  }
  if (!domain && !resource && kind) {
    const kindLabel = name ? `${kind}/${name}` : kind;
    if (!base.includes(kindLabel)) {
      parts.push(`resource ${kindLabel}`);
    }
  }
  return parts;
};

// formatPermissionDeniedStatus builds a user-facing message with available details.
export const formatPermissionDeniedStatus = (status: ErrorStatus): string => {
  const base = permissionDeniedBaseMessage(status);
  const detailParts = permissionDeniedDetailParts(status, base);
  return detailParts.length === 0 ? base : `${base} (${detailParts.join(', ')})`;
};

// resolvePermissionDeniedMessage names what a denial denied; any other
// failure keeps its own message.
export const resolvePermissionDeniedMessage = (
  fallback: string | null | undefined,
  status: ErrorStatus | null | undefined
): string | null => {
  if (status?.reason === 'Forbidden') {
    return formatPermissionDeniedStatus(status);
  }
  return fallback ?? null;
};
