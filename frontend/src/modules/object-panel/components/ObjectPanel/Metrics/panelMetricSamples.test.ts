/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/panelMetricSamples.test.ts
 */

import { act, createElement } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { panelmetrics } from '@/core/backend-api/models';
import {
  appendPanelMetricSample,
  type PanelMetricSeries,
  usePanelMetricSeries,
} from './panelMetricSamples';

const backend = vi.hoisted(() => ({
  appended: [] as Array<{ clusterId: string; panelId: string; sample: unknown }>,
  reads: [] as number[],
  series: null as panelmetrics.Series | null,
}));

vi.mock('@/core/backend-api', () => ({
  AppendPanelMetricSample: async (clusterId: string, panelId: string, sample: unknown) => {
    backend.appended.push({ clusterId, panelId, sample });
  },
  GetPanelMetricSeries: async (_clusterId: string, _panelId: string, afterT: number) => {
    backend.reads.push(afterT);
    const series = backend.series;
    return series && { ...series, samples: (series.samples ?? []).filter((s) => s.t > afterT) };
  },
}));

const CLUSTER = 'dev:dev-cluster';
const PANEL_ID = 'obj:dev:dev-cluster:/v1/pod:podinfo:api';

const wire = (t: number, cpu: number): panelmetrics.Sample => ({
  t,
  cpu: { usage: cpu, limit: 500, request: null },
  memory: { usage: 64 },
});

describe('panel metric samples', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  const latest: { current: PanelMetricSeries | null } = { current: null };

  const Harness = ({ enabled }: { enabled: boolean }) => {
    latest.current = usePanelMetricSeries(CLUSTER, PANEL_ID, enabled);
    return null;
  };

  const render = async (enabled: boolean) => {
    await act(async () => root.render(createElement(Harness, { enabled })));
  };

  const shownTimes = () => latest.current?.samples.map((sample) => sample.t);

  beforeEach(() => {
    container = document.createElement('div');
    root = ReactDOM.createRoot(container);
    backend.appended = [];
    backend.reads = [];
    backend.series = {
      startedAt: 1_000,
      firstT: 1_000,
      samples: [wire(1_000, 10), wire(6_000, 20)],
    };
  });

  afterEach(() => {
    act(() => root.unmount());
  });

  it('shows the series the panel collected, then reads only what this window appends', async () => {
    await render(true);
    expect(shownTimes()).toEqual([1_000, 6_000]);
    expect(latest.current?.startedAt).toBe(1_000);

    backend.series = {
      startedAt: 1_000,
      firstT: 1_000,
      samples: [wire(1_000, 10), wire(6_000, 20), wire(11_000, 30)],
    };
    await act(async () => {
      await appendPanelMetricSample(CLUSTER, PANEL_ID, { t: 11_000, cpu: { usage: 30 } });
    });

    expect(backend.appended).toEqual([
      {
        clusterId: CLUSTER,
        panelId: PANEL_ID,
        sample: { t: 11_000, cpu: { usage: 30 }, memory: {} },
      },
    ]);
    expect(backend.reads).toEqual([0, 6_000]);
    expect(shownTimes()).toEqual([1_000, 6_000, 11_000]);
  });

  it('keeps unreported values absent rather than zero', async () => {
    await render(true);
    const [first] = latest.current?.samples ?? [];
    expect(first.cpu).toEqual({ usage: 10, limit: 500 });
    expect(first.cpu?.request).toBeUndefined();
  });

  it('drops samples the backend no longer keeps', async () => {
    await render(true);
    backend.series = {
      startedAt: 1_000,
      firstT: 6_000,
      samples: [wire(6_000, 20), wire(11_000, 30)],
    };
    await act(async () => {
      await appendPanelMetricSample(CLUSTER, PANEL_ID, { t: 11_000, cpu: { usage: 30 } });
    });

    expect(shownTimes()).toEqual([6_000, 11_000]);
  });

  it('reads nothing while hidden and the whole series again when shown', async () => {
    await render(false);
    expect(backend.reads).toEqual([]);
    expect(shownTimes()).toEqual([]);

    await render(true);
    await render(false);
    await act(async () => {
      await appendPanelMetricSample(CLUSTER, PANEL_ID, { t: 11_000 });
    });
    await render(true);

    expect(backend.reads).toEqual([0, 0]);
  });
});
