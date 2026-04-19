import { useSyncExternalStore } from 'react';

export type GridTablePerformanceMetricKind = 'filterOptions' | 'filterPass' | 'sort' | 'render';

export interface GridTableTimingStats {
  samples: number;
  latestMs: number;
  averageMs: number;
  maxMs: number;
}

export interface GridTablePerformanceEntry {
  label: string;
  updates: number;
  inputReferenceChanges: number;
  inputRows: number;
  sourceRows: number;
  displayedRows: number;
  lastUpdated: number;
  lastRenderPhase: 'mount' | 'update' | 'nested-update' | null;
  filterOptions: GridTableTimingStats;
  filterPass: GridTableTimingStats;
  sort: GridTableTimingStats;
  render: GridTableTimingStats;
}

type Listener = () => void;

type MutableTimingStats = GridTableTimingStats & {
  totalMs: number;
};

type MutableEntry = GridTablePerformanceEntry & {
  filterOptions: MutableTimingStats;
  filterPass: MutableTimingStats;
  sort: MutableTimingStats;
  render: MutableTimingStats;
};

const listeners = new Set<Listener>();
const entries = new Map<string, MutableEntry>();
let snapshotCache: GridTablePerformanceEntry[] = [];
let snapshotDirty = true;

const createTimingStats = (): MutableTimingStats => ({
  samples: 0,
  latestMs: 0,
  averageMs: 0,
  maxMs: 0,
  totalMs: 0,
});

const createEntry = (label: string): MutableEntry => ({
  label,
  updates: 0,
  inputReferenceChanges: 0,
  inputRows: 0,
  sourceRows: 0,
  displayedRows: 0,
  lastUpdated: 0,
  lastRenderPhase: null,
  filterOptions: createTimingStats(),
  filterPass: createTimingStats(),
  sort: createTimingStats(),
  render: createTimingStats(),
});

const getEntry = (label: string): MutableEntry => {
  const existing = entries.get(label);
  if (existing) {
    return existing;
  }
  const created = createEntry(label);
  entries.set(label, created);
  return created;
};

const notify = () => {
  snapshotDirty = true;
  for (const listener of listeners) {
    listener();
  }
};

const updateTimingStats = (stats: MutableTimingStats, durationMs: number) => {
  const normalizedDuration = Number.isFinite(durationMs) ? Math.max(durationMs, 0) : 0;
  stats.samples += 1;
  stats.latestMs = normalizedDuration;
  stats.totalMs += normalizedDuration;
  stats.averageMs = stats.totalMs / stats.samples;
  stats.maxMs = Math.max(stats.maxMs, normalizedDuration);
};

const cloneTimingStats = (stats: MutableTimingStats): GridTableTimingStats => ({
  samples: stats.samples,
  latestMs: Number(stats.latestMs.toFixed(2)),
  averageMs: Number(stats.averageMs.toFixed(2)),
  maxMs: Number(stats.maxMs.toFixed(2)),
});

export const recordGridTablePerformanceSnapshot = (
  label: string,
  snapshot: {
    inputRows: number;
    sourceRows: number;
    displayedRows: number;
    inputReferenceChanged: boolean;
  }
) => {
  if (!label) {
    return;
  }

  const entry = getEntry(label);
  entry.updates += 1;
  if (snapshot.inputReferenceChanged) {
    entry.inputReferenceChanges += 1;
  }
  entry.inputRows = snapshot.inputRows;
  entry.sourceRows = snapshot.sourceRows;
  entry.displayedRows = snapshot.displayedRows;
  entry.lastUpdated = Date.now();
  notify();
};

export const recordGridTablePerformanceSample = (
  label: string,
  kind: GridTablePerformanceMetricKind,
  durationMs: number,
  options?: {
    renderPhase?: 'mount' | 'update' | 'nested-update';
  }
) => {
  if (!label) {
    return;
  }

  const entry = getEntry(label);
  updateTimingStats(entry[kind], durationMs);
  if (kind === 'render') {
    entry.lastRenderPhase = options?.renderPhase ?? null;
  }
  entry.lastUpdated = Date.now();
  notify();
};

export const subscribeGridTablePerformance = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getGridTablePerformanceSnapshot = (): GridTablePerformanceEntry[] => {
  if (!snapshotDirty) {
    return snapshotCache;
  }

  snapshotCache = Array.from(entries.values())
    .map((entry) => ({
      label: entry.label,
      updates: entry.updates,
      inputReferenceChanges: entry.inputReferenceChanges,
      inputRows: entry.inputRows,
      sourceRows: entry.sourceRows,
      displayedRows: entry.displayedRows,
      lastUpdated: entry.lastUpdated,
      lastRenderPhase: entry.lastRenderPhase,
      filterOptions: cloneTimingStats(entry.filterOptions),
      filterPass: cloneTimingStats(entry.filterPass),
      sort: cloneTimingStats(entry.sort),
      render: cloneTimingStats(entry.render),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  snapshotDirty = false;
  return snapshotCache;
};

export const useGridTablePerformanceDiagnostics = (): GridTablePerformanceEntry[] =>
  useSyncExternalStore(
    subscribeGridTablePerformance,
    getGridTablePerformanceSnapshot,
    getGridTablePerformanceSnapshot
  );

export const resetGridTablePerformanceDiagnostics = () => {
  entries.clear();
  snapshotCache = [];
  notify();
};
