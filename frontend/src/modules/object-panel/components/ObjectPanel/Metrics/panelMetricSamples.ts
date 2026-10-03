/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/panelMetricSamples.ts
 *
 * Client for the backend panel metrics buffer (backend/panelmetrics; docs/architecture/
 * resource-metrics.md, "Object panel Metrics tab"). The backend keeps a panel's samples while the
 * panel is open in any window, so its chart survives moves between windows. The window showing a
 * panel appends each collection; the Metrics tab reads the series and keeps only what it shows.
 */

import { useEffect, useState } from 'react';
import { AppendPanelMetricSample } from '@/core/backend-api';
import type { panelmetrics } from '@/core/backend-api/models';
import { readPanelMetricSeries, requestData } from '@/core/data-access';
import type { ResourceMetricValues } from '@/core/resource-metrics';
import { reportOperationalError } from '@/utils/errorHandler';
import type { LiveMetricSample } from './metricsTabModel';

export interface PanelMetricSeries {
  samples: readonly LiveMetricSample[];
}

const NO_SERIES: PanelMetricSeries = { samples: [] };

// Per panel: this window just appended, so a shown Metrics tab reads the new sample.
const appendListeners = new Map<string, Set<() => void>>();

const VALUE_KEYS = ['usage', 'request', 'limit', 'capacity', 'allocatable'] as const;

// The wire marks a value that was not reported as null or absent; keep it absent, never zero.
const valuesFromWire = (values: panelmetrics.Values | undefined): ResourceMetricValues => {
  const out: ResourceMetricValues = {};
  for (const key of VALUE_KEYS) {
    const value = values?.[key];
    if (typeof value === 'number') {
      out[key] = value;
    }
  }
  return out;
};

const sampleFromWire = (sample: panelmetrics.Sample): LiveMetricSample => ({
  t: sample.t,
  cpu: valuesFromWire(sample.cpu),
  memory: valuesFromWire(sample.memory),
});

/** Sends one collection to the backend buffer, then lets this window's Metrics tab read it. */
export const appendPanelMetricSample = async (
  clusterId: string,
  panelId: string,
  sample: LiveMetricSample
): Promise<void> => {
  await AppendPanelMetricSample(clusterId, panelId, {
    t: sample.t,
    cpu: sample.cpu ?? {},
    memory: sample.memory ?? {},
  });
  appendListeners.get(panelId)?.forEach((listener) => {
    listener();
  });
};

const subscribeAppends = (panelId: string, listener: () => void): (() => void) => {
  const listeners = appendListeners.get(panelId) ?? new Set<() => void>();
  listeners.add(listener);
  appendListeners.set(panelId, listeners);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      appendListeners.delete(panelId);
    }
  };
};

// A full read replaces the series; a delta appends and drops what the backend no longer keeps.
const mergeSeries = (
  current: PanelMetricSeries,
  response: panelmetrics.Series,
  afterT: number
): PanelMetricSeries => {
  const fresh = (response.samples ?? []).map(sampleFromWire);
  const kept = afterT === 0 ? [] : current.samples.filter((sample) => sample.t >= response.firstT);
  return { samples: [...kept, ...fresh] };
};

interface SeriesReader {
  read: () => void;
  cancel: () => void;
}

// Reads one at a time from the newest sample it has; a request during a read asks for one more.
const createSeriesReader = (
  clusterId: string,
  panelId: string,
  apply: (response: panelmetrics.Series, afterT: number) => void
): SeriesReader => {
  let lastT = 0;
  let reading = false;
  let readAgain = false;
  let cancelled = false;

  const readNewer = async (): Promise<void> => {
    const afterT = lastT;
    const result = await requestData({
      resource: 'panel-metric-series',
      // Showing the tab reads the panel's retained samples, which the broker allows while
      // auto-refresh is paused; the reads after each sample only happen while collecting.
      reason: afterT === 0 ? 'foreground' : 'stream-signal',
      adapter: 'rpc-read',
      label: 'Panel Metric Series',
      scope: `${clusterId}:${panelId}`,
      read: () => readPanelMetricSeries(clusterId, panelId, afterT),
    });
    const response = result.status === 'executed' ? result.data : null;
    if (cancelled || !response) {
      return;
    }
    const samples = response.samples ?? [];
    lastT = samples.length > 0 ? samples[samples.length - 1].t : afterT;
    apply(response, afterT);
  };

  const read = (): void => {
    if (reading) {
      readAgain = true;
      return;
    }
    reading = true;
    readNewer()
      .catch((error) => {
        reportOperationalError(error, { source: 'usePanelMetricSeries', action: 'read', panelId });
      })
      .finally(() => {
        reading = false;
        if (readAgain && !cancelled) {
          readAgain = false;
          read();
        }
      });
  };

  return {
    read,
    cancel: () => {
      cancelled = true;
    },
  };
};

/**
 * The panel's collected samples while enabled (the panel is visible). Showing reads the whole
 * series; after that, each append from this window reads only what is newer.
 */
export function usePanelMetricSeries(
  clusterId: string,
  panelId: string,
  enabled: boolean
): PanelMetricSeries {
  const [series, setSeries] = useState<PanelMetricSeries>(NO_SERIES);

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }
    const reader = createSeriesReader(clusterId, panelId, (response, afterT) => {
      setSeries((current) => mergeSeries(current, response, afterT));
    });
    reader.read();
    const unsubscribe = subscribeAppends(panelId, reader.read);
    return () => {
      reader.cancel();
      unsubscribe();
    };
  }, [clusterId, enabled, panelId]);

  return enabled ? series : NO_SERIES;
}
