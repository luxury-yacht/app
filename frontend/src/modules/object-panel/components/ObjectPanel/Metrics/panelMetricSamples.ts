/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/panelMetricSamples.ts
 *
 * Live metric samples per object panel, kept from when the panel opens until it closes
 * (docs/architecture/resource-metrics.md, "Object panel Metrics tab").
 *
 * Module-level, like logViewerPrefsCache: the panel's collector runs whatever tab is shown, and
 * the samples must survive the panel's unmount/remount on a cluster switch. Eviction is driven
 * from ObjectPanelStateContext once this renderer no longer owns the panel; a move to another
 * window hands the samples over with exportPanelMetricSamples / importPanelMetricSamples.
 */

import { useCallback, useSyncExternalStore } from 'react';
import type { LiveMetricSample } from './metricsTabModel';

const KEEP_MS = 60 * 60_000;
// Starting collection paints the scope's retained data before the first new collection. A value
// older than this at the start of a run predates the run; charting it would draw a stale point.
const START_GRACE_MS = 30_000;

export interface PanelMetricSamples {
  /** When this panel started collecting. */
  startedAt: number;
  samples: readonly LiveMetricSample[];
  /** Why live metrics have nothing to show, when they report a reason. */
  error: string | null;
}

/** What a panel carries to another window. */
export interface PanelMetricHandoff {
  startedAt: number;
  samples: LiveMetricSample[];
}

interface Entry extends PanelMetricSamples {
  /** When the current run of collection started, or null while stopped. */
  runStartedAt: number | null;
  /** The next sample follows a stop, so the chart breaks before it. */
  gapPending: boolean;
}

const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

const publish = (panelId: string, entry: Entry | undefined): void => {
  if (entry) {
    entries.set(panelId, entry);
  } else {
    entries.delete(panelId);
  }
  listeners.get(panelId)?.forEach((listener) => listener());
};

export const getPanelMetricSamples = (panelId: string): PanelMetricSamples | undefined =>
  entries.get(panelId);

/** Starts (or resumes) collection; the only call that creates a panel's entry. */
export const startPanelMetricCollection = (panelId: string, now: number): void => {
  const entry = entries.get(panelId);
  publish(
    panelId,
    entry
      ? { ...entry, runStartedAt: now }
      : { startedAt: now, samples: [], error: null, runStartedAt: now, gapPending: false }
  );
};

/** Pauses collection and keeps the samples; the next one starts after a gap. */
export const stopPanelMetricCollection = (panelId: string): void => {
  // A closed panel was evicted before its collector's cleanup ran; do not recreate it.
  const entry = entries.get(panelId);
  if (entry) {
    publish(panelId, { ...entry, runStartedAt: null, gapPending: entry.samples.length > 0 });
  }
};

export const recordPanelMetricSample = (panelId: string, sample: LiveMetricSample): void => {
  const entry = entries.get(panelId);
  const last = entry?.samples[entry.samples.length - 1];
  if (
    !entry ||
    entry.runStartedAt === null ||
    sample.t < entry.runStartedAt - START_GRACE_MS ||
    (last && sample.t <= last.t)
  ) {
    return;
  }
  const next = entry.gapPending ? { ...sample, afterGap: true } : sample;
  const kept = entry.samples.filter((existing) => existing.t >= sample.t - KEEP_MS);
  publish(panelId, { ...entry, samples: [...kept, next], gapPending: false });
};

export const setPanelMetricError = (panelId: string, error: string | null): void => {
  const entry = entries.get(panelId);
  if (entry && entry.error !== error) {
    publish(panelId, { ...entry, error });
  }
};

/** Forgets a panel this renderer no longer owns (closed, or handed to another window). */
export const clearPanelMetricSamples = (panelId: string): void => {
  if (entries.has(panelId)) {
    publish(panelId, undefined);
  }
};

export const exportPanelMetricSamples = (panelId: string): PanelMetricHandoff | null => {
  const entry = entries.get(panelId);
  return entry && entry.samples.length > 0
    ? { startedAt: entry.startedAt, samples: [...entry.samples] }
    : null;
};

/**
 * Takes over samples handed from another window. They predate anything collected here, so
 * they go first, and the first sample collected here starts after a gap.
 */
export const importPanelMetricSamples = (
  panelId: string,
  handoff: PanelMetricHandoff | null | undefined
): void => {
  if (!handoff || handoff.samples.length === 0) {
    return;
  }
  const entry = entries.get(panelId);
  const handedLast = handoff.samples[handoff.samples.length - 1].t;
  const local = (entry?.samples ?? []).filter((sample) => sample.t > handedLast);
  const [firstLocal, ...restLocal] = local;
  publish(panelId, {
    startedAt: Math.min(handoff.startedAt, entry?.startedAt ?? handoff.startedAt),
    samples: [...handoff.samples, ...(firstLocal ? [{ ...firstLocal, afterGap: true }] : []), ...restLocal],
    error: entry?.error ?? null,
    runStartedAt: entry?.runStartedAt ?? null,
    gapPending: !firstLocal,
  });
};

/** The panel's samples, re-rendering when they change. */
export const usePanelMetricSamples = (panelId: string): PanelMetricSamples | undefined => {
  const subscribe = useCallback(
    (listener: () => void) => {
      const panelListeners = listeners.get(panelId) ?? new Set<() => void>();
      panelListeners.add(listener);
      listeners.set(panelId, panelListeners);
      return () => {
        panelListeners.delete(listener);
        if (panelListeners.size === 0) {
          listeners.delete(panelId);
        }
      };
    },
    [panelId]
  );
  return useSyncExternalStore(subscribe, () => entries.get(panelId));
};
