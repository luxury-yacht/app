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
  | 'snapshot'
  | 'resource-stream'
  | 'event-stream'
  | 'catalog-stream'
  | 'container-logs-stream';

export interface RefreshDomainContractEntry<D extends RefreshDomain = RefreshDomain> {
  domain: D;
  category: DomainCategory;
  backend: {
    registration: 'direct' | 'list' | 'listWatch' | 'streamOnly';
    permission: 'runtime' | 'exempt' | 'stream-specific';
    resourceStream: boolean;
  };
  frontend: {
    refresherName: StaticRefresherName;
    orchestrator: RefreshOrchestratorKind;
    diagnosticsStream: StreamTelemetryName | null;
    metricsInterval: boolean;
    timing: RefresherTiming;
    priority?: number;
  };
}

export interface RefreshDomainContract {
  version: 2;
  resourceStream: {
    updateIdentity: {
      rowUpdates: 'ref';
      rowDeletes: 'ref';
      legacyFieldsDuringMigration: string[];
      completeSemantics: 'scope-level-resync';
      completeIdentity: 'diagnostic-only';
    };
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
    if (entry.frontend.metricsInterval) {
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
