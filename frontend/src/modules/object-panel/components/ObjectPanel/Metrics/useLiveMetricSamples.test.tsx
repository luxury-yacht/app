/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/useLiveMetricSamples.test.tsx
 */

import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResourceMetricsResult } from '@/core/resource-metrics';
import { type LiveMetricSamples, useLiveMetricSamples } from './useLiveMetricSamples';

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

const pod = {
  clusterId: 'dev:dev-cluster',
  group: '',
  version: 'v1',
  kind: 'Pod',
  namespace: 'podinfo',
  name: 'podinfo-66888d8d86-5lpbr',
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
  resolution: { kind: 'unsupported', reason: 'unsupported-kind' },
});

describe('useLiveMetricSamples', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const latest: { current: LiveMetricSamples | null } = { current: null };

  const Harness = ({ enabled }: { enabled: boolean }) => {
    latest.current = useLiveMetricSamples(pod, enabled);
    return null;
  };

  const render = async (enabled: boolean, result: ResourceMetricsResult | null) => {
    hoisted.result = result;
    await act(async () => root.render(<Harness enabled={enabled} />));
  };

  const sampleTimes = () => latest.current?.samples.map((sample) => sample.t);

  beforeEach(() => {
    vi.useFakeTimers();
    container = document.createElement('div');
    root = ReactDOM.createRoot(container);
    hoisted.calls = [];
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.useRealTimers();
  });

  it('records one sample per poller collection, not per render', async () => {
    vi.setSystemTime(1_000_000);
    await render(true, collection(1_000, 10));
    await render(true, collection(1_000, 10));
    await render(true, collection(1_005, 12));

    expect(sampleTimes()).toEqual([1_000_000, 1_005_000]);
    expect(latest.current?.samples[1]).toMatchObject({ cpu: { usage: 12, limit: 500 } });
    expect(hoisted.calls[hoisted.calls.length - 1]).toEqual({ objectData: pod, enabled: true });
  });

  it('ignores data retained from an earlier visit, so a revisit never draws a gap', async () => {
    vi.setSystemTime(2_000_000);
    await render(true, collection(1_000, 10));
    expect(sampleTimes()).toEqual([]);

    await render(true, collection(2_005, 12));
    expect(sampleTimes()).toEqual([2_005_000]);
  });

  it('stops collecting and forgets every sample when disabled; re-enabling starts empty', async () => {
    vi.setSystemTime(3_000_000);
    await render(true, collection(3_000, 10));
    await render(true, collection(3_005, 11));
    expect(sampleTimes()).toHaveLength(2);

    await render(false, collection(3_010, 12));
    expect(sampleTimes()).toEqual([]);
    expect(hoisted.calls[hoisted.calls.length - 1]?.enabled).toBe(false);

    vi.setSystemTime(3_100_000);
    await render(true, collection(3_010, 12));
    expect(sampleTimes()).toEqual([]);
  });

  it('keeps only the last hour of samples', async () => {
    vi.setSystemTime(10_000_000);
    for (let collectedAt = 10_000; collectedAt <= 14_000; collectedAt += 500) {
      await render(true, collection(collectedAt, 10));
    }
    expect(sampleTimes()?.[0]).toBe(10_500_000);
    expect(sampleTimes()?.[(sampleTimes()?.length ?? 0) - 1]).toBe(14_000_000);
  });
});
