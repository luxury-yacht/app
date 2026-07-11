/**
 * frontend/src/shared/components/tables/hooks/useGridTableProfiler.tsx
 *
 * React hook for useGridTableProfiler.
 * Encapsulates state and side effects for the shared components.
 */

import {
  type FrameSamplerSample,
  useFrameSampler,
} from '@shared/components/tables/hooks/useFrameSampler';
import React, { useCallback, useId, useMemo, useRef } from 'react';

// Optional perf helper for GridTable: wraps content in React Profiler, samples
// frame timings, and surfaces one-time dev warnings when thresholds are hit.

interface GridTableProfilerOptions {
  sampleLabel?: string;
  sampleWindowMs?: number;
  minSampleCount?: number;
  onFrameSample?: (sample: FrameSamplerSample) => void;
  onRenderSample?: (
    phase: 'mount' | 'update' | 'nested-update',
    actualDuration: number,
    baseDuration: number
  ) => void;
}

interface GridTableProfilerApi {
  profilerEnabled: boolean;
  wrapWithProfiler: (content: React.ReactElement) => React.ReactElement;
  warnDevOnce: (message: string) => void;
  startFrameSampler: () => void;
  stopFrameSampler: (reason?: 'timeout' | 'manual' | 'unmount') => void;
}

export function useGridTableProfiler({
  sampleLabel = 'GridTable scroll',
  sampleWindowMs = 2000,
  minSampleCount = 10,
  onFrameSample,
  onRenderSample,
}: GridTableProfilerOptions = {}): GridTableProfilerApi {
  const elementIdPrefix = useId();
  const isJSDOM =
    typeof navigator !== 'undefined' &&
    typeof navigator.userAgent === 'string' &&
    navigator.userAgent.toLowerCase().includes('jsdom');

  const profilerEnabled = import.meta.env.DEV && !isJSDOM;
  const profilerLoggingEnabled = import.meta.env.VITE_GRIDTABLE_PROFILE_LOGS === 'true';

  const warnedMessagesRef = useRef<Set<string>>(new Set());
  const warnDevOnce = useCallback((message: string) => {
    if (process.env.NODE_ENV === 'production') {
      return;
    }
    const set = warnedMessagesRef.current;
    if (!set.has(message)) {
      set.add(message);
      console.warn(message);
    }
  }, []);

  const handleProfilerRender = useCallback(
    (
      id: string,
      phase: 'mount' | 'update' | 'nested-update',
      actualDuration: number,
      baseDuration: number,
      startTime: number,
      commitTime: number
    ) => {
      onRenderSample?.(phase, actualDuration, baseDuration);

      if (!profilerEnabled || !profilerLoggingEnabled) {
        return;
      }

      console.info('GridTable profiler sample', [
        {
          id,
          phase,
          actualDuration,
          baseDuration,
          startTime,
          commitTime,
          timestamp: new Date().toISOString(),
        },
      ]);
    },
    [onRenderSample, profilerEnabled]
  );

  const wrapWithProfiler = useCallback(
    (content: React.ReactElement) =>
      profilerEnabled ? (
        <React.Profiler id={`${elementIdPrefix}-GridTable`} onRender={handleProfilerRender}>
          {content}
        </React.Profiler>
      ) : (
        content
      ),
    [elementIdPrefix, handleProfilerRender, profilerEnabled]
  );

  const { start: startFrameSampler, stop: stopFrameSampler } = useFrameSampler({
    enabled: profilerEnabled,
    sampleLabel,
    sampleWindowMs,
    minSampleCount,
    onSample: onFrameSample,
  });

  return useMemo(
    () => ({
      profilerEnabled,
      wrapWithProfiler,
      warnDevOnce,
      startFrameSampler,
      stopFrameSampler,
    }),
    [profilerEnabled, wrapWithProfiler, warnDevOnce, startFrameSampler, stopFrameSampler]
  );
}
