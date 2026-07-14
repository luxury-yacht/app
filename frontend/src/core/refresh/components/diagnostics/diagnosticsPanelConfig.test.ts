/**
 * frontend/src/core/refresh/components/diagnostics/diagnosticsPanelConfig.test.ts
 *
 * Pins diagnostics domain-behavior sets derived from the refresh domain
 * contract so polling and streaming behavior cannot drift silently.
 */

import { describe, expect, test } from 'vitest';
import { PERMISSION_FEATURES } from '@/core/capabilities/permissionFeatures';
import {
  getScopedFeaturesForView,
  PAUSE_POLLING_WHEN_STREAMING_DOMAINS,
  STREAM_ONLY_DOMAINS,
} from './diagnosticsPanelConfig';

const sortedDomains = (domains: Set<string>) => Array.from(domains).sort();

describe('diagnosticsPanelConfig domain behavior sets', () => {
  test('pins stream-only domains derived from the contract', () => {
    expect(sortedDomains(STREAM_ONLY_DOMAINS)).toEqual(['container-logs']);
  });

  test('pins domains that pause polling while streaming', () => {
    // pods/nodes/namespace-workloads pause polling while streaming like every
    // other stream-covered domain: their metric cadence is push-driven (the
    // backend poller fans a metric doorbell over the stream), so no
    // client-side metrics polling remains.
    expect(sortedDomains(PAUSE_POLLING_WHEN_STREAMING_DOMAINS)).toEqual([
      'catalog',
      'cluster-config',
      'cluster-crds',
      'cluster-custom',
      'cluster-events',
      'cluster-rbac',
      'cluster-storage',
      'namespace-applications',
      'namespace-autoscaling',
      'namespace-config',
      'namespace-custom',
      'namespace-events',
      'namespace-helm',
      'namespace-network',
      'namespace-quotas',
      'namespace-rbac',
      'namespace-storage',
      'namespace-workloads',
      'namespaces',
      'nodes',
      'object-events',
      'pods',
    ]);
  });

  test('reports cluster-overview permissions for the Fleet lens', () => {
    expect(getScopedFeaturesForView('cluster', 'fleet', 'workloads')).toEqual([
      PERMISSION_FEATURES.clusterOverview,
    ]);
  });
});
