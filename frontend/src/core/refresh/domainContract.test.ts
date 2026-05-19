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
});
