/**
 * frontend/src/modules/namespace/components/NsViewWorkloads.helpers.ts
 *
 * UI component for NsViewWorkloads.helpers.
 * Handles rendering and interactions for the namespace feature.
 */

import type { NamespaceWorkloadSummary } from '@/core/refresh/types';

export interface WorkloadData extends NamespaceWorkloadSummary {
  kindAlias?: string;
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
  appendToken(tokens, workload.age);
};
