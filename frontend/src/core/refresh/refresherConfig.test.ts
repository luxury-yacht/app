/**
 * frontend/src/core/refresh/refresherConfig.test.ts
 *
 * Test suite for refresherConfig.
 * Covers key behaviors and edge cases for refresherConfig.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import {
  clusterRefresherConfig,
  namespaceRefresherConfig,
  systemRefresherConfig,
} from './refresherConfig';
import { CLUSTER_REFRESHERS, NAMESPACE_REFRESHERS, SYSTEM_REFRESHERS } from './refresherTypes';
import { resetAppPreferencesCacheForTesting } from '@/core/settings/appPreferences';

describe('refresherConfig cadence defaults', () => {
  beforeEach(() => {
    // Ensure metrics interval defaults are reset between test runs.
    resetAppPreferencesCacheForTesting();
  });

  it('exposes expected namespace refresher timings', () => {
    expect(namespaceRefresherConfig(NAMESPACE_REFRESHERS.events)).toEqual({
      interval: 3000,
      cooldown: 1000,
      timeout: 10,
    });

    expect(namespaceRefresherConfig(NAMESPACE_REFRESHERS.workloads)).toEqual({
      interval: 5000,
      cooldown: 500,
      timeout: 10,
    });
  });

  it('exposes expected cluster refresher timings', () => {
    expect(clusterRefresherConfig(CLUSTER_REFRESHERS.nodes)).toEqual({
      interval: 5000,
      cooldown: 1000,
      timeout: 10,
    });
    expect(clusterRefresherConfig(CLUSTER_REFRESHERS.browse)).toEqual({
      interval: 15000,
      cooldown: 1500,
      timeout: 30,
    });
  });

  it('exposes expected system refresher timings', () => {
    expect(systemRefresherConfig(SYSTEM_REFRESHERS.objectMaintenance)).toEqual({
      interval: 5000,
      cooldown: 1000,
      timeout: 10,
    });

    expect(systemRefresherConfig(SYSTEM_REFRESHERS.objectLogs)).toEqual({
      interval: 5000,
      cooldown: 1000,
      timeout: 10,
    });

    expect(systemRefresherConfig(SYSTEM_REFRESHERS.clusterOverview)).toEqual({
      interval: 10000,
      cooldown: 1000,
      timeout: 10,
    });
  });
});
