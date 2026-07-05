/**
 * frontend/src/shared/utils/metricsAvailability.test.ts
 *
 * Test suite for metricsAvailability.
 * Covers key behaviors and edge cases for metricsAvailability.
 */

import { describe, expect, it } from 'vitest';

import { getMetricsBannerInfo } from './metricsAvailability';

describe('getMetricsBannerInfo', () => {
  it('reports "Collecting metrics" for the pristine first-collection window', () => {
    // The demand-driven poller starts when a metric-bearing view opens; the
    // first successful collection takes a round-trip. During that window the
    // payload carries successCount 0 with NO failures and NO error — the
    // cluster is fine, we simply have not collected yet. This must read as
    // collection-in-progress, not as the generic stale/awaiting state (and
    // definitely not as a silent blank card next to a "Ready" status).
    const banner = getMetricsBannerInfo({
      stale: true,
      successCount: 0,
      failureCount: 0,
      consecutiveFailures: 0,
    });
    expect(banner?.message).toBe('Collecting metrics…');
    expect(banner?.tooltip).toContain('first metrics collection');

    // The REAL payload shape observed live: older backends serialized Go's
    // zero time as a huge negative Unix stamp instead of omitting the field.
    // It must still read as "not collected yet".
    const bannerWithZeroTime = getMetricsBannerInfo({
      stale: false,
      successCount: 0,
      failureCount: 0,
      consecutiveFailures: 0,
      collectedAt: -62135596800,
    });
    expect(bannerWithZeroTime?.message).toBe('Collecting metrics…');
  });

  it('surfaces the terminal reason for a disabled poller instead of "Collecting metrics"', () => {
    // Regression: a DisabledPoller (no metrics permission, or metrics-server
    // absent) reports successCount 0 / no failures / zero collectedAt — the same
    // counters as the pristine window — but carries a permanent reason in
    // lastError. Without the disabled flag it was mistaken for "collecting" and
    // the app silently stuck there forever. The flag must short-circuit to the
    // reason verbatim — this uses a reason the keyword branches do NOT special-
    // case, so the assertion fails unless the disabled branch handles it.
    const banner = getMetricsBannerInfo({
      disabled: true,
      lastError: 'Metrics API not found (metrics-server)',
      successCount: 0,
      failureCount: 0,
      consecutiveFailures: 0,
    });
    expect(banner).toEqual({
      message: 'Metrics API not found (metrics-server)',
      tooltip: 'Metrics API not found (metrics-server)',
    });
  });

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
