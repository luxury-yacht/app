/**
 * frontend/src/core/refresh/components/diagnostics/diagnosticsPanelUtils.ts
 *
 * Utility helpers for diagnosticsPanelUtils.
 * Provides shared helper functions for the shared components.
 */

import { stripClusterScope } from '@/core/refresh/clusterScope';
import { formatAge, formatFullDate } from '@/utils/ageFormatter';
import type { RefreshDomain } from '../../types';

export const formatInterval = (intervalMs: number | null): string => {
  if (!intervalMs || intervalMs <= 0) {
    return '—';
  }
  if (intervalMs % 1000 === 0) {
    return `${intervalMs / 1000}s`;
  }
  return `${(intervalMs / 1000).toFixed(1)}s`;
};

const resolvePodsNamespace = (scope: string): string => {
  if (scope.startsWith('workload:')) {
    const [, namespace] = scope.split(':');
    return namespace || '-';
  }
  if (!scope.startsWith('namespace:')) {
    return '-';
  }
  const namespace = scope.slice('namespace:'.length);
  return namespace === 'all' ? 'All' : namespace || '-';
};

const resolveMaintenanceTarget = (scope: string): string => {
  if (!scope.startsWith('node:')) {
    return scope;
  }
  return scope.slice('node:'.length) || '-';
};

export const resolveDomainNamespace = (domain: RefreshDomain, scope?: string): string => {
  if (!scope) {
    return '-';
  }
  const normalizedScope = stripClusterScope(scope);
  if (!normalizedScope) {
    return '-';
  }
  if (domain.startsWith('namespace-')) {
    const parts = normalizedScope.split(':');
    return parts[parts.length - 1] || normalizedScope;
  }
  if (domain === 'pods') {
    return resolvePodsNamespace(normalizedScope);
  }
  if (domain === 'object-maintenance') {
    return resolveMaintenanceTarget(normalizedScope);
  }
  return '-';
};

export const formatLastUpdated = (value?: number): { display: string; tooltip: string } => {
  if (!value) {
    return { display: '—', tooltip: '—' };
  }

  return {
    display: formatAge(value),
    tooltip: `${formatFullDate(value)} (${formatAge(value)} ago)`,
  };
};

export const formatDurationMs = (durationMs?: number | null): string => {
  if (
    durationMs === null ||
    durationMs === undefined ||
    Number.isNaN(durationMs) ||
    durationMs <= 0
  ) {
    return '—';
  }
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }
  if (durationMs < 60_000) {
    return `${(durationMs / 1000).toFixed(durationMs < 10_000 ? 1 : 0)}s`;
  }
  const minutes = durationMs / 60_000;
  return `${minutes.toFixed(minutes < 10 ? 1 : 0)}m`;
};
