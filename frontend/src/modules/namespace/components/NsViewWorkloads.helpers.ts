/**
 * frontend/src/modules/namespace/components/NsViewWorkloads.helpers.ts
 *
 * UI component for NsViewWorkloads.helpers.
 * Handles rendering and interactions for the namespace feature.
 */

import type { NamespaceWorkloadSummary } from '@/core/refresh/types';

export interface WorkloadData
  extends Omit<
    NamespaceWorkloadSummary,
    'cpuUsage' | 'cpuRequest' | 'cpuLimit' | 'memUsage' | 'memRequest' | 'memLimit'
  > {
  kindAlias?: string;
  cpuUsage?: number | string;
  cpuRequest?: number | string;
  cpuLimit?: number | string;
  memUsage?: number | string;
  memRequest?: number | string;
  memLimit?: number | string;
}

export const normalizeWorkloadKind = (rawKind: string) => {
  const lower = rawKind?.toLowerCase?.() ?? '';
  switch (lower) {
    case 'deployment':
      return 'Deployment';
    case 'statefulset':
      return 'StatefulSet';
    case 'daemonset':
      return 'DaemonSet';
    case 'cronjob':
      return 'CronJob';
    case 'job':
      return 'Job';
    default:
      return rawKind;
  }
};

export const clampReplicas = (value: number) => Math.max(0, Math.min(9999, value));

export const extractDesiredReplicas = (ready?: string): number => {
  if (!ready) {
    return 0;
  }
  const segments = ready.split('/');
  if (segments.length === 0) {
    return 0;
  }
  const candidate = parseInt(segments[segments.length - 1]?.trim() ?? '', 10);
  if (Number.isNaN(candidate)) {
    return 0;
  }
  return clampReplicas(candidate);
};

export const buildWorkloadKey = (workload: WorkloadData) => {
  const baseKey = `${workload.ref.kind}/${workload.ref.name}`;
  const ns = workload.ref.namespace || '';
  return `${ns}::${baseKey}`;
};

export const parseWorkloadKeyValue = (
  key: string,
  namespace: string,
  _useNamespaceKeys?: boolean
) => {
  if (key.includes('::')) {
    const [nsPart = '', remainder = ''] = key.split('::', 2);
    const [kindPart = '', namePart = ''] = remainder.split('/', 2);
    return {
      namespace: nsPart,
      kind: kindPart,
      name: namePart,
    };
  }

  const [kindPart = '', namePart = ''] = key.split('/', 2);
  return {
    namespace,
    kind: kindPart,
    name: namePart,
  };
};

const appendToken = (tokens: string[], value?: string | number | null) => {
  if (value === null || value === undefined) {
    return;
  }
  const text = typeof value === 'string' ? value : String(value);
  const trimmed = text.trim();
  if (trimmed) {
    tokens.push(trimmed);
  }
};

export const appendWorkloadTokens = (tokens: string[], workload?: WorkloadData | null) => {
  if (!workload) {
    return;
  }
  appendToken(tokens, workload.ref.kind);
  appendToken(tokens, workload.kindAlias);
  appendToken(tokens, workload.ref.name);
  appendToken(tokens, workload.ref.namespace);
  appendToken(tokens, workload.status);
  appendToken(tokens, workload.ready);
  appendToken(tokens, workload.restarts);
  appendToken(tokens, workload.cpuUsage);
  appendToken(tokens, workload.cpuRequest);
  appendToken(tokens, workload.cpuLimit);
  appendToken(tokens, workload.memUsage);
  appendToken(tokens, workload.memRequest);
  appendToken(tokens, workload.memLimit);
  appendToken(tokens, workload.age);
};
