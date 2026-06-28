import refreshDomainContractJson from '../../../../backend/refresh/domain/refresh-domain-contract.json';
import type { StaticRefresherName } from './refresherTypes';
import type { RefreshDomain } from './types';

export type DomainCategory = 'system' | 'cluster' | 'namespace';

export type StreamTelemetryName = 'resources' | 'events' | 'catalog' | 'container-logs';

export interface RefresherTiming {
  interval: number;
  cooldown: number;
  timeout: number;
}

export interface RefreshDomainDescriptor<D extends RefreshDomain = RefreshDomain> {
  domain: D;
  refresherName: StaticRefresherName;
  category: DomainCategory;
  timing: RefresherTiming;
  metricsInterval?: boolean;
  diagnosticsStream?: StreamTelemetryName;
  priority?: number;
}

export type RefreshOrchestratorKind =
  'snapshot' | 'resource-stream' | 'event-stream' | 'catalog-stream' | 'container-logs-stream';

export type RefreshBehaviorClass =
  | 'snapshot-table'
  | 'aggregate-snapshot'
  | 'resource-stream-table'
  | 'complete-resync-stream'
  | 'catalog-stream'
  | 'catalog-snapshot'
  | 'event-stream'
  | 'event-snapshot'
  | 'log-stream'
  | 'detail-payload'
  | 'helm-content-payload'
  | 'graph-payload'
  | 'operation-state';

export type RefreshScopeContractKind =
  | 'cluster'
  | 'optional-namespace'
  | 'catalog-query'
  | 'resource-stream-selector'
  | 'event-stream-scope'
  | 'object-ref'
  | 'helm-release'
  | 'object-map'
  | 'node-maintenance'
  | 'log-stream-selector';

export type RefreshCachePolicy =
  | 'snapshot-cache'
  | 'snapshot-cache-with-merge'
  | 'snapshot-cache-bypass'
  | 'snapshot-cache-plus-provider-cache'
  | 'external-catalog-cache'
  | 'external-catalog-cache-with-merge'
  | 'stream-only';

export type RefreshStreamSemantic =
  | 'change-signal'
  | 'complete-resync'
  | 'append-merge'
  | 'snapshot-replace'
  | 'line-stream'
  | 'none';

export type RefreshCoverageContract =
  | 'snapshot-table-payload'
  | 'query-refetch-on-signal'
  | 'complete-resync-only'
  | 'catalog-consistency'
  | 'catalog-snapshot-query'
  | 'event-resume-merge'
  | 'event-snapshot-payload'
  | 'log-stream-lifecycle'
  | 'detail-payload-shape'
  | 'helm-content-shape'
  | 'graph-payload-identity'
  | 'operation-state-transitions'
  | 'aggregate-snapshot-permission-fallback';

export interface ScopeContract {
  kind: RefreshScopeContractKind;
  clusterPrefix: 'required';
  parser: string;
  frontendBuilder: string;
  acceptedEncodings: string[];
}

export interface DomainInventoryEntry {
  behaviorClass: RefreshBehaviorClass;
  scopeContract: ScopeContract;
  singleCluster: true;
  payloadOwner: string;
  cachePolicy: RefreshCachePolicy;
  streamSemantics: RefreshStreamSemantic[];
  coverageContract: RefreshCoverageContract;
  coverageStatus: 'enforced';
}

export interface RefreshDomainContractEntry<D extends RefreshDomain = RefreshDomain> {
  domain: D;
  category: DomainCategory;
  sourceClocks?: RefreshSourceClock[];
  backend: {
    registration: 'direct' | 'list' | 'listWatch' | 'streamOnly';
    permission: 'runtime' | 'exempt' | 'stream-specific';
    resourceStream: boolean;
  };
  frontend: {
    refresherName: StaticRefresherName;
    orchestrator: RefreshOrchestratorKind;
    diagnosticsStream: StreamTelemetryName | null;
    timing: RefresherTiming;
    priority?: number;
  };
}

export interface StreamResourceContractRecord {
  group: string;
  version: string;
  kind: string;
  resource: string;
}

// RefreshSourceClock mirrors the backend streammux.Source taxonomy: the clocks
// that can advance a domain's rows. This is the authored source of metric
// dependency and doorbell source validation.
export type RefreshSourceClock = 'object' | 'metric' | 'event' | 'catalog';

export interface StreamDomainContractEntry {
  scopeKind: 'pod' | 'namespace' | 'cluster';
  completeIsScopeLevel: boolean;
  rowProjection?: 'scope-level-complete-only';
  primaryResources: StreamResourceContractRecord[];
  relatedResources: StreamResourceContractRecord[];
  syntheticRowKind?: StreamResourceContractRecord;
}

export interface StreamScopeExample {
  scope: string;
}

export interface StreamScopeValidExample extends StreamScopeExample {
  canonical: string;
}

export interface StreamScopeInvalidExample extends StreamScopeExample {
  errorContains: string;
}

export interface StreamScopeExamples {
  valid: StreamScopeValidExample[];
  invalid: StreamScopeInvalidExample[];
}

export interface RefreshDomainContract {
  version: 2;
  domainInventory: Record<RefreshDomain, DomainInventoryEntry>;
  resourceStream: {
    updateIdentity: {
      changeSignals: 'ref';
      deleteSignals: 'ref';
      legacyFieldsDuringMigration: string[];
      completeSemantics: 'scope-level-resync';
      completeIdentity: 'diagnostic-only';
    };
    scopeExamples: Record<'pod' | 'namespace' | 'cluster', StreamScopeExamples>;
    domains: Record<string, StreamDomainContractEntry>;
  };
  domains: RefreshDomainContractEntry[];
}

export const refreshDomainContract = refreshDomainContractJson as RefreshDomainContract;

export const REFRESH_DOMAIN_DESCRIPTORS = Object.fromEntries(
  refreshDomainContract.domains.map((entry) => {
    const descriptor: RefreshDomainDescriptor = {
      domain: entry.domain,
      refresherName: entry.frontend.refresherName,
      category: entry.category,
      timing: entry.frontend.timing,
    };
    // metricsInterval derives from the domain's source clocks: a domain runs the
    // metric refresh interval exactly when it declares the metric source clock.
    const sourceClocks = entry.sourceClocks ?? [];
    if (sourceClocks.includes('metric')) {
      descriptor.metricsInterval = true;
    }
    if (entry.frontend.diagnosticsStream) {
      descriptor.diagnosticsStream = entry.frontend.diagnosticsStream;
    }
    if (entry.frontend.priority !== undefined) {
      descriptor.priority = entry.frontend.priority;
    }
    return [entry.domain, descriptor];
  })
) as { [D in RefreshDomain]: RefreshDomainDescriptor<D> };

export const refreshDomainDescriptors = Object.values(
  REFRESH_DOMAIN_DESCRIPTORS
) as RefreshDomainDescriptor[];

export const getRefreshDomainDescriptor = <D extends RefreshDomain>(
  domain: D
): RefreshDomainDescriptor<D> => REFRESH_DOMAIN_DESCRIPTORS[domain] as RefreshDomainDescriptor<D>;

export const DOMAIN_REFRESHER_MAP = Object.fromEntries(
  refreshDomainDescriptors.map((descriptor) => [descriptor.domain, descriptor.refresherName])
) as Record<RefreshDomain, StaticRefresherName>;

export const DOMAIN_STREAM_MAP = Object.fromEntries(
  refreshDomainDescriptors
    .filter((descriptor) => descriptor.diagnosticsStream)
    .map((descriptor) => [descriptor.domain, descriptor.diagnosticsStream])
) as Partial<Record<RefreshDomain, StreamTelemetryName>>;

export const PRIORITY_DOMAINS = refreshDomainDescriptors
  .filter((descriptor) => descriptor.priority !== undefined)
  .sort((left, right) => left.priority! - right.priority!)
  .map((descriptor) => descriptor.domain);

export const REFRESHER_TIMING_BY_NAME = Object.fromEntries(
  refreshDomainDescriptors.map((descriptor) => [descriptor.refresherName, descriptor.timing])
) as Partial<Record<StaticRefresherName, RefresherTiming>>;

export const METRICS_INTERVAL_REFRESHERS = new Set<StaticRefresherName>(
  refreshDomainDescriptors
    .filter((descriptor) => descriptor.metricsInterval)
    .map((descriptor) => descriptor.refresherName)
);
