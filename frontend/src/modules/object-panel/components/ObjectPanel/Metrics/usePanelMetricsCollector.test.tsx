/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/usePanelMetricsCollector.test.tsx
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResourceMetricsResult } from '@/core/resource-metrics';
import { usePanelMetricsCollector } from './usePanelMetricsCollector';

const hoisted = vi.hoisted(() => ({
  result: null as ResourceMetricsResult | null,
  calls: [] as Array<{ objectData: unknown; enabled: boolean | undefined }>,
  appended: [] as Array<{ clusterId: string; panelId: string; t: number; cpu: unknown }>,
  appendError: null as Error | null,
  reported: [] as unknown[],
}));

vi.mock('@/core/resource-metrics', () => ({
  useResourceMetrics: (objectData: unknown, enabled?: boolean) => {
    hoisted.calls.push({ objectData, enabled });
    return hoisted.result;
  },
}));

vi.mock('./panelMetricSamples', () => ({
  appendPanelMetricSample: async (
    clusterId: string,
    panelId: string,
    sample: { t: number; cpu?: unknown }
  ) => {
    if (hoisted.appendError) {
      throw hoisted.appendError;
    }
    hoisted.appended.push({ clusterId, panelId, t: sample.t, cpu: sample.cpu });
  },
}));

vi.mock('@/utils/errorHandler', () => ({
  reportOperationalError: (error: unknown) => {
    hoisted.reported.push(error);
  },
}));

const PANEL_ID = 'obj:dev:dev-cluster:/v1/pod:podinfo:podinfo-66888d8d86-5lpbr';
const pod = {
  clusterId: 'dev:dev-cluster',
  group: '',
  version: 'v1',
  kind: 'Pod',
  namespace: 'podinfo',
  name: 'podinfo-66888d8d86-5lpbr',
};
const podResolution: ResourceMetricsResult['resolution'] = {
  kind: 'domain',
  ref: pod,
  source: 'pods',
  domain: 'pods',
  scope: 'dev:dev-cluster|namespace:podinfo',
};

// One poller collection as the Pod's `pods` scope serves it (collectedAt is unix seconds).
const collection = (collectedAt: number, cpu: number): ResourceMetricsResult => ({
  status: 'available',
  metrics: {
    source: 'pods',
    cpu: { usage: cpu, limit: 500 },
    memory: { usage: cpu * 1_000_000 },
    freshness: { collectedAt, stale: false },
  },
  resolution: podResolution,
});

describe('usePanelMetricsCollector', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const Harness = ({ enabled }: { enabled: boolean }) => {
    usePanelMetricsCollector(PANEL_ID, pod, enabled);
    return null;
  };

  const render = async (enabled: boolean, result: ResourceMetricsResult | null) => {
    hoisted.result = result;
    await act(async () => root.render(<Harness enabled={enabled} />));
  };

  const unmount = () => {
    act(() => root.unmount());
    root = ReactDOM.createRoot(container);
  };

  const appendedTimes = () => hoisted.appended.map((sample) => sample.t);

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    container = document.createElement('div');
    root = ReactDOM.createRoot(container);
    hoisted.calls = [];
    hoisted.appended = [];
    hoisted.appendError = null;
    hoisted.reported = [];
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it('sends one sample per poller collection, not per render, for the panel', async () => {
    vi.setSystemTime(1_000_000);
    await render(true, collection(1_000, 10));
    await render(true, collection(1_000, 10));
    await render(true, collection(1_005, 12));

    expect(appendedTimes()).toEqual([1_000_000, 1_005_000]);
    expect(hoisted.appended[1]).toMatchObject({
      clusterId: 'dev:dev-cluster',
      panelId: PANEL_ID,
      cpu: { usage: 12, limit: 500 },
    });
    expect(hoisted.calls[hoisted.calls.length - 1]).toEqual({ objectData: pod, enabled: true });
  });

  it('skips data retained from before it started collecting', async () => {
    vi.setSystemTime(2_000_000);
    await render(true, collection(1_000, 10));
    expect(appendedTimes()).toEqual([]);

    await render(true, collection(2_005, 12));
    expect(appendedTimes()).toEqual([2_005_000]);
  });

  it('stops sending while paused and resumes afterwards', async () => {
    vi.setSystemTime(3_000_000);
    await render(true, collection(3_000, 10));
    await render(false, collection(3_005, 11));
    expect(hoisted.calls[hoisted.calls.length - 1]?.enabled).toBe(false);
    expect(appendedTimes()).toEqual([3_000_000]);

    vi.setSystemTime(3_100_000);
    await render(true, collection(3_105, 13));
    expect(appendedTimes()).toEqual([3_000_000, 3_105_000]);
  });

  it('resumes after the panel remounts for a cluster switch', async () => {
    vi.setSystemTime(4_000_000);
    await render(true, collection(4_000, 10));
    unmount();

    vi.setSystemTime(4_200_000);
    await render(true, collection(4_205, 11));
    expect(appendedTimes()).toEqual([4_000_000, 4_205_000]);
  });

  it('reports a failing send once, not on every collection', async () => {
    vi.setSystemTime(5_000_000);
    hoisted.appendError = new Error('backend unavailable');
    await render(true, collection(5_000, 10));
    await render(true, collection(5_005, 11));
    expect(hoisted.reported).toHaveLength(1);

    hoisted.appendError = null;
    await render(true, collection(5_010, 12));
    hoisted.appendError = new Error('backend unavailable');
    await render(true, collection(5_015, 13));
    expect(hoisted.reported).toHaveLength(2);
  });

  it('sends nothing for an object without live metrics', async () => {
    await render(true, {
      status: 'unsupported',
      metrics: null,
      resolution: { kind: 'unsupported', reason: 'unsupported-kind' },
    });
    expect(hoisted.appended).toEqual([]);
  });
});
