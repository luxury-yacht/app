/**
 * frontend/src/core/refresh/permissionErrors.ts
 *
 * Helpers for parsing and formatting structured permission-denied payloads.
 */

import type { PermissionDeniedStatus } from './types';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

// isPermissionDeniedStatus validates the Status-like shape used for RBAC errors.
export const isPermissionDeniedStatus = (value: unknown): value is PermissionDeniedStatus => {
  if (!isPlainObject(value)) {
    return false;
  }

  const obj = value as Record<string, unknown>;
  if (obj.kind !== undefined && typeof obj.kind !== 'string') {
    return false;
  }
  if (obj.apiVersion !== undefined && typeof obj.apiVersion !== 'string') {
    return false;
  }
  if (obj.message !== undefined && typeof obj.message !== 'string') {
    return false;
  }
  if (obj.reason !== undefined && typeof obj.reason !== 'string') {
    return false;
  }
  if (obj.code !== undefined && typeof obj.code !== 'number') {
    return false;
  }
  if (obj.details !== undefined) {
    if (!isPlainObject(obj.details)) {
      return false;
    }
    const details = obj.details as Record<string, unknown>;
    if (details.domain !== undefined && typeof details.domain !== 'string') {
      return false;
    }
    if (details.resource !== undefined && typeof details.resource !== 'string') {
      return false;
    }
    if (details.kind !== undefined && typeof details.kind !== 'string') {
      return false;
    }
    if (details.name !== undefined && typeof details.name !== 'string') {
      return false;
    }
  }

  const reason = obj.reason;
  const code = obj.code;
  return reason === 'Forbidden' || code === 403;
};

// formatPermissionDeniedStatus builds a user-facing message with available details.
export const formatPermissionDeniedStatus = (status: PermissionDeniedStatus): string => {
  const base =
    typeof status.message === 'string' && status.message.trim()
      ? status.message.trim()
      : 'Permission denied';

  const detailParts: string[] = [];
  const domain = status.details?.domain?.trim();
  const resource = status.details?.resource?.trim();
  const kind = status.details?.kind?.trim();
  const name = status.details?.name?.trim();

  if (domain && !base.toLowerCase().includes(`domain ${domain.toLowerCase()}`)) {
    detailParts.push(`domain ${domain}`);
  }
  if (resource && !base.includes(resource)) {
    detailParts.push(`resource ${resource}`);
  }
  if (!domain && !resource && kind) {
    const kindLabel = name ? `${kind}/${name}` : kind;
    if (kindLabel && !base.includes(kindLabel)) {
      detailParts.push(`resource ${kindLabel}`);
    }
  }

  if (detailParts.length === 0) {
    return base;
  }
  return `${base} (${detailParts.join(', ')})`;
};

// resolvePermissionDeniedMessage prefers structured payloads when available.
export const resolvePermissionDeniedMessage = (
  fallback: string | null | undefined,
  status: unknown
): string | null => {
  if (isPermissionDeniedStatus(status)) {
    return formatPermissionDeniedStatus(status);
  }
  return fallback ?? null;
};
