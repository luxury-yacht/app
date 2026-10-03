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

const broker = vi.hoisted(() => ({
  requests: [] as Array<{ resource: string; reason: string; scope?: string }>,
  blocked: false,
}));

// The real broker gates reads on auto-refresh; this one records each request and runs it.
vi.mock('@/core/data-access', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/data-access')>()),
  requestData: async (request: {
    resource: string;
    reason: string;
    scope?: string;
    read: () => Promise<unknown>;
  }) => {
    broker.requests.push({
      resource: request.resource,
      reason: request.reason,
      scope: request.scope,
    });
    return broker.blocked
      ? { status: 'blocked', blockedReason: 'auto-refresh-disabled' }
      : { status: 'executed', data: await request.read() };
  },
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
    broker.requests = [];
    broker.blocked = false;
    backend.series = {
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

    backend.series = {
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

  it('reads through the data broker: retained history when shown, then what this window appends', async () => {
    await render(true);
    await act(async () => {
      await appendPanelMetricSample(CLUSTER, PANEL_ID, { t: 11_000, cpu: { usage: 30 } });
    });

    expect(broker.requests.map(({ resource, reason }) => ({ resource, reason }))).toEqual([
      // Allowed while auto-refresh is paused, so the tab still shows the panel's samples.
      { resource: 'panel-metric-series', reason: 'foreground' },
      { resource: 'panel-metric-series', reason: 'stream-signal' },
    ]);
    expect(broker.requests[0].scope).toContain(PANEL_ID);
  });

  it('keeps what it shows when the broker blocks a read', async () => {
    await render(true);
    // The backend has a newer sample, but the broker turns the read away.
    backend.series = {
      firstT: 1_000,
      samples: [wire(1_000, 10), wire(6_000, 20), wire(11_000, 30)],
    };
    broker.blocked = true;
    await act(async () => {
      await appendPanelMetricSample(CLUSTER, PANEL_ID, { t: 11_000, cpu: { usage: 30 } });
    });

    expect(shownTimes()).toEqual([1_000, 6_000]);
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
