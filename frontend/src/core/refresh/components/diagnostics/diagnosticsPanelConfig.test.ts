/**
 * frontend/src/core/refresh/components/diagnostics/diagnosticsPanelConfig.test.ts
 *
 * Pins diagnostics domain-behavior sets derived from the refresh domain
 * contract so polling and streaming behavior cannot drift silently.
 */

import { describe, expect, test } from 'vitest';
import {
  METRICS_ONLY_DOMAINS,
  PAUSE_POLLING_WHEN_STREAMING_DOMAINS,
  STREAM_ONLY_DOMAINS,
} from './diagnosticsPanelConfig';

const sortedDomains = (domains: Set<string>) => Array.from(domains).sort();

describe('diagnosticsPanelConfig domain behavior sets', () => {
  test('pins metric-interval domains derived from the contract', () => {
    expect(sortedDomains(METRICS_ONLY_DOMAINS)).toEqual(['namespace-workloads', 'nodes', 'pods']);
  });

  test('pins stream-only domains derived from the contract', () => {
    expect(sortedDomains(STREAM_ONLY_DOMAINS)).toEqual(['container-logs']);
  });

  test('pins domains that pause polling while streaming', () => {
    expect(sortedDomains(PAUSE_POLLING_WHEN_STREAMING_DOMAINS)).toEqual([
      'catalog',
      'cluster-config',
      'cluster-crds',
      'cluster-custom',
      'cluster-events',
      'cluster-rbac',
      'cluster-storage',
      'namespace-autoscaling',
      'namespace-config',
      'namespace-custom',
      'namespace-events',
      'namespace-helm',
      'namespace-network',
      'namespace-quotas',
      'namespace-rbac',
      'namespace-storage',
    ]);
  });
});
