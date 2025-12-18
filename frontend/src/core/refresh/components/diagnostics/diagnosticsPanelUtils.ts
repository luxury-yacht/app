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

export const resolveDomainNamespace = (domain: RefreshDomain, scope?: string): string => {
  if (!scope) {
    return '-';
  }
  if (domain.startsWith('namespace-')) {
    const parts = scope.split(':');
    return parts[parts.length - 1] || scope;
  }
  if (domain === 'pods') {
    if (scope.startsWith('workload:')) {
      const [, namespace] = scope.split(':');
      return namespace || '-';
    }
    if (scope.startsWith('namespace:')) {
      const namespace = scope.slice('namespace:'.length);
      if (!namespace) {
        return '-';
      }
      return namespace === 'all' ? 'All' : namespace;
    }
    return '-';
  }
  if (domain === 'node-maintenance') {
    if (scope.startsWith('node:')) {
      const node = scope.slice('node:'.length);
      return node || '-';
    }
    return scope;
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
  if (durationMs == null || Number.isNaN(durationMs) || durationMs <= 0) {
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
