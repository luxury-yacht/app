import { useCallback, useEffect, useMemo, useRef } from 'react';

// Utility to sample frame durations over a window using rAF; used by the
// GridTable profiler to log/alert when scrolling performance dips.

type StopReason = 'timeout' | 'manual' | 'unmount';

interface FrameSamplerOptions {
  enabled: boolean;
  sampleLabel?: string;
  sampleWindowMs?: number;
  minSampleCount?: number;
  logResults?: (rows: Array<Record<string, unknown>>) => void;
  requestAnimationFrameImpl?: (cb: FrameRequestCallback) => number;
  cancelAnimationFrameImpl?: (handle: number) => void;
  setTimeoutImpl?: (cb: () => void, ms: number) => number;
  clearTimeoutImpl?: (handle: number) => void;
}

interface FrameSamplerApi {
  start: () => void;
  stop: (reason?: StopReason) => void;
}

export function useFrameSampler({
  enabled,
  sampleLabel = 'FrameSampler',
  sampleWindowMs = 2000,
  minSampleCount = 10,
  logResults,
  requestAnimationFrameImpl,
  cancelAnimationFrameImpl,
  setTimeoutImpl,
  clearTimeoutImpl,
}: FrameSamplerOptions): FrameSamplerApi {
  const defaultLogResults = useMemo(() => {
    if (logResults) {
      return logResults;
    }
    if (typeof console !== 'undefined' && typeof console.table === 'function') {
      return console.table.bind(console);
    }
    return () => {};
  }, [logResults]);

  const requestAnimationFrameFn = useMemo(() => {
    if (requestAnimationFrameImpl) {
      return requestAnimationFrameImpl;
    }
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      return window.requestAnimationFrame.bind(window);
    }
    return null;
  }, [requestAnimationFrameImpl]);

  const cancelAnimationFrameFn = useMemo(() => {
    if (cancelAnimationFrameImpl) {
      return cancelAnimationFrameImpl;
    }
    if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
      return window.cancelAnimationFrame.bind(window);
    }
    return null;
  }, [cancelAnimationFrameImpl]);

  const setTimeoutFn = useMemo(() => {
    if (setTimeoutImpl) {
      return setTimeoutImpl;
    }
    if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
      return window.setTimeout.bind(window);
    }
    return null;
  }, [setTimeoutImpl]);

  const clearTimeoutFn = useMemo(() => {
    if (clearTimeoutImpl) {
      return clearTimeoutImpl;
    }
    if (typeof window !== 'undefined' && typeof window.clearTimeout === 'function') {
      return window.clearTimeout.bind(window);
    }
    return null;
  }, [clearTimeoutImpl]);

  const samplerRef = useRef<{
    running: boolean;
    rafId: number | null;
    timeoutId: number | null;
    lastTimestamp: number | null;
    deltas: number[];
  }>({
    running: false,
    rafId: null,
    timeoutId: null,
    lastTimestamp: null,
    deltas: [],
  });

  const stop = useCallback(
    (reason: StopReason = 'manual') => {
      if (!enabled) {
        return;
      }
      const sampler = samplerRef.current;
      if (!sampler.running) {
        return;
      }
      sampler.running = false;

      if (sampler.rafId != null && cancelAnimationFrameFn) {
        cancelAnimationFrameFn(sampler.rafId);
      }
      if (sampler.timeoutId != null && clearTimeoutFn) {
        clearTimeoutFn(sampler.timeoutId);
      }

      sampler.rafId = null;
      sampler.timeoutId = null;
      sampler.lastTimestamp = null;

      if (reason === 'timeout' && sampler.deltas.length >= minSampleCount) {
        const deltas = sampler.deltas.slice();
        const total = deltas.reduce((acc, value) => acc + value, 0);
        const average = total / deltas.length;
        const max = Math.max(...deltas);
        const sorted = deltas.slice().sort((a, b) => a - b);
        const p95Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95));
        const p95 = sorted[p95Index];
        const overBudget = deltas.filter((delta) => delta > 16.7).length;
        const estimatedFps = average > 0 ? 1000 / average : 0;

        defaultLogResults([
          {
            sample: sampleLabel,
            frames: deltas.length,
            avgMs: Number(average.toFixed(2)),
            p95Ms: Number(p95.toFixed(2)),
            maxMs: Number(max.toFixed(2)),
            overBudgetFrames: overBudget,
            estFps: Number(estimatedFps.toFixed(1)),
            timestamp: new Date().toISOString(),
          },
        ]);
      }

      sampler.deltas = [];
    },
    [
      cancelAnimationFrameFn,
      clearTimeoutFn,
      defaultLogResults,
      enabled,
      minSampleCount,
      sampleLabel,
    ]
  );

  const start = useCallback(() => {
    if (!enabled || !requestAnimationFrameFn || !setTimeoutFn) {
      return;
    }
    const sampler = samplerRef.current;
    if (sampler.running) {
      return;
    }

    sampler.running = true;
    sampler.deltas = [];
    sampler.lastTimestamp = null;

    const tick = (timestamp: number) => {
      const current = samplerRef.current;
      if (!current.running) {
        return;
      }
      if (current.lastTimestamp != null) {
        current.deltas.push(timestamp - current.lastTimestamp);
      }
      current.lastTimestamp = timestamp;
      current.rafId = requestAnimationFrameFn(tick);
    };

    sampler.rafId = requestAnimationFrameFn(tick);
    sampler.timeoutId = setTimeoutFn(() => stop('timeout'), sampleWindowMs);
  }, [enabled, requestAnimationFrameFn, setTimeoutFn, sampleWindowMs, stop]);

  useEffect(() => {
    return () => {
      stop('unmount');
    };
  }, [stop]);

  return { start, stop };
}
