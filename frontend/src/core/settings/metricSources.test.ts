import type { backend } from '@core/backend-api/models';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  loadMetricServiceCandidates,
  loadMetricSourceSettings,
  testMetricSource,
} from './metricSources';

const backendMocks = vi.hoisted(() => ({
  ListMetricServiceCandidates: vi.fn(),
  GetMetricSourceSettings: vi.fn(),
  TestMetricSource: vi.fn(),
}));

vi.mock('@/core/backend-api', () => backendMocks);

const preferenceMocks = vi.hoisted(() => ({ autoRefreshEnabled: true }));

vi.mock('@/core/settings/appPreferences', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/settings/appPreferences')>()),
  getAutoRefreshEnabled: () => preferenceMocks.autoRefreshEnabled,
}));

describe('metric source settings access', () => {
  beforeEach(() => {
    backendMocks.ListMetricServiceCandidates.mockReset();
    backendMocks.GetMetricSourceSettings.mockReset();
  });

  it('still lists Services while automatic refresh is paused, because the user is editing', async () => {
    preferenceMocks.autoRefreshEnabled = false;
    backendMocks.ListMetricServiceCandidates.mockResolvedValue([
      { namespace: 'monitoring', name: 'prometheus-operated' },
    ]);

    await expect(loadMetricServiceCandidates('dev:dev-cluster')).resolves.toEqual([
      { namespace: 'monitoring', name: 'prometheus-operated' },
    ]);
    expect(backendMocks.ListMetricServiceCandidates).toHaveBeenCalledWith('dev:dev-cluster');
  });

  it('tests a connection while automatic refresh is paused, because the user asked', async () => {
    preferenceMocks.autoRefreshEnabled = false;
    const source = {
      id: '',
      name: '',
      mode: 'in-cluster',
      inCluster: {
        clusterId: 'dev:dev-cluster',
        namespace: 'monitoring',
        service: 'prometheus-operated',
        port: 'web',
        scheme: 'http',
        pathPrefix: '',
      },
    } as backend.MetricSource;
    backendMocks.TestMetricSource.mockResolvedValue({ ok: true, version: '3.15.0' });

    await expect(testMetricSource(source)).resolves.toEqual({ ok: true, version: '3.15.0' });
    expect(backendMocks.TestMetricSource).toHaveBeenCalledWith(source);
  });

  it('normalizes the nulls Go sends for empty sources and missing assignments', async () => {
    backendMocks.GetMetricSourceSettings.mockResolvedValue({
      sources: null,
      assignments: { 'dev:dev-cluster': { kind: 'none' }, 'stg:stg-cluster': undefined },
    });

    await expect(loadMetricSourceSettings()).resolves.toEqual({
      sources: [],
      assignments: { 'dev:dev-cluster': { kind: 'none' } },
    });
  });
});
