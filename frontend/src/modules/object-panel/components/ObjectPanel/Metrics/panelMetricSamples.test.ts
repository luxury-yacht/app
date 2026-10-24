/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/panelMetricSamples.test.ts
 *
 * The panel metric series client against the backend panel buffer, through the
 * real data broker and auto-refresh preference inside the app shell. Only the
 * backend boundary is faked (test-utils/appState); the buffer answers mirror
 * backend/panelmetrics/buffer.go.
 */

import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import type { panelmetrics } from '@/core/backend-api/models';
import { objectPanelId } from '@/modules/object-panel/objectPanelRef';
import { installAppStateHarness, type TestCluster } from '@/test-utils/appState/harness';
import {
  appendPanelMetricSample,
  type PanelMetricSeries,
  usePanelMetricSeries,
} from './panelMetricSamples';

const app = installAppStateHarness();

/**
 * The backend buffer (backend/panelmetrics/buffer.go Append and Since): samples
 * kept in time order per panel, the oldest dropped past `maxSamples`; a read
 * returns those newer than afterT and the oldest still kept. The panel counts
 * as open in the panel directory.
 */
const answerPanelBuffer = (seed: panelmetrics.Sample[], maxSamples = 720) => {
  const kept = [...seed];
  app.backend.answer('AppendPanelMetricSample', (_clusterId, _panelId, sample) => {
    const last = kept[kept.length - 1];
    if (last && sample.t <= last.t) {
      return;
    }
    kept.push(sample);
    kept.splice(0, Math.max(0, kept.length - maxSamples));
  });
  app.backend.answer('GetPanelMetricSeries', (_clusterId, _panelId, afterT) => ({
    firstT: kept[0]?.t ?? 0,
    samples: kept.filter((sample) => sample.t > afterT),
  }));
};

// Unreported values are absent on the wire (Go omits nil pointers).
const collected = (t: number, cpu: number): panelmetrics.Sample => ({
  t,
  cpu: { usage: cpu, limit: 500 },
  memory: { usage: 64 },
});

let shown: PanelMetricSeries | null = null;

function SeriesProbe({
  cluster,
  panelId,
  enabled,
}: Readonly<{ cluster: TestCluster; panelId: string; enabled: boolean }>) {
  shown = usePanelMetricSeries(cluster.clusterId, panelId, enabled);
  return null;
}

const shownTimes = () => shown?.samples.map((sample) => sample.t);
const readAfterTimes = () => app.backend.calls('GetPanelMetricSeries').map((call) => call[2]);

describe('panel metric samples', () => {
  const start = async () => {
    shown = null;
    const dev = app.cluster({ name: 'dev', context: 'alpha' });
    app.namespaces(dev, ['podinfo']);
    const panelId = objectPanelId(
      app.object(dev, { group: '', version: 'v1', kind: 'Pod', namespace: 'podinfo', name: 'api' })
        .ref
    );
    const view = await app.render(null);
    const show = (enabled: boolean) =>
      view.show(createElement(SeriesProbe, { cluster: dev, panelId, enabled }));
    const append = async (t: number, cpu: number) => {
      await appendPanelMetricSample(dev.clusterId, panelId, { t, cpu: { usage: cpu } });
      await app.settle();
    };
    return { dev, panelId, show, append };
  };

  it('shows the series the panel collected, then reads only what this window appends', async () => {
    answerPanelBuffer([collected(1_000, 10), collected(6_000, 20)]);
    const { dev, panelId, show, append } = await start();

    await show(true);
    expect(new Set(readAfterTimes())).toEqual(new Set([0]));
    expect(shownTimes()).toEqual([1_000, 6_000]);
    // A value the backend did not report stays absent, never zero.
    expect(shown?.samples[0]?.cpu).toEqual({ usage: 10, limit: 500 });
    const readsBeforeAppend = readAfterTimes().length;

    await append(11_000, 30);

    expect(app.backend.calls('AppendPanelMetricSample')).toEqual([
      [dev.clusterId, panelId, { t: 11_000, cpu: { usage: 30 }, memory: {} }],
    ]);
    expect(readAfterTimes().slice(readsBeforeAppend)).toEqual([6_000]);
    expect(shownTimes()).toEqual([1_000, 6_000, 11_000]);
  });

  it('shows the retained series while auto-refresh is paused but reads no appends', async () => {
    app.preferences({ autoRefreshEnabled: false });
    answerPanelBuffer([collected(1_000, 10), collected(6_000, 20)]);
    const { show, append } = await start();

    // Showing the tab is a foreground read, which the broker allows while paused.
    await show(true);
    expect(shownTimes()).toEqual([1_000, 6_000]);
    const readsBeforeAppend = readAfterTimes().length;

    // The read after an append is passive; the broker turns it away.
    await append(11_000, 30);

    expect(readAfterTimes().slice(readsBeforeAppend)).toEqual([]);
    expect(shownTimes()).toEqual([1_000, 6_000]);
  });

  it('drops samples the backend no longer keeps', async () => {
    answerPanelBuffer([collected(1_000, 10), collected(6_000, 20)], 2);
    const { show, append } = await start();
    await show(true);

    await append(11_000, 30);

    expect(shownTimes()).toEqual([6_000, 11_000]);
  });

  it('reads nothing while hidden and the whole series again when shown', async () => {
    answerPanelBuffer([collected(1_000, 10), collected(6_000, 20)]);
    const { show, append } = await start();

    await show(false);
    expect(readAfterTimes()).toEqual([]);
    expect(shownTimes()).toEqual([]);

    await show(true);
    await show(false);
    const readsWhileShown = readAfterTimes().length;
    await append(11_000, 30);
    expect(readAfterTimes()).toHaveLength(readsWhileShown);

    await show(true);

    expect(new Set(readAfterTimes())).toEqual(new Set([0]));
    expect(shownTimes()).toEqual([1_000, 6_000, 11_000]);
  });
});
