/**
 * frontend/src/shared/utils/metricsAvailability.test.ts
 *
 * Test suite for metricsAvailability.
 * Covers key behaviors and edge cases for metricsAvailability.
 */

import { describe, expect, it } from 'vitest';

import { getMetricsBannerInfo } from './metricsAvailability';

describe('getMetricsBannerInfo', () => {
  it('returns awaiting message during initial transient failures', () => {
    const banner = getMetricsBannerInfo({
      lastError: 'metrics API unavailable (pods.metrics.k8s.io)',
      successCount: 0,
      failureCount: 1,
      consecutiveFailures: 1,
      collectedAt: 0,
    });

    expect(banner).toEqual({
      message: 'Awaiting metrics data...',
      tooltip: 'Awaiting data from metrics-server',
    });
  });

  it('surfaces errors after repeated failures', () => {
    const banner = getMetricsBannerInfo({
      lastError: 'metrics API unavailable (pods.metrics.k8s.io)',
      successCount: 0,
      failureCount: 5,
      consecutiveFailures: 5,
      collectedAt: 0,
    });

    expect(banner).toEqual({
      message: 'Metrics API not found! metrics-server may not be installed in the cluster.',
      tooltip: 'metrics API unavailable (pods.metrics.k8s.io)',
    });
  });

  it('returns null when metrics are fresh with no errors', () => {
    const banner = getMetricsBannerInfo({
      collectedAt: Date.now(),
      successCount: 1,
      failureCount: 0,
      consecutiveFailures: 0,
      lastError: '',
    });

    expect(banner).toBeNull();
  });

  it('passes through real errors after successes', () => {
    const banner = getMetricsBannerInfo({
      lastError: 'metrics API unavailable (pods.metrics.k8s.io)',
      successCount: 1,
      failureCount: 2,
      consecutiveFailures: 2,
      collectedAt: Date.now(),
    });

    expect(banner?.message).toContain('Metrics API');
  });
});
