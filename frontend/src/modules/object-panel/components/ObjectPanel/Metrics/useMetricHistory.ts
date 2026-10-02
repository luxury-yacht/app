/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Metrics/useMetricHistory.ts
 *
 * Reads one object's metrics history while its Metrics tab is visible in an open panel, and
 * re-queries through a registered per-panel refresher (docs/plans/metrics-history.md). The last
 * response stays on screen while a new range loads; answers to superseded requests are dropped.
 */

import type { backend } from '@core/backend-api/models';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DataRequestReason, ObjectReadTarget } from '@/core/data-access';
import { refreshManager } from '@/core/refresh';
import { useRefreshWatcher } from '@/core/refresh/hooks/useRefreshWatcher';
import type { ObjectMetricsRefresherName } from '@/core/refresh/refresherTypes';
import { loadObjectMetricHistory } from './metricHistoryApi';
import { refreshIntervalMs } from './metricHistoryModel';

interface UseMetricHistoryArgs {
  target: ObjectReadTarget;
  spanMs: number;
  isActive: boolean;
  refresherName: ObjectMetricsRefresherName | null;
}

interface MetricHistoryState {
  response: backend.MetricHistoryResponse | null;
  /** A failed command (not a failing source, which is a response state). */
  error: unknown;
}

export function useMetricHistory({
  target,
  spanMs,
  isActive,
  refresherName,
}: UseMetricHistoryArgs): MetricHistoryState {
  const [state, setState] = useState<MetricHistoryState>({ response: null, error: null });
  const latestRequest = useRef(0);
  const shownSpan = useRef<number | null>(null);

  const load = useCallback(
    async (reason: DataRequestReason) => {
      const request = ++latestRequest.current;
      try {
        const result = await loadObjectMetricHistory(target, spanMs, reason);
        if (request === latestRequest.current && result.status === 'executed') {
          setState({ response: result.data, error: null });
        }
      } catch (error) {
        if (request === latestRequest.current) {
          setState((previous) => ({ ...previous, error }));
        }
      }
    },
    [target, spanMs]
  );

  // Showing the tab is a foreground read; picking another range is the user's.
  useEffect(() => {
    if (!isActive) {
      return;
    }
    const rangeChanged = shownSpan.current !== null && shownSpan.current !== spanMs;
    shownSpan.current = spanMs;
    void load(rangeChanged ? 'user' : 'foreground');
  }, [isActive, load, spanMs]);

  const interval = refreshIntervalMs(state.response?.grid);
  useEffect(() => {
    if (!isActive || !refresherName) {
      return;
    }
    refreshManager.register({ name: refresherName, interval, cooldown: 1000, timeout: 30 });
    return () => {
      refreshManager.unregister(refresherName);
    };
  }, [interval, isActive, refresherName]);

  useRefreshWatcher({
    refresherName,
    onRefresh: useCallback(
      async (isManual: boolean) => {
        await load(isManual ? 'user' : 'background');
      },
      [load]
    ),
    enabled: isActive && Boolean(refresherName),
  });

  return state;
}
