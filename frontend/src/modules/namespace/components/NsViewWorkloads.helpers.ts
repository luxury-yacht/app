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
