import { TABLE_NO_VALUE_TEXT } from '@shared/components/tables/tableNoValue';
/**
 * frontend/src/core/refresh/components/diagnostics/diagnosticsPanelUtils.ts
 *
 * Utility helpers for diagnosticsPanelUtils.
 * Provides shared helper functions for the shared components.
 */

import { type ScopeSelector, tryParseRefreshScope } from '@/core/refresh/scopeSelector';
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

const selectorNamespaceLabel = (domain: RefreshDomain, selector: ScopeSelector): string => {
  switch (selector.kind) {
    case 'all-namespaces':
      return 'All';
    case 'namespace':
      return selector.namespace;
    case 'workload':
      return selector.object.namespace;
    case 'node':
      // Maintenance operations target a node; node-scoped pods span namespaces.
      return domain === 'object-maintenance' ? selector.node : '-';
    default:
      return '-';
  }
};

/** The namespace (or maintenance node) a scope targets; '-' when it names none. */
export const resolveDomainNamespace = (domain: RefreshDomain, scope?: string): string => {
  const parsed = scope ? tryParseRefreshScope(domain, scope) : null;
  return parsed ? selectorNamespaceLabel(domain, parsed.selector) : '-';
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

export const displayInFlightCount = (count: number | null | undefined): number | string =>
  count !== null && count !== undefined && count > 0 ? count : TABLE_NO_VALUE_TEXT;
