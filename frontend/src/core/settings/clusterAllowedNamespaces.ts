/**
 * frontend/src/core/settings/clusterAllowedNamespaces.ts
 *
 * Typed access to the per-cluster namespace scope ("accessible namespaces",
 * docs/plans/namespace-scope.md). Validation, normalization, persistence, and
 * the rebuild side effect are backend-owned; these wrappers add types, the
 * clusterId guard, and null-safety (an unset scope arrives as null).
 */

import { GetClusterAllowedNamespaces, SetClusterAllowedNamespaces } from '@/core/backend-api';

export async function getClusterAllowedNamespaces(clusterId: string): Promise<string[]> {
  if (!clusterId) {
    throw new Error('clusterId is required');
  }
  return (await GetClusterAllowedNamespaces(clusterId)) ?? [];
}

export async function setClusterAllowedNamespaces(
  clusterId: string,
  namespaces: string[]
): Promise<string[]> {
  if (!clusterId) {
    throw new Error('clusterId is required');
  }
  return (await SetClusterAllowedNamespaces(clusterId, namespaces)) ?? [];
}
