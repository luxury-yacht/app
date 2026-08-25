import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/core/telemetry/sentry', () => ({
  recordBrokerRequestCompleted: vi.fn(),
  recordBrokerRequestStarted: vi.fn(),
}));

import {
  beginBrokerRead,
  completeBrokerRead,
  getBrokerReadDiagnosticsSnapshot,
  resetBrokerReadDiagnosticsForTesting,
} from './store';

const read = (scope: string) => {
  const token = beginBrokerRead({
    broker: 'data-access',
    resource: 'pods',
    adapter: 'refresh-domain',
    reason: 'background',
    scope,
  });
  completeBrokerRead({ token, status: 'success' });
};

describe('broker read cluster identity', () => {
  beforeEach(() => {
    resetBrokerReadDiagnosticsForTesting();
  });

  it('keeps one row per cluster so a read can hang under its cluster', () => {
    read('cluster-a|default');
    read('cluster-b|default');
    read('cluster-a|kube-system');

    const rows = getBrokerReadDiagnosticsSnapshot();
    expect(rows).toHaveLength(2);
    const byCluster = Object.fromEntries(rows.map((row) => [row.clusterId, row.totalRequests]));
    expect(byCluster).toEqual({ 'cluster-a': 2, 'cluster-b': 1 });
  });

  it('leaves cluster empty for reads with no single owning cluster', () => {
    const token = beginBrokerRead({
      broker: 'app-state-access',
      resource: 'favorites',
      adapter: 'persistence-read',
    });
    completeBrokerRead({ token, status: 'success' });
    read('clusters=cluster-a,cluster-b|');

    const rows = getBrokerReadDiagnosticsSnapshot();
    expect(rows.every((row) => !row.clusterId)).toBe(true);
  });
});
