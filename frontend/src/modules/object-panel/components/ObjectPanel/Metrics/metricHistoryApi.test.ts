/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/metricHistoryApi.test.ts
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadObjectMetricHistory, metricHistoryTarget } from './metricHistoryApi';

const backendMocks = vi.hoisted(() => ({ GetObjectMetricHistory: vi.fn() }));

vi.mock('@/core/backend-api', () => backendMocks);

const preferenceMocks = vi.hoisted(() => ({ autoRefreshEnabled: true }));

vi.mock('@/core/settings/appPreferences', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/settings/appPreferences')>()),
  getAutoRefreshEnabled: () => preferenceMocks.autoRefreshEnabled,
}));

const pod = {
  clusterId: 'dev:dev-cluster',
  group: '',
  version: 'v1',
  kind: 'Pod',
  namespace: 'podinfo',
  name: 'podinfo-66888d8d86-5lpbr',
};

describe('metricHistoryTarget', () => {
  it('requires the complete object identity, including the core group', () => {
    expect(metricHistoryTarget({ ...pod, clusterName: 'dev', kindAlias: 'po' })).toEqual(pod);
    for (const missing of ['clusterId', 'version', 'kind', 'namespace', 'name', 'group'] as const) {
      expect(metricHistoryTarget({ ...pod, [missing]: null })).toBeNull();
    }
  });
});

describe('loadObjectMetricHistory', () => {
  beforeEach(() => {
    backendMocks.GetObjectMetricHistory.mockReset();
    preferenceMocks.autoRefreshEnabled = true;
  });

  it('sends the span with the full identity and normalizes the nulls Go sends', async () => {
    backendMocks.GetObjectMetricHistory.mockResolvedValue({
      mode: 'source',
      source: { id: 'src-1', name: 'dev prometheus' },
      grid: { startMs: 0, stepMs: 15_000, count: 2 },
      graphs: [{ id: 'cpu', unit: 'millicores', status: 'noData', series: null }],
    });

    const result = await loadObjectMetricHistory(pod, 3_600_000, 'foreground');

    expect(backendMocks.GetObjectMetricHistory).toHaveBeenCalledWith({ ...pod, spanMs: 3_600_000 });
    expect(result).toMatchObject({
      status: 'executed',
      data: { graphs: [{ id: 'cpu', series: [] }] },
    });
  });

  it('skips scheduled re-queries while auto-refresh is paused but still answers the user', async () => {
    preferenceMocks.autoRefreshEnabled = false;
    backendMocks.GetObjectMetricHistory.mockResolvedValue({
      mode: 'live',
      liveReason: 'noSource',
      grid: { startMs: 0, stepMs: 0, count: 0 },
      graphs: null,
    });

    await expect(loadObjectMetricHistory(pod, 3_600_000, 'background')).resolves.toEqual({
      status: 'blocked',
    });
    expect(backendMocks.GetObjectMetricHistory).not.toHaveBeenCalled();

    await expect(loadObjectMetricHistory(pod, 3_600_000, 'user')).resolves.toMatchObject({
      status: 'executed',
      data: { mode: 'live', graphs: [] },
    });
  });
});
