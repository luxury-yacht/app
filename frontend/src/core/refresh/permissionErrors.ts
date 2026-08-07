/**
 * frontend/src/core/refresh/permissionErrors.ts
 *
 * Helpers for parsing and formatting structured permission-denied payloads.
 */

import type { PermissionDeniedStatus } from './types';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const optionalFieldsHaveTypes = (
  value: Record<string, unknown>,
  fields: ReadonlyArray<readonly [string, 'string' | 'number']>
): boolean =>
  fields.every(([field, expectedType]) =>
    value[field] === undefined ? true : typeof value[field] === expectedType
  );

const STATUS_FIELDS = [
  ['kind', 'string'],
  ['apiVersion', 'string'],
  ['message', 'string'],
  ['reason', 'string'],
  ['code', 'number'],
] as const;

const DETAIL_FIELDS = [
  ['domain', 'string'],
  ['resource', 'string'],
  ['kind', 'string'],
  ['name', 'string'],
] as const;

const permissionDetailsAreValid = (details: unknown): boolean =>
  details === undefined ||
  (isPlainObject(details) && optionalFieldsHaveTypes(details, DETAIL_FIELDS));

// isPermissionDeniedStatus validates the Status-like shape used for RBAC errors.
export const isPermissionDeniedStatus = (value: unknown): value is PermissionDeniedStatus => {
  if (!isPlainObject(value)) {
    return false;
  }
  if (!optionalFieldsHaveTypes(value, STATUS_FIELDS) || !permissionDetailsAreValid(value.details)) {
    return false;
  }
  return value.reason === 'Forbidden' || value.code === 403;
};

const permissionDeniedBaseMessage = (status: PermissionDeniedStatus): string => {
  const message = typeof status.message === 'string' ? status.message.trim() : '';
  return message || 'Permission denied';
};

const permissionDeniedDetailParts = (status: PermissionDeniedStatus, base: string): string[] => {
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
export const formatPermissionDeniedStatus = (status: PermissionDeniedStatus): string => {
  const base = permissionDeniedBaseMessage(status);
  const detailParts = permissionDeniedDetailParts(status, base);
  return detailParts.length === 0 ? base : `${base} (${detailParts.join(', ')})`;
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
