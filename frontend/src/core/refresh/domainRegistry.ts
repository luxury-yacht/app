import refreshDomainContractJson from '../../../../backend/refresh/domain/refresh-domain-contract.json';
import {
  type GeneratedRefreshCachePolicy,
  type GeneratedRefreshDiagnosticsStream,
  type GeneratedRefreshDomainCategory,
  type GeneratedRefreshOrchestratorKind,
  type GeneratedRefreshScopeQuery,
  type GeneratedRefreshScopeSelector,
  type GeneratedRefreshSourceClock,
  REFRESH_DOMAIN_POLICIES,
  type RefreshDomain,
} from './types';

export type DomainCategory = GeneratedRefreshDomainCategory;

export type StreamTelemetryName = GeneratedRefreshDiagnosticsStream;

// A domain's poll cadence: one read every `interval` ms after the last one
// settles, each read bounded by `timeout` seconds.
export interface RefreshTiming {
  interval: number;
  timeout: number;
}

export interface RefreshDomainDescriptor<D extends RefreshDomain = RefreshDomain> {
  domain: D;
  category: DomainCategory;
  timing: RefreshTiming;
  diagnosticsStream?: StreamTelemetryName;
  priority?: number;
}

export type RefreshOrchestratorKind = GeneratedRefreshOrchestratorKind;

export type RefreshBehaviorClass =
  | 'snapshot-table'
  | 'aggregate-snapshot'
  | 'resource-stream-table'
  | 'complete-resync-stream'
  | 'catalog-stream'
  | 'catalog-snapshot'
  | 'event-snapshot'
  | 'log-stream'
  | 'detail-payload'
  | 'helm-content-payload'
  | 'graph-payload'
  | 'operation-state';

export type RefreshCachePolicy = GeneratedRefreshCachePolicy;

export type RefreshStreamSemantic =
  | 'change-signal'
  | 'complete-resync'
  | 'snapshot-replace'
  | 'line-stream'
  | 'none';

export type RefreshCoverageContract =
  | 'snapshot-table-payload'
  | 'query-refetch-on-signal'
  | 'complete-resync-only'
  | 'catalog-consistency'
  | 'catalog-snapshot-query'
  | 'event-snapshot-payload'
  | 'log-stream-lifecycle'
  | 'detail-payload-shape'
  | 'helm-content-shape'
  | 'graph-payload-identity'
  | 'operation-state-transitions'
  | 'aggregate-snapshot-permission-fallback';

// One domain's scope language. `valid`/`invalid` are canonical scope tails
// (after "<clusterId>|") that the scope codec must accept or reject.
export interface ScopeContract {
  selectors: GeneratedRefreshScopeSelector[];
  query: GeneratedRefreshScopeQuery;
  valid: string[];
  invalid?: string[];
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
    orchestrator: RefreshOrchestratorKind;
    diagnosticsStream: StreamTelemetryName | null;
    timing: RefreshTiming;
    priority?: number;
    registrationOrder: number;
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
export type RefreshSourceClock = GeneratedRefreshSourceClock;

export type ResourceStreamDomain = keyof typeof refreshDomainContractJson.resourceStream.domains;

export interface StreamDomainContractEntry {
  completeIsScopeLevel: boolean;
  rowProjection?: 'scope-level-complete-only';
  primaryResources: StreamResourceContractRecord[];
  relatedResources: StreamResourceContractRecord[];
  syntheticRowKind?: StreamResourceContractRecord;
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
    domains: Record<string, StreamDomainContractEntry>;
  };
  domains: RefreshDomainContractEntry[];
}

export const refreshDomainContract = refreshDomainContractJson as RefreshDomainContract;

export const frontendRefreshDomainPolicies = [...REFRESH_DOMAIN_POLICIES].sort(
  (left, right) => left.frontend.registrationOrder - right.frontend.registrationOrder
);

export const METRIC_DEMAND_DOMAINS = REFRESH_DOMAIN_POLICIES.filter((policy) =>
  (policy.sourceClocks as readonly RefreshSourceClock[]).includes('metric')
).map((policy) => policy.domain) as RefreshDomain[];

export const REFRESH_DOMAIN_DESCRIPTORS = Object.fromEntries(
  REFRESH_DOMAIN_POLICIES.map((policy) => {
    const descriptor: RefreshDomainDescriptor = {
      domain: policy.domain,
      category: policy.category,
      timing: { ...policy.frontend.timing },
    };
    if (policy.frontend.diagnosticsStream) {
      descriptor.diagnosticsStream = policy.frontend.diagnosticsStream;
    }
    if (policy.frontend.priority !== null) {
      descriptor.priority = policy.frontend.priority;
    }
    return [policy.domain, descriptor];
  })
) as { [D in RefreshDomain]: RefreshDomainDescriptor<D> };

export const refreshDomainDescriptors = Object.values(
  REFRESH_DOMAIN_DESCRIPTORS
) as RefreshDomainDescriptor[];

export const getRefreshDomainDescriptor = <D extends RefreshDomain>(
  domain: D
): RefreshDomainDescriptor<D> => REFRESH_DOMAIN_DESCRIPTORS[domain] as RefreshDomainDescriptor<D>;

export const DOMAIN_STREAM_MAP = Object.fromEntries(
  refreshDomainDescriptors
    .filter((descriptor) => descriptor.diagnosticsStream)
    .map((descriptor) => [descriptor.domain, descriptor.diagnosticsStream])
) as Partial<Record<RefreshDomain, StreamTelemetryName>>;

export const PRIORITY_DOMAINS = refreshDomainDescriptors
  .filter(
    (descriptor): descriptor is typeof descriptor & { priority: number } =>
      descriptor.priority !== undefined
  )
  .sort((left, right) => left.priority - right.priority)
  .map((descriptor) => descriptor.domain);
