/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/panelMetricSamples.test.ts
 */

import { afterEach, describe, expect, it } from 'vitest';
import {
  clearPanelMetricSamples,
  exportPanelMetricSamples,
  getPanelMetricSamples,
  importPanelMetricSamples,
  recordPanelMetricSample,
  startPanelMetricCollection,
  stopPanelMetricCollection,
} from './panelMetricSamples';

const PANEL_ID = 'obj:dev:dev-cluster:apps/v1:Deployment:podinfo:podinfo';

const times = () => getPanelMetricSamples(PANEL_ID)?.samples.map((sample) => sample.t);

describe('panelMetricSamples', () => {
  afterEach(() => clearPanelMetricSamples(PANEL_ID));

  it('forgets a closed panel; a late cleanup from its collector does not bring it back', () => {
    startPanelMetricCollection(PANEL_ID, 1_000);
    recordPanelMetricSample(PANEL_ID, { t: 1_000, cpu: { usage: 10 } });

    // Closing evicts before React runs the unmounting collector's cleanup.
    clearPanelMetricSamples(PANEL_ID);
    stopPanelMetricCollection(PANEL_ID);
    recordPanelMetricSample(PANEL_ID, { t: 2_000, cpu: { usage: 20 } });

    expect(getPanelMetricSamples(PANEL_ID)).toBeUndefined();
  });

  it('hands the samples to another window, which continues them after a gap', () => {
    startPanelMetricCollection(PANEL_ID, 1_000);
    recordPanelMetricSample(PANEL_ID, { t: 1_000, cpu: { usage: 10 } });
    recordPanelMetricSample(PANEL_ID, { t: 6_000, cpu: { usage: 20 } });
    const handoff = exportPanelMetricSamples(PANEL_ID);
    clearPanelMetricSamples(PANEL_ID);

    // The destination window imports them, then its own collector starts.
    importPanelMetricSamples(PANEL_ID, handoff);
    startPanelMetricCollection(PANEL_ID, 9_000);
    recordPanelMetricSample(PANEL_ID, { t: 11_000, cpu: { usage: 30 } });

    expect(times()).toEqual([1_000, 6_000, 11_000]);
    expect(getPanelMetricSamples(PANEL_ID)?.startedAt).toBe(1_000);
    expect(getPanelMetricSamples(PANEL_ID)?.samples[2].afterGap).toBe(true);
  });

  it('puts handed-over samples before ones the destination already collected', () => {
    startPanelMetricCollection(PANEL_ID, 1_000);
    recordPanelMetricSample(PANEL_ID, { t: 1_000, cpu: { usage: 10 } });
    const handoff = exportPanelMetricSamples(PANEL_ID);
    clearPanelMetricSamples(PANEL_ID);

    // The destination's collector got there first.
    startPanelMetricCollection(PANEL_ID, 9_000);
    recordPanelMetricSample(PANEL_ID, { t: 10_000, cpu: { usage: 30 } });
    importPanelMetricSamples(PANEL_ID, handoff);

    expect(times()).toEqual([1_000, 10_000]);
    expect(getPanelMetricSamples(PANEL_ID)?.startedAt).toBe(1_000);
    expect(getPanelMetricSamples(PANEL_ID)?.samples[1].afterGap).toBe(true);
  });

  it('has nothing to hand over for a panel that never collected', () => {
    expect(exportPanelMetricSamples(PANEL_ID)).toBeNull();
    importPanelMetricSamples(PANEL_ID, null);
    expect(getPanelMetricSamples(PANEL_ID)).toBeUndefined();
  });
});
