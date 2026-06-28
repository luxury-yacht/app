import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DOMAIN_REFRESHER_MAP,
  DOMAIN_STREAM_MAP,
  METRICS_INTERVAL_REFRESHERS,
  REFRESH_DOMAIN_DESCRIPTORS,
  getRefreshDomainDescriptor,
  refreshDomainContract,
  refreshDomainDescriptors,
} from './domainRegistry';
import { refreshOrchestrator } from './orchestrator';
import { RESOURCE_STREAM_DOMAINS } from './streaming/resourceStreamDomains';
import type { RefreshDomain } from './types';

const refreshManagerMocks = vi.hoisted(() => ({
  subscribeMock: vi.fn(() => vi.fn()),
  disableMock: vi.fn(),
  enableMock: vi.fn(),
  registerMock: vi.fn(),
  updateContextMock: vi.fn(),
  triggerManualRefreshForContextMock: vi.fn(),
}));

const streamManagerMocks = vi.hoisted(() => ({
  resourceStart: vi.fn(),
  resourceStop: vi.fn(),
  resourceRefreshOnce: vi.fn(),
}));

vi.mock('./RefreshManager', () => ({
  refreshManager: {
    subscribe: refreshManagerMocks.subscribeMock,
    disable: refreshManagerMocks.disableMock,
    enable: refreshManagerMocks.enableMock,
    register: refreshManagerMocks.registerMock,
    updateContext: refreshManagerMocks.updateContextMock,
    triggerManualRefreshForContext: refreshManagerMocks.triggerManualRefreshForContextMock,
  },
}));

vi.mock('./client', () => ({
  ensureRefreshBaseURL: vi.fn().mockResolvedValue('http://localhost'),
  fetchSnapshot: vi.fn(),
  invalidateRefreshBaseURL: vi.fn(),
  setMetricsActive: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./streaming/containerLogsStreamManager', () => ({
  containerLogsStreamManager: {
    startStream: vi.fn(),
    stop: vi.fn(),
    refreshOnce: vi.fn(),
  },
}));

vi.mock('./streaming/resourceStreamManager', () => ({
  resourceStreamManager: {
    start: streamManagerMocks.resourceStart,
    stop: streamManagerMocks.resourceStop,
    refreshOnce: streamManagerMocks.resourceRefreshOnce,
    isHealthy: vi.fn(() => true),
  },
}));

type DomainCategory = 'system' | 'cluster' | 'namespace';
type DiagnosticsStream = 'resources' | 'events' | 'catalog' | 'container-logs';
type OrchestratorKind =
  'snapshot' | 'resource-stream' | 'event-stream' | 'catalog-stream' | 'container-logs-stream';

type ContractDomain = {
  domain: RefreshDomain;
  category: DomainCategory;
  sourceClocks?: Array<'object' | 'metric' | 'event' | 'catalog'>;
  backend: {
    resourceStream: boolean;
  };
  frontend: {
    refresherName: string;
    orchestrator: OrchestratorKind;
    diagnosticsStream: DiagnosticsStream | null;
    timing: {
      interval: number;
      cooldown: number;
      timeout: number;
    };
    priority?: number;
  };
};

type RegisteredDomain = {
  category: DomainCategory;
  refresherName: string;
  streaming?: {
    start?: (scope: string) => Promise<(() => void) | void> | (() => void);
    metricsOnly?: boolean;
  };
};

const registeredDomains = (): Map<RefreshDomain, RegisteredDomain> =>
  (refreshOrchestrator as unknown as { configs: Map<RefreshDomain, RegisteredDomain> }).configs;

const EVENT_STREAM_DOMAINS = new Set<RefreshDomain>(['cluster-events', 'namespace-events']);
const BEHAVIOR_CLASSES = new Set([
  'snapshot-table',
  'aggregate-snapshot',
  'resource-stream-table',
  'complete-resync-stream',
  'catalog-stream',
  'catalog-snapshot',
  'event-stream',
  'event-snapshot',
  'log-stream',
  'detail-payload',
  'helm-content-payload',
  'graph-payload',
  'operation-state',
]);
const SCOPE_KINDS = new Set([
  'cluster',
  'optional-namespace',
  'catalog-query',
  'resource-stream-selector',
  'event-stream-scope',
  'object-ref',
  'helm-release',
  'object-map',
  'node-maintenance',
  'log-stream-selector',
]);
const CACHE_POLICIES = new Set([
  'snapshot-cache',
  'snapshot-cache-with-merge',
  'snapshot-cache-bypass',
  'snapshot-cache-plus-provider-cache',
  'external-catalog-cache',
  'external-catalog-cache-with-merge',
  'stream-only',
]);
const STREAM_SEMANTICS = new Set([
  'change-signal',
  'complete-resync',
  'append-merge',
  'snapshot-replace',
  'line-stream',
  'none',
]);
const COVERAGE_CONTRACTS = new Set([
  'snapshot-table-payload',
  'query-refetch-on-signal',
  'complete-resync-only',
  'catalog-consistency',
  'catalog-snapshot-query',
  'event-resume-merge',
  'event-snapshot-payload',
  'log-stream-lifecycle',
  'detail-payload-shape',
  'helm-content-shape',
  'graph-payload-identity',
  'operation-state-transitions',
  'aggregate-snapshot-permission-fallback',
]);
const COVERAGE_PROOF_FAMILIES: Array<{
  coverageContract: string;
  behaviorClasses: Set<string>;
}> = [
  { coverageContract: 'snapshot-table-payload', behaviorClasses: new Set(['snapshot-table']) },
  {
    coverageContract: 'aggregate-snapshot-permission-fallback',
    behaviorClasses: new Set(['aggregate-snapshot']),
  },
  {
    coverageContract: 'query-refetch-on-signal',
    behaviorClasses: new Set(['resource-stream-table', 'event-stream']),
  },
  {
    coverageContract: 'complete-resync-only',
    behaviorClasses: new Set(['complete-resync-stream']),
  },
  { coverageContract: 'catalog-consistency', behaviorClasses: new Set(['catalog-stream']) },
  { coverageContract: 'catalog-snapshot-query', behaviorClasses: new Set(['catalog-snapshot']) },
  { coverageContract: 'event-snapshot-payload', behaviorClasses: new Set(['event-snapshot']) },
  { coverageContract: 'log-stream-lifecycle', behaviorClasses: new Set(['log-stream']) },
  { coverageContract: 'detail-payload-shape', behaviorClasses: new Set(['detail-payload']) },
  {
    coverageContract: 'helm-content-shape',
    behaviorClasses: new Set(['helm-content-payload']),
  },
  { coverageContract: 'graph-payload-identity', behaviorClasses: new Set(['graph-payload']) },
  {
    coverageContract: 'operation-state-transitions',
    behaviorClasses: new Set(['operation-state']),
  },
];

const enforcedCoverageProofs = (): Record<string, Set<RefreshDomain>> => {
  const proofs: Record<string, Set<RefreshDomain>> = {};
  COVERAGE_PROOF_FAMILIES.forEach((family) => {
    proofs[family.coverageContract] = new Set<RefreshDomain>();
  });

  for (const [domain, inventory] of Object.entries(refreshDomainContract.domainInventory)) {
    if (inventory.coverageStatus !== 'enforced') {
      continue;
    }
    const family = COVERAGE_PROOF_FAMILIES.find((candidate) =>
      candidate.behaviorClasses.has(inventory.behaviorClass)
    );
    expect(family, `${domain} behavior-class coverage proof`).toBeDefined();
    expect(inventory.coverageContract, `${domain} coverage contract`).toBe(
      family?.coverageContract
    );
    proofs[family!.coverageContract].add(domain as RefreshDomain);
  }

  return proofs;
};

describe('refresh domain contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('keeps the authored contract within supported frontend values', () => {
    const categories = new Set<DomainCategory>(['system', 'cluster', 'namespace']);
    const orchestrators = new Set<OrchestratorKind>([
      'snapshot',
      'resource-stream',
      'event-stream',
      'catalog-stream',
      'container-logs-stream',
    ]);
    const diagnosticsStreams = new Set<DiagnosticsStream>([
      'resources',
      'events',
      'catalog',
      'container-logs',
    ]);

    expect(refreshDomainContract.version).toBe(2);
    expect(refreshDomainContract.resourceStream.updateIdentity).toEqual({
      changeSignals: 'ref',
      deleteSignals: 'ref',
      legacyFieldsDuringMigration: [],
      completeSemantics: 'scope-level-resync',
      completeIdentity: 'diagnostic-only',
    });
    expect(refreshDomainContract.domains.length).toBeGreaterThan(0);

    for (const entry of refreshDomainContract.domains as ContractDomain[]) {
      expect(categories.has(entry.category)).toBe(true);
      expect(orchestrators.has(entry.frontend.orchestrator)).toBe(true);
      if (entry.frontend.diagnosticsStream !== null) {
        expect(diagnosticsStreams.has(entry.frontend.diagnosticsStream)).toBe(true);
      }
      expect(entry.frontend.refresherName).toEqual(expect.any(String));
      expect(entry.frontend.timing.interval).toBeGreaterThan(0);
      expect(entry.frontend.timing.cooldown).toBeGreaterThan(0);
      expect(entry.frontend.timing.timeout).toBeGreaterThan(0);
    }
  });

  it('covers frontend descriptors, orchestrator registrations, streams, and diagnostics', () => {
    const contract = refreshDomainContract;
    expect(contract.version).toBe(2);

    const contractDomains = contract.domains.map((entry) => entry.domain);
    expect(new Set(contractDomains).size).toBe(contractDomains.length);
    expect(new Set(refreshDomainDescriptors.map((descriptor) => descriptor.domain))).toEqual(
      new Set(contractDomains)
    );
    expect(new Set(Object.keys(REFRESH_DOMAIN_DESCRIPTORS))).toEqual(new Set(contractDomains));
    expect(new Set(registeredDomains().keys())).toEqual(new Set(contractDomains));

    const resourceStreamDomains = new Set<RefreshDomain>(RESOURCE_STREAM_DOMAINS);

    for (const entry of contract.domains) {
      const descriptor = getRefreshDomainDescriptor(entry.domain);
      const registration = registeredDomains().get(entry.domain);
      // metricsInterval is derived from the domain's source clocks, not authored.
      const metricsInterval = entry.sourceClocks?.includes('metric') ?? false;
      expect(registration).toBeDefined();
      expect(descriptor.category).toBe(entry.category);
      expect(registration?.category).toBe(entry.category);
      expect(descriptor.refresherName).toBe(entry.frontend.refresherName);
      expect(registration?.refresherName).toBe(entry.frontend.refresherName);
      expect(DOMAIN_REFRESHER_MAP[entry.domain]).toBe(entry.frontend.refresherName);
      expect(DOMAIN_STREAM_MAP[entry.domain]).toBe(entry.frontend.diagnosticsStream ?? undefined);
      expect(descriptor.diagnosticsStream).toBe(entry.frontend.diagnosticsStream ?? undefined);
      expect(descriptor.timing).toEqual(entry.frontend.timing);
      expect(descriptor.priority).toBe(entry.frontend.priority);
      expect(METRICS_INTERVAL_REFRESHERS.has(descriptor.refresherName)).toBe(metricsInterval);

      switch (entry.frontend.orchestrator) {
        case 'snapshot':
          expect(registration?.streaming).toBeUndefined();
          expect(resourceStreamDomains.has(entry.domain)).toBe(false);
          break;
        case 'resource-stream':
          expect(registration?.streaming).toBeDefined();
          expect(resourceStreamDomains.has(entry.domain)).toBe(true);
          expect(entry.frontend.diagnosticsStream).toBe('resources');
          expect(Boolean(registration?.streaming?.metricsOnly)).toBe(metricsInterval);
          expect(entry.sourceClocks).toContain('object');
          break;
        case 'event-stream':
          expect(registration?.streaming).toBeDefined();
          expect(resourceStreamDomains.has(entry.domain)).toBe(false);
          expect(EVENT_STREAM_DOMAINS.has(entry.domain)).toBe(true);
          expect(entry.frontend.diagnosticsStream).toBe('events');
          expect(entry.sourceClocks).toEqual(['event']);
          break;
        case 'catalog-stream':
          expect(registration?.streaming).toBeDefined();
          expect(resourceStreamDomains.has(entry.domain)).toBe(false);
          expect(entry.domain).toBe('catalog');
          expect(entry.frontend.diagnosticsStream).toBe('catalog');
          expect(entry.sourceClocks).toEqual(['catalog']);
          break;
        case 'container-logs-stream':
          expect(registration?.streaming).toBeDefined();
          expect(resourceStreamDomains.has(entry.domain)).toBe(false);
          expect(entry.domain).toBe('container-logs');
          expect(entry.frontend.diagnosticsStream).toBe('container-logs');
          break;
        default:
          expect.fail(`Unknown orchestrator kind ${entry.frontend.orchestrator}`);
      }
    }
  });

  it('routes catalog and events through the unified resource stream manager', async () => {
    await registeredDomains().get('catalog')?.streaming?.start?.('cluster-a|cluster');
    await registeredDomains().get('cluster-events')?.streaming?.start?.('cluster-a|cluster');
    await registeredDomains()
      .get('namespace-events')
      ?.streaming?.start?.('cluster-a|namespace:prod');

    expect(streamManagerMocks.resourceStart).toHaveBeenCalledWith('catalog', 'cluster-a|cluster');
    expect(streamManagerMocks.resourceStart).toHaveBeenCalledWith(
      'cluster-events',
      'cluster-a|cluster'
    );
    expect(streamManagerMocks.resourceStart).toHaveBeenCalledWith(
      'namespace-events',
      'cluster-a|namespace:prod'
    );
  });

  it('covers every domain with inventory metadata and known enum values', () => {
    const contractDomains = refreshDomainContract.domains.map((entry) => entry.domain);
    const inventoryDomains = Object.keys(refreshDomainContract.domainInventory).sort();
    expect(inventoryDomains).toEqual([...contractDomains].sort());
    const coverageProofs = enforcedCoverageProofs();

    for (const [domain, inventory] of Object.entries(refreshDomainContract.domainInventory)) {
      expect(BEHAVIOR_CLASSES.has(inventory.behaviorClass), `${domain} behaviorClass`).toBe(true);
      expect(SCOPE_KINDS.has(inventory.scopeContract.kind), `${domain} scope kind`).toBe(true);
      expect(inventory.scopeContract.clusterPrefix).toBe('required');
      expect(inventory.scopeContract.parser, `${domain} parser`).toEqual(expect.any(String));
      expect(inventory.scopeContract.parser).not.toHaveLength(0);
      expect(inventory.scopeContract.frontendBuilder, `${domain} frontendBuilder`).toEqual(
        expect.any(String)
      );
      expect(inventory.scopeContract.frontendBuilder).not.toHaveLength(0);
      expect(inventory.scopeContract.acceptedEncodings.length).toBeGreaterThan(0);
      expect(inventory.singleCluster).toBe(true);
      expect(inventory.payloadOwner, `${domain} payloadOwner`).toEqual(expect.any(String));
      expect(inventory.payloadOwner).not.toHaveLength(0);
      expect(CACHE_POLICIES.has(inventory.cachePolicy), `${domain} cachePolicy`).toBe(true);
      expect(inventory.streamSemantics.length).toBeGreaterThan(0);
      for (const semantic of inventory.streamSemantics) {
        expect(STREAM_SEMANTICS.has(semantic), `${domain} stream semantic`).toBe(true);
      }
      expect(COVERAGE_CONTRACTS.has(inventory.coverageContract), `${domain} coverage`).toBe(true);
      expect(inventory.coverageStatus).toBe('enforced');
      const proof = coverageProofs[inventory.coverageContract];
      expect(proof, `${domain} enforced proof`).toBeDefined();
      expect(proof.has(domain as RefreshDomain), `${domain} enforced proof membership`).toBe(true);
    }
  });

  it('keeps inventory behavior compatible with existing contract homes', () => {
    const resourceStreamDomains = new Set<RefreshDomain>(RESOURCE_STREAM_DOMAINS);
    const resourceStreamContractDomains = new Set<RefreshDomain>(
      Object.keys(refreshDomainContract.resourceStream.domains) as RefreshDomain[]
    );

    for (const entry of refreshDomainContract.domains) {
      const inventory = refreshDomainContract.domainInventory[entry.domain];
      expect(resourceStreamContractDomains.has(entry.domain)).toBe(entry.backend.resourceStream);

      if (entry.backend.resourceStream) {
        expect(resourceStreamDomains.has(entry.domain)).toBe(true);
        expect(['resource-stream-table', 'complete-resync-stream']).toContain(
          inventory.behaviorClass
        );
        expect(inventory.scopeContract.kind).toBe('resource-stream-selector');
        const streamContract = refreshDomainContract.resourceStream.domains[entry.domain];
        if (inventory.behaviorClass === 'complete-resync-stream') {
          expect(streamContract.rowProjection).toBe('scope-level-complete-only');
          expect(inventory.streamSemantics).not.toContain('change-signal');
          expect(inventory.coverageContract).toBe('complete-resync-only');
        } else {
          expect(streamContract.rowProjection).toBeUndefined();
          expect(inventory.streamSemantics).toContain('change-signal');
          expect(inventory.coverageContract).toBe('query-refetch-on-signal');
        }
      } else {
        expect(resourceStreamDomains.has(entry.domain)).toBe(false);
        expect(['resource-stream-table', 'complete-resync-stream']).not.toContain(
          inventory.behaviorClass
        );
      }

      switch (entry.frontend.orchestrator) {
        case 'resource-stream':
          expect(['resource-stream-table', 'complete-resync-stream']).toContain(
            inventory.behaviorClass
          );
          break;
        case 'event-stream':
          expect(inventory.behaviorClass).toBe('event-stream');
          expect(EVENT_STREAM_DOMAINS.has(entry.domain)).toBe(true);
          expect(entry.frontend.diagnosticsStream).toBe('events');
          expect(inventory.scopeContract.kind).toBe('event-stream-scope');
          expect(inventory.payloadOwner).toBe('backend/refresh/eventstream');
          expect(inventory.cachePolicy).toBe('snapshot-cache');
          expect(inventory.streamSemantics).toEqual(['snapshot-replace', 'change-signal']);
          expect(inventory.coverageContract).toBe('query-refetch-on-signal');
          break;
        case 'catalog-stream':
          expect(inventory.behaviorClass).toBe('catalog-stream');
          expect(entry.domain).toBe('catalog');
          expect(entry.frontend.diagnosticsStream).toBe('catalog');
          expect(inventory.scopeContract.kind).toBe('catalog-query');
          expect(inventory.payloadOwner).toBe('backend/objectcatalog.Service');
          expect(inventory.cachePolicy).toBe('external-catalog-cache');
          expect(inventory.streamSemantics).toEqual(
            expect.arrayContaining(['snapshot-replace', 'change-signal'])
          );
          expect(inventory.coverageContract).toBe('catalog-consistency');
          break;
        case 'container-logs-stream':
          expect(inventory.behaviorClass).toBe('log-stream');
          expect(entry.domain).toBe('container-logs');
          expect(entry.frontend.diagnosticsStream).toBe('container-logs');
          expect(inventory.scopeContract.kind).toBe('log-stream-selector');
          expect(inventory.payloadOwner).toBe('backend/refresh/containerlogsstream');
          expect(inventory.cachePolicy).toBe('stream-only');
          expect(inventory.streamSemantics).toEqual(['line-stream']);
          expect(inventory.coverageContract).toBe('log-stream-lifecycle');
          break;
        case 'snapshot':
          expect(['resource-stream-table', 'complete-resync-stream', 'log-stream']).not.toContain(
            inventory.behaviorClass
          );
          if (inventory.behaviorClass === 'catalog-snapshot') {
            expect(entry.domain).toBe('catalog-diff');
            expect(entry.frontend.orchestrator).toBe('snapshot');
            expect(entry.frontend.diagnosticsStream).toBeNull();
            expect(inventory.scopeContract.kind).toBe('catalog-query');
            expect(inventory.payloadOwner).toBe('backend/objectcatalog.Service');
            expect(inventory.cachePolicy).toBe('external-catalog-cache-with-merge');
            expect(inventory.streamSemantics).toEqual(['snapshot-replace']);
            expect(inventory.streamSemantics).not.toContain('append-merge');
            expect(inventory.coverageContract).toBe('catalog-snapshot-query');
          }
          if (inventory.behaviorClass === 'event-snapshot') {
            expect(entry.domain).toBe('object-events');
            expect(entry.frontend.orchestrator).toBe('snapshot');
            expect(entry.frontend.diagnosticsStream).toBeNull();
            expect(inventory.scopeContract.kind).toBe('object-ref');
            expect(inventory.payloadOwner).toBe('backend/refresh/snapshot.ObjectEventsBuilder');
            expect(inventory.cachePolicy).toBe('snapshot-cache');
            expect(inventory.streamSemantics).toEqual(['snapshot-replace']);
            expect(inventory.streamSemantics).not.toContain('append-merge');
            expect(inventory.coverageContract).toBe('event-snapshot-payload');
          }
          if (inventory.behaviorClass === 'detail-payload') {
            expect(['object-details', 'object-yaml']).toContain(entry.domain);
            expect(inventory.scopeContract.kind).toBe('object-ref');
            expect(inventory.cachePolicy).toBe('snapshot-cache-plus-provider-cache');
            expect(inventory.streamSemantics).toEqual(['snapshot-replace']);
            expect(inventory.coverageContract).toBe('detail-payload-shape');
          }
          if (inventory.behaviorClass === 'helm-content-payload') {
            expect(['object-helm-manifest', 'object-helm-values']).toContain(entry.domain);
            expect(inventory.scopeContract.kind).toBe('helm-release');
            expect(inventory.cachePolicy).toBe('snapshot-cache-plus-provider-cache');
            expect(inventory.streamSemantics).toEqual(['snapshot-replace']);
            expect(inventory.coverageContract).toBe('helm-content-shape');
          }
          if (inventory.behaviorClass === 'graph-payload') {
            expect(entry.domain).toBe('object-map');
            expect(inventory.scopeContract.kind).toBe('object-map');
            expect(inventory.payloadOwner).toBe('backend/refresh/snapshot.ObjectMapBuilder');
            expect(inventory.cachePolicy).toBe('snapshot-cache');
            expect(inventory.streamSemantics).toEqual(['snapshot-replace']);
            expect(inventory.coverageContract).toBe('graph-payload-identity');
          }
          if (inventory.behaviorClass === 'operation-state') {
            expect(entry.domain).toBe('object-maintenance');
            expect(inventory.scopeContract.kind).toBe('node-maintenance');
            expect(inventory.payloadOwner).toBe('backend/refresh/snapshot.NodeMaintenanceBuilder');
            expect(inventory.cachePolicy).toBe('snapshot-cache-bypass');
            expect(inventory.streamSemantics).toEqual(['snapshot-replace']);
            expect(inventory.coverageContract).toBe('operation-state-transitions');
          }
          break;
        default:
          expect.fail(`Unknown orchestrator kind ${entry.frontend.orchestrator}`);
      }
    }
  });
});
