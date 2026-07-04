/**
 * frontend/src/ui/layout/namespaceScope.ts
 *
 * Logic for the sidebar's inline "accessible namespaces" scope editor
 * (docs/plans/namespace-scope.md). Validation here is syntactic only — the
 * backend re-validates, persists, and rebuilds the cluster's subsystem; after
 * a save the namespaces domain re-serves the synthesized list.
 */

import {
  getClusterAllowedNamespaces,
  setClusterAllowedNamespaces,
} from '@/core/settings/clusterAllowedNamespaces';
import { logAppLogsError, logAppLogsInfo } from '@/core/logging/appLogsClient';

/**
 * Above this many namespaces the editor shows a soft performance note:
 * a scoped cluster runs one watch per kind per namespace.
 */
export const NAMESPACE_SCOPE_SOFT_WARNING_THRESHOLD = 20;

const DNS1123_LABEL = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

export function isValidNamespaceName(name: string): boolean {
  return name.length > 0 && name.length <= 63 && DNS1123_LABEL.test(name);
}

export interface ScopeAddResult {
  next?: string[];
  error?: string;
}

export function addNamespaceToScope(scope: string[], rawName: string): ScopeAddResult {
  const name = rawName.trim();
  if (!isValidNamespaceName(name)) {
    return {
      error: 'Namespace names are lowercase letters, digits, and dashes (max 63 characters).',
    };
  }
  if (scope.includes(name)) {
    return { error: `"${name}" is already in the list.` };
  }
  return { next: [...scope, name] };
}

export function removeNamespaceFromScope(scope: string[], name: string): string[] {
  return scope.filter((entry) => entry !== name);
}

export async function loadNamespaceScope(clusterId: string): Promise<string[]> {
  if (!clusterId) {
    return [];
  }
  return getClusterAllowedNamespaces(clusterId);
}

/**
 * Persists the scope. The backend validates, rewrites settings.json, and
 * tears down + rebuilds the cluster's refresh subsystem (seconds); when the
 * rebuild finishes it emits `cluster:scope:changed`, which the orchestrator
 * and NamespaceContext handle by restarting streams and refetching — an
 * immediate refetch here would race the rebuild and cache the stale
 * pre-rebuild snapshot.
 */
export async function saveNamespaceScope(clusterId: string, next: string[]): Promise<string[]> {
  logAppLogsInfo(`namespace-scope: saving [${next.join(', ')}] for cluster "${clusterId}"`);
  try {
    const normalized = await setClusterAllowedNamespaces(clusterId, next);
    logAppLogsInfo(`namespace-scope: saved [${normalized.join(', ')}] for cluster "${clusterId}"`);
    return normalized;
  } catch (error) {
    logAppLogsError(`namespace-scope: save failed for cluster "${clusterId}": ${String(error)}`);
    throw error;
  }
}
