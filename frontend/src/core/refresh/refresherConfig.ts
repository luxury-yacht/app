/**
 * frontend/src/core/refresh/refresherConfig.ts
 *
 * Module source for refresherConfig.
 * Implements refresherConfig logic for the core layer.
 */

import {
  CLUSTER_REFRESHERS,
  type ClusterRefresherName,
  NAMESPACE_REFRESHERS,
  type NamespaceRefresherName,
  SYSTEM_REFRESHERS,
  type SystemRefresherName,
  type StaticRefresherName,
} from './refresherTypes';
import { getMetricsRefreshIntervalMs } from '@/core/settings/appPreferences';

export interface RefresherTiming {
  interval: number;
  cooldown: number;
  timeout: number;
}

const STATIC_REFRESHER_CONFIG: Record<StaticRefresherName, RefresherTiming> = {
  // Streaming domains only poll for metrics; keep the interval aligned to the streaming cadence.
  [NAMESPACE_REFRESHERS.workloads]: { interval: 5000, cooldown: 500, timeout: 10 },
  [NAMESPACE_REFRESHERS.config]: { interval: 5000, cooldown: 1000, timeout: 10 },
  [NAMESPACE_REFRESHERS.network]: { interval: 5000, cooldown: 1000, timeout: 10 },
  [NAMESPACE_REFRESHERS.rbac]: { interval: 10000, cooldown: 1000, timeout: 10 },
  [NAMESPACE_REFRESHERS.storage]: { interval: 10000, cooldown: 1000, timeout: 10 },
  [NAMESPACE_REFRESHERS.events]: { interval: 3000, cooldown: 1000, timeout: 10 },
  [NAMESPACE_REFRESHERS.quotas]: { interval: 10000, cooldown: 1000, timeout: 10 },
  [NAMESPACE_REFRESHERS.autoscaling]: { interval: 5000, cooldown: 1000, timeout: 10 },
  [NAMESPACE_REFRESHERS.custom]: { interval: 10000, cooldown: 1000, timeout: 60 },
  [NAMESPACE_REFRESHERS.helm]: { interval: 10000, cooldown: 1000, timeout: 10 },

  [CLUSTER_REFRESHERS.nodes]: { interval: 5000, cooldown: 1000, timeout: 10 },
  [CLUSTER_REFRESHERS.nodeMaintenance]: { interval: 5000, cooldown: 1000, timeout: 10 },
  [CLUSTER_REFRESHERS.rbac]: { interval: 10000, cooldown: 1000, timeout: 10 },
  [CLUSTER_REFRESHERS.storage]: { interval: 10000, cooldown: 1000, timeout: 10 },
  [CLUSTER_REFRESHERS.config]: { interval: 10000, cooldown: 1000, timeout: 10 },
  [CLUSTER_REFRESHERS.crds]: { interval: 15000, cooldown: 1000, timeout: 60 },
  [CLUSTER_REFRESHERS.custom]: { interval: 15000, cooldown: 1000, timeout: 60 },
  [CLUSTER_REFRESHERS.events]: { interval: 3000, cooldown: 1000, timeout: 10 },
  [CLUSTER_REFRESHERS.browse]: { interval: 15000, cooldown: 1500, timeout: 30 },
  [CLUSTER_REFRESHERS.catalogDiff]: { interval: 15000, cooldown: 1500, timeout: 30 },

  [SYSTEM_REFRESHERS.namespaces]: { interval: 2000, cooldown: 1000, timeout: 10 },
  [SYSTEM_REFRESHERS.clusterOverview]: { interval: 10000, cooldown: 1000, timeout: 10 },
  [SYSTEM_REFRESHERS.unifiedPods]: { interval: 5000, cooldown: 1000, timeout: 30 },
  [SYSTEM_REFRESHERS.objectDetails]: { interval: 3000, cooldown: 1000, timeout: 10 },
  [SYSTEM_REFRESHERS.objectEvents]: { interval: 3000, cooldown: 1000, timeout: 10 },
  [SYSTEM_REFRESHERS.objectYaml]: { interval: 5000, cooldown: 1000, timeout: 10 },
  [SYSTEM_REFRESHERS.objectHelmManifest]: { interval: 5000, cooldown: 1000, timeout: 10 },
  [SYSTEM_REFRESHERS.objectHelmValues]: { interval: 5000, cooldown: 1000, timeout: 10 },
  [SYSTEM_REFRESHERS.objectLogs]: { interval: 2000, cooldown: 1000, timeout: 10 },
};

// Metrics-only refreshers should inherit the configurable metrics cadence.
const METRICS_INTERVAL_REFRESHERS = new Set<StaticRefresherName>([
  NAMESPACE_REFRESHERS.workloads,
  CLUSTER_REFRESHERS.nodes,
  SYSTEM_REFRESHERS.unifiedPods,
]);

const resolveTiming = (name: StaticRefresherName): RefresherTiming => {
  const timing = STATIC_REFRESHER_CONFIG[name];
  if (METRICS_INTERVAL_REFRESHERS.has(name)) {
    return { ...timing, interval: getMetricsRefreshIntervalMs() };
  }
  return timing;
};

export const namespaceRefresherConfig = (name: NamespaceRefresherName): RefresherTiming =>
  resolveTiming(name);

export const clusterRefresherConfig = (name: ClusterRefresherName): RefresherTiming =>
  resolveTiming(name);

export const systemRefresherConfig = (name: SystemRefresherName): RefresherTiming =>
  resolveTiming(name);
