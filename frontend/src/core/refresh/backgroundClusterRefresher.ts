/**
 * frontend/src/core/refresh/backgroundClusterRefresher.ts
 *
 * Periodically refreshes each background cluster's last-viewed data.
 * Uses snapshot-only fetches (no streaming) via orchestrator.fetchDomainForCluster.
 */

import type { NavigationTabState } from '@/core/contexts/ViewStateContext';
import type { RefreshDomain } from './types';
import {
  clusterViewToRefresher,
  namespaceViewToRefresher,
  type ClusterRefresherName,
  type NamespaceRefresherName,
} from './refresherTypes';
import { refreshOrchestrator } from './orchestrator';
import { logAppInfo } from '@/core/logging/appLogClient';

// Default interval between background refresh ticks (15 seconds).
const BACKGROUND_REFRESH_INTERVAL_MS = 15_000;

// Domains already refreshed for all clusters by their scopeResolvers — skip in background loop.
const SYSTEM_DOMAINS_SKIP = new Set<string>(['cluster-overview', 'namespaces']);

type NavigationStateGetter = (clusterId: string) => NavigationTabState;
type NamespaceGetter = (clusterId: string) => string | undefined;

/**
 * Maps a cluster view tab name to the corresponding refresh domain.
 * Returns undefined if the view has no associated domain (e.g. null mapping).
 */
const clusterViewToDomain = (clusterView: string | null | undefined): RefreshDomain | undefined => {
  if (!clusterView) {
    return undefined;
  }
  const refresherName = clusterViewToRefresher[clusterView as keyof typeof clusterViewToRefresher];
  if (!refresherName) {
    return undefined;
  }
  return refresherNameToDomain(refresherName);
};

/**
 * Maps a namespace view tab name to the corresponding refresh domain.
 * Returns undefined if the view has no associated domain.
 */
const namespaceViewToDomain = (
  namespaceView: string | null | undefined
): RefreshDomain | undefined => {
  if (!namespaceView) {
    return undefined;
  }
  const refresherName =
    namespaceViewToRefresher[namespaceView as keyof typeof namespaceViewToRefresher];
  if (!refresherName) {
    return undefined;
  }
  return refresherNameToDomain(refresherName);
};

// Map refresher names back to domain names used by the orchestrator.
const REFRESHER_TO_DOMAIN: Record<string, RefreshDomain> = {
  // Cluster refreshers
  'cluster-nodes': 'nodes',
  'cluster-rbac': 'cluster-rbac',
  'cluster-storage': 'cluster-storage',
  'cluster-config': 'cluster-config',
  'cluster-crds': 'cluster-crds',
  'cluster-custom': 'cluster-custom',
  'cluster-events': 'cluster-events',
  catalog: 'catalog',
  'catalog-diff': 'catalog-diff',
  // Namespace refreshers
  workloads: 'namespace-workloads',
  config: 'namespace-config',
  network: 'namespace-network',
  rbac: 'namespace-rbac',
  storage: 'namespace-storage',
  events: 'namespace-events',
  quotas: 'namespace-quotas',
  autoscaling: 'namespace-autoscaling',
  custom: 'namespace-custom',
  helm: 'namespace-helm',
  // Object panel refreshers
  'object-maintenance': 'object-maintenance',
};

const refresherNameToDomain = (
  name: ClusterRefresherName | NamespaceRefresherName
): RefreshDomain | undefined => {
  return REFRESHER_TO_DOMAIN[name];
};

export class BackgroundClusterRefresher {
  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private backgroundClusterIds: string[] = [];
  private getNavigationState: NavigationStateGetter;
  private getNamespace: NamespaceGetter;

  constructor(getNavigationState: NavigationStateGetter, getNamespace: NamespaceGetter) {
    this.getNavigationState = getNavigationState;
    this.getNamespace = getNamespace;
  }

  /** Update the set of clusters and which one is in the foreground. */
  updateClusters(foregroundClusterId: string, allClusterIds: string[]): void {
    this.backgroundClusterIds = allClusterIds.filter((id) => id !== foregroundClusterId);
  }

  /** Start the periodic background refresh loop. */
  start(): void {
    if (this.intervalTimer !== null) {
      return;
    }
    this.intervalTimer = setInterval(() => {
      void this.tick();
    }, BACKGROUND_REFRESH_INTERVAL_MS);
    logAppInfo('[background-refresh] started', 'BackgroundClusterRefresher');
  }

  /** Stop the periodic background refresh loop. */
  stop(): void {
    if (this.intervalTimer !== null) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
      logAppInfo('[background-refresh] stopped', 'BackgroundClusterRefresher');
    }
  }

  /** True when the refresh loop is active. */
  get running(): boolean {
    return this.intervalTimer !== null;
  }

  /** Update the callback references (e.g. when React re-renders). */
  updateCallbacks(getNavigationState: NavigationStateGetter, getNamespace: NamespaceGetter): void {
    this.getNavigationState = getNavigationState;
    this.getNamespace = getNamespace;
  }

  /** Single tick: refresh each background cluster's last-viewed domain. */
  private async tick(): Promise<void> {
    for (const clusterId of this.backgroundClusterIds) {
      try {
        await this.refreshCluster(clusterId);
      } catch {
        // Silently ignore per-cluster errors to avoid blocking the loop.
      }
    }
  }

  /** Refresh the appropriate domain for a single background cluster. */
  private async refreshCluster(clusterId: string): Promise<void> {
    const navState = this.getNavigationState(clusterId);
    const { viewType, activeNamespaceView, activeClusterView } = navState;

    let domain: RefreshDomain | undefined;
    let scope: string | undefined;

    if (viewType === 'overview') {
      // cluster-overview is handled by the all-cluster scopeResolver — skip it.
      return;
    }

    if (viewType === 'cluster') {
      domain = clusterViewToDomain(activeClusterView);
    } else if (viewType === 'namespace') {
      domain = namespaceViewToDomain(activeNamespaceView);
      // Namespace domains need the selected namespace as scope.
      const ns = this.getNamespace(clusterId);
      if (ns) {
        scope = ns.startsWith('namespace:') ? ns : `namespace:${ns}`;
      }
    }

    if (!domain) {
      return;
    }

    // Skip domains already refreshed for all clusters by their scopeResolvers.
    if (SYSTEM_DOMAINS_SKIP.has(domain)) {
      return;
    }

    await refreshOrchestrator.fetchDomainForCluster(domain, clusterId, scope);
  }
}
