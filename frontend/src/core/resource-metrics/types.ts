import type {
  ClusterOverviewMetrics,
  NodeMetricsInfo,
  PodMetricsInfo,
  RefreshDomain,
} from '@/core/refresh/types';

export type ResourceMetricsSource =
  'pods' | 'namespace-workloads' | 'nodes' | 'cluster-overview' | 'detail-replicaset';

export type ResourceMetricsDomain = Extract<
  RefreshDomain,
  | 'pods'
  | 'pods-metrics'
  | 'namespace-workloads'
  | 'namespace-workloads-metrics'
  | 'nodes'
  | 'nodes-metrics'
  | 'cluster-overview'
>;

export interface ResourceMetricValues {
  usage?: string;
  request?: string;
  limit?: string;
  capacity?: string;
  allocatable?: string;
}

export interface ResourcePodsMetricValues {
  count?: string;
  capacity?: string;
  allocatable?: string;
}

export interface ResourceMetricsFreshness {
  collectedAt?: number;
  stale: boolean;
  lastError?: string;
  consecutiveFailures?: number;
  successCount?: number;
  failureCount?: number;
}

export type ResourceMetricsFreshnessInput =
  PodMetricsInfo | NodeMetricsInfo | ClusterOverviewMetrics | null | undefined;

export interface ResourceMetricsData {
  source: ResourceMetricsSource;
  cpu?: ResourceMetricValues;
  memory?: ResourceMetricValues;
  pods?: ResourcePodsMetricValues;
  mode?: 'nodeMetrics';
  podCount?: number;
  readyPodCount?: number;
  freshness?: ResourceMetricsFreshness;
}

export interface DomainResourceMetricsResolution {
  kind: 'domain';
  source: Extract<ResourceMetricsSource, 'pods' | 'namespace-workloads' | 'nodes'>;
  domain: Extract<
    ResourceMetricsDomain,
    'pods-metrics' | 'namespace-workloads-metrics' | 'nodes-metrics'
  >;
  scope: string;
  baseDomain: Extract<ResourceMetricsDomain, 'pods' | 'namespace-workloads' | 'nodes'>;
  baseScope: string;
}

export interface DetailExceptionResourceMetricsResolution {
  kind: 'detail-exception';
  source: 'detail-replicaset';
  reason: 'replicaset-owner-collapse';
}

export interface UnsupportedResourceMetricsResolution {
  kind: 'unsupported';
  reason: 'unsupported-kind';
}

export interface InvalidResourceMetricsResolution {
  kind: 'invalid';
  error: string;
}

export type ResourceMetricsResolution =
  | DomainResourceMetricsResolution
  | DetailExceptionResourceMetricsResolution
  | UnsupportedResourceMetricsResolution
  | InvalidResourceMetricsResolution;

export type ResourceMetricsStatus =
  'available' | 'loading' | 'missing' | 'error' | 'unsupported' | 'invalid' | 'detail-exception';

export interface ResourceMetricsResult {
  status: ResourceMetricsStatus;
  metrics: ResourceMetricsData | null;
  resolution: ResourceMetricsResolution;
  error?: string | null;
}
