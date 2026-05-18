import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  DOMAIN_REFRESHER_MAP,
  DOMAIN_STREAM_MAP,
  METRICS_INTERVAL_REFRESHERS,
  getRefreshDomainDescriptor,
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

type ManifestDomain = {
  domain: RefreshDomain;
  category: DomainCategory;
  frontend: {
    orchestrator: OrchestratorKind;
    diagnosticsStream: DiagnosticsStream | null;
    metricsInterval: boolean;
  };
};

type Manifest = {
  version: number;
  domains: ManifestDomain[];
};

type RegisteredDomain = {
  category: DomainCategory;
  refresherName: string;
  streaming?: {
    metricsOnly?: boolean;
  };
};

const loadManifest = (): Manifest => {
  const candidates = [
    resolve(process.cwd(), '../backend/refresh/system/testdata/refresh-domain-manifest.json'),
    resolve(process.cwd(), 'backend/refresh/system/testdata/refresh-domain-manifest.json'),
  ];
  const manifestPath = candidates.find((candidate) => existsSync(candidate));
  expect(manifestPath).toBeDefined();
  const data = readFileSync(manifestPath!, 'utf8');
  return JSON.parse(data) as Manifest;
};

const registeredDomains = (): Map<RefreshDomain, RegisteredDomain> =>
  (refreshOrchestrator as unknown as { configs: Map<RefreshDomain, RegisteredDomain> }).configs;

const EVENT_STREAM_DOMAINS = new Set<RefreshDomain>(['cluster-events', 'namespace-events']);

describe('refresh domain manifest', () => {
  it('covers frontend descriptors, orchestrator registrations, streams, and diagnostics', () => {
    const manifest = loadManifest();
    expect(manifest.version).toBe(1);

    const manifestDomains = manifest.domains.map((entry) => entry.domain);
    expect(new Set(manifestDomains).size).toBe(manifestDomains.length);
    expect(new Set(refreshDomainDescriptors.map((descriptor) => descriptor.domain))).toEqual(
      new Set(manifestDomains)
    );
    expect(new Set(registeredDomains().keys())).toEqual(new Set(manifestDomains));

    const resourceStreamDomains = new Set<RefreshDomain>(RESOURCE_STREAM_DOMAINS);

    for (const entry of manifest.domains) {
      const descriptor = getRefreshDomainDescriptor(entry.domain);
      const registration = registeredDomains().get(entry.domain);
      expect(registration).toBeDefined();
      expect(descriptor.category).toBe(entry.category);
      expect(registration?.category).toBe(entry.category);
      expect(registration?.refresherName).toBe(DOMAIN_REFRESHER_MAP[entry.domain]);
      expect(DOMAIN_STREAM_MAP[entry.domain]).toBe(entry.frontend.diagnosticsStream ?? undefined);
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
