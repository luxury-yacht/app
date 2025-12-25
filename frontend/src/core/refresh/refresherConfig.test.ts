/**
 * frontend/src/core/refresh/refresherConfig.test.ts
 *
 * Tests for refresher configuration.
 */
import { describe, expect, it } from 'vitest';

import {
  clusterRefresherConfig,
  namespaceRefresherConfig,
  systemRefresherConfig,
} from './refresherConfig';
import { CLUSTER_REFRESHERS, NAMESPACE_REFRESHERS, SYSTEM_REFRESHERS } from './refresherTypes';

describe('refresherConfig cadence defaults', () => {
  it('exposes expected namespace refresher timings', () => {
    expect(namespaceRefresherConfig(NAMESPACE_REFRESHERS.events)).toEqual({
      interval: 3000,
      cooldown: 1000,
      timeout: 10,
    });

    expect(namespaceRefresherConfig(NAMESPACE_REFRESHERS.workloads)).toEqual({
      interval: 2000,
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
    expect(clusterRefresherConfig(CLUSTER_REFRESHERS.nodeMaintenance)).toEqual({
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
