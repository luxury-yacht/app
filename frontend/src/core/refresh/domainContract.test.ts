import { describe, expect, it, vi } from 'vitest';

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

vi.mock('./streaming/eventStreamManager', () => ({
  eventStreamManager: {
    startCluster: vi.fn(),
    stopCluster: vi.fn(),
    refreshCluster: vi.fn(),
    startNamespace: vi.fn(),
    stopNamespace: vi.fn(),
    refreshNamespace: vi.fn(),
  },
}));

vi.mock('./streaming/resourceStreamManager', () => ({
  resourceStreamManager: {
    start: vi.fn(),
    stop: vi.fn(),
    refreshOnce: vi.fn(),
    isHealthy: vi.fn(() => true),
  },
}));

vi.mock('./streaming/catalogStreamManager', () => ({
  catalogStreamManager: {
    start: vi.fn(),
    stop: vi.fn(),
    refreshOnce: vi.fn(),
    isHealthy: vi.fn(() => true),
  },
}));

type DomainCategory = 'system' | 'cluster' | 'namespace';
type DiagnosticsStream = 'resources' | 'events' | 'catalog' | 'container-logs';
type OrchestratorKind =
  | 'snapshot'
  | 'resource-stream'
  | 'event-stream'
  | 'catalog-stream'
  | 'container-logs-stream';

type ContractDomain = {
  domain: RefreshDomain;
  category: DomainCategory;
  frontend: {
    refresherName: string;
    orchestrator: OrchestratorKind;
    diagnosticsStream: DiagnosticsStream | null;
    metricsInterval: boolean;
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
  'row-update',
  'complete-resync',
  'append-merge',
  'snapshot-replace',
  'line-stream',
  'none',
]);
const COVERAGE_CONTRACTS = new Set([
  'snapshot-table-payload',
  'resource-stream-row-parity',
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
const ENFORCED_COVERAGE_PROOFS: Record<string, Set<RefreshDomain>> = {
  'snapshot-table-payload': new Set(['namespaces']),
  'aggregate-snapshot-permission-fallback': new Set(['cluster-overview']),
  'resource-stream-row-parity': new Set(
    RESOURCE_STREAM_DOMAINS.filter((domain) => domain !== 'namespace-helm')
  ),
  'complete-resync-only': new Set(['namespace-helm']),
  'catalog-consistency': new Set(['catalog']),
  'catalog-snapshot-query': new Set(['catalog-diff']),
  'event-resume-merge': new Set(['cluster-events', 'namespace-events']),
  'event-snapshot-payload': new Set(['object-events']),
  'log-stream-lifecycle': new Set(['container-logs']),
};

describe('refresh domain contract', () => {
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
      rowUpdates: 'ref',
      rowDeletes: 'ref',
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
      expect(entry.frontend.metricsInterval).toEqual(expect.any(Boolean));
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
      expect(METRICS_INTERVAL_REFRESHERS.has(descriptor.refresherName)).toBe(
        entry.frontend.metricsInterval
      );

      switch (entry.frontend.orchestrator) {
        case 'snapshot':
          expect(registration?.streaming).toBeUndefined();
          expect(resourceStreamDomains.has(entry.domain)).toBe(false);
          break;
        case 'resource-stream':
          expect(registration?.streaming).toBeDefined();
          expect(resourceStreamDomains.has(entry.domain)).toBe(true);
          expect(entry.frontend.diagnosticsStream).toBe('resources');
          expect(Boolean(registration?.streaming?.metricsOnly)).toBe(
            entry.frontend.metricsInterval
          );
          break;
        case 'event-stream':
          expect(registration?.streaming).toBeDefined();
          expect(resourceStreamDomains.has(entry.domain)).toBe(false);
          expect(EVENT_STREAM_DOMAINS.has(entry.domain)).toBe(true);
          expect(entry.frontend.diagnosticsStream).toBe('events');
          break;
        case 'catalog-stream':
          expect(registration?.streaming).toBeDefined();
          expect(resourceStreamDomains.has(entry.domain)).toBe(false);
          expect(entry.domain).toBe('catalog');
          expect(entry.frontend.diagnosticsStream).toBe('catalog');
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

  it('covers every domain with inventory metadata and known enum values', () => {
    const contractDomains = refreshDomainContract.domains.map((entry) => entry.domain);
    const inventoryDomains = Object.keys(refreshDomainContract.domainInventory).sort();
    expect(inventoryDomains).toEqual([...contractDomains].sort());

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
      expect(['enforced', 'planned']).toContain(inventory.coverageStatus);
      if (inventory.coverageStatus === 'enforced') {
        const proof = ENFORCED_COVERAGE_PROOFS[inventory.coverageContract];
        expect(proof, `${domain} enforced proof`).toBeDefined();
        expect(proof.has(domain as RefreshDomain), `${domain} enforced proof membership`).toBe(
          true
        );
      }
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
          expect(inventory.streamSemantics).not.toContain('row-update');
          expect(inventory.coverageContract).toBe('complete-resync-only');
        } else {
          expect(streamContract.rowProjection).toBeUndefined();
          expect(inventory.streamSemantics).toContain('row-update');
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
          expect(inventory.streamSemantics).toEqual(['append-merge']);
          expect(inventory.coverageContract).toBe('event-resume-merge');
          break;
        case 'catalog-stream':
          expect(inventory.behaviorClass).toBe('catalog-stream');
          expect(entry.domain).toBe('catalog');
          expect(entry.frontend.diagnosticsStream).toBe('catalog');
          expect(inventory.scopeContract.kind).toBe('catalog-query');
          expect(inventory.payloadOwner).toBe('backend/objectcatalog.Service');
          expect(inventory.cachePolicy).toBe('external-catalog-cache');
          expect(inventory.streamSemantics).toEqual(
            expect.arrayContaining(['snapshot-replace', 'append-merge'])
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
          break;
        default:
          expect.fail(`Unknown orchestrator kind ${entry.frontend.orchestrator}`);
      }
    }
  });
});
