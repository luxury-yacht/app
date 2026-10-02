/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/usePanelMetricsCollector.test.tsx
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResourceMetricsResult } from '@/core/resource-metrics';
import {
  clearPanelMetricSamples,
  getPanelMetricSamples,
  type PanelMetricSamples,
} from './panelMetricSamples';
import { usePanelMetricsCollector } from './usePanelMetricsCollector';

const hoisted = vi.hoisted(() => ({
  result: null as ResourceMetricsResult | null,
  calls: [] as Array<{ objectData: unknown; enabled: boolean | undefined }>,
}));

vi.mock('@/core/resource-metrics', () => ({
  useResourceMetrics: (objectData: unknown, enabled?: boolean) => {
    hoisted.calls.push({ objectData, enabled });
    return hoisted.result;
  },
}));

const PANEL_ID = 'obj:dev:dev-cluster:/v1:Pod:podinfo:podinfo-66888d8d86-5lpbr';
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

  const stored = (): PanelMetricSamples | undefined => getPanelMetricSamples(PANEL_ID);
  const sampleTimes = () => stored()?.samples.map((sample) => sample.t);
  const gapsBefore = () => stored()?.samples.map((sample) => Boolean(sample.afterGap));

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    root = ReactDOM.createRoot(container);
    hoisted.calls = [];
  });

  afterEach(() => {
    act(() => root.unmount());
    clearPanelMetricSamples(PANEL_ID);
    vi.useRealTimers();
  });

  it('records one sample per poller collection, not per render', async () => {
    vi.setSystemTime(1_000_000);
    await render(true, collection(1_000, 10));
    await render(true, collection(1_000, 10));
    await render(true, collection(1_005, 12));

    expect(sampleTimes()).toEqual([1_000_000, 1_005_000]);
    expect(stored()?.samples[1]).toMatchObject({ cpu: { usage: 12, limit: 500 } });
    expect(stored()?.startedAt).toBe(1_000_000);
    expect(hoisted.calls[hoisted.calls.length - 1]).toEqual({ objectData: pod, enabled: true });
  });

  it('ignores data retained from before the panel started collecting', async () => {
    vi.setSystemTime(2_000_000);
    await render(true, collection(1_000, 10));
    expect(sampleTimes()).toEqual([]);

    await render(true, collection(2_005, 12));
    expect(sampleTimes()).toEqual([2_005_000]);
  });

  it('keeps its samples while paused and marks a gap where collection resumes', async () => {
    vi.setSystemTime(3_000_000);
    await render(true, collection(3_000, 10));
    await render(true, collection(3_005, 11));

    // Auto-refresh paused: the lease is released, the samples stay.
    await render(false, collection(3_010, 12));
    expect(hoisted.calls[hoisted.calls.length - 1]?.enabled).toBe(false);
    expect(sampleTimes()).toEqual([3_000_000, 3_005_000]);

    vi.setSystemTime(3_100_000);
    await render(true, collection(3_010, 12));
    await render(true, collection(3_105, 13));
    expect(sampleTimes()).toEqual([3_000_000, 3_005_000, 3_105_000]);
    expect(gapsBefore()).toEqual([false, false, true]);
  });

  it('keeps its samples when the panel unmounts for a cluster switch and resumes after a gap', async () => {
    vi.setSystemTime(4_000_000);
    await render(true, collection(4_000, 10));
    unmount();
    expect(sampleTimes()).toEqual([4_000_000]);

    vi.setSystemTime(4_200_000);
    await render(true, collection(4_205, 11));
    expect(sampleTimes()).toEqual([4_000_000, 4_205_000]);
    expect(gapsBefore()).toEqual([false, true]);
    expect(stored()?.startedAt).toBe(4_000_000);
  });

  it('keeps only the last hour of samples', async () => {
    vi.setSystemTime(10_000_000);
    for (let collectedAt = 10_000; collectedAt <= 14_000; collectedAt += 500) {
      await render(true, collection(collectedAt, 10));
    }
    expect(sampleTimes()?.[0]).toBe(10_500_000);
    expect(sampleTimes()?.[(sampleTimes()?.length ?? 0) - 1]).toBe(14_000_000);
  });

  it('reports why live metrics have nothing to show', async () => {
    vi.setSystemTime(5_000_000);
    await render(true, {
      status: 'error',
      metrics: null,
      resolution: podResolution,
      error: 'metrics API not available',
    });
    expect(stored()?.error).toBe('metrics API not available');
  });

  it('collects nothing for an object without live metrics', async () => {
    await render(true, {
      status: 'unsupported',
      metrics: null,
      resolution: { kind: 'unsupported', reason: 'unsupported-kind' },
    });
    expect(stored()).toBeUndefined();
  });
});
