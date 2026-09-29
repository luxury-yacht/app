/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/usePreviousContainerLogs.ts
 *
 * Loads the previous containers' logs into component state. They never touch
 * the live stream's buffer, so returning to live logs shows it unchanged.
 */

import { useEffect, useRef, useState } from 'react';
import { readContainerLogs, requestData } from '@/core/data-access';
import {
  isContainerLogsTargetIssue,
  isContainerLogsWarning,
} from '@/core/refresh/streaming/containerLogsStreamProtocol';
import type {
  ContainerLogsEntry,
  ContainerLogsTargetIssue,
  ContainerLogsWarning,
} from '@/core/refresh/types';
import { getObjPanelLogsBufferMaxSize } from '@/core/settings/appPreferences';

export type BackendLogSelection = {
  selectedFilters: string[];
  matchNone: boolean;
};

export type PreviousContainerLogs = {
  loading: boolean;
  entries: ContainerLogsEntry[];
  warnings: ContainerLogsWarning[];
  issues: ContainerLogsTargetIssue[];
  error: string | null;
};

const EMPTY: PreviousContainerLogs = {
  loading: false,
  entries: [],
  warnings: [],
  issues: [],
  error: null,
};

// The fetch response is typed by the Wails bindings; keep only values that
// match the shared container-logs contract.
const contractValues = <T>(values: unknown, isValid: (value: unknown) => value is T): T[] =>
  Array.isArray(values) ? values.filter(isValid) : [];

type FetchResult = Omit<PreviousContainerLogs, 'loading'> | null;

const fetchPreviousLogs = async (
  clusterId: string,
  scope: string,
  selection: BackendLogSelection,
  nextSeq: () => number
): Promise<FetchResult> => {
  try {
    const result = await requestData({
      resource: 'container-logs-previous',
      reason: 'user',
      adapter: 'rpc-read',
      label: 'Previous Container Logs',
      scope,
      read: () =>
        readContainerLogs(clusterId, {
          scope,
          selectedFilters: selection.selectedFilters,
          matchNone: selection.matchNone,
          previous: true,
          tailLines: getObjPanelLogsBufferMaxSize(),
        }),
    });
    if (result.status === 'blocked') {
      return null;
    }
    const data = result.data;
    return {
      entries: (data?.entries ?? []).map((entry) => ({
        timestamp: entry.timestamp ?? '',
        pod: entry.pod ?? '',
        container: entry.container ?? '',
        line: entry.line ?? '',
        isInit: Boolean(entry.isInit),
        isEphemeral: Boolean(entry.isEphemeral),
        _seq: nextSeq(),
      })),
      warnings: contractValues(data?.warnings, isContainerLogsWarning),
      issues: contractValues(data?.issues, isContainerLogsTargetIssue),
      error: data?.error || null,
    };
  } catch (error) {
    return {
      ...EMPTY,
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export function usePreviousContainerLogs({
  enabled,
  clusterId,
  scope,
  selection,
}: {
  enabled: boolean;
  clusterId: string;
  scope: string | null;
  selection: BackendLogSelection;
}): PreviousContainerLogs {
  const [state, setState] = useState<PreviousContainerLogs>(EMPTY);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!enabled || !scope) {
      setState(EMPTY);
      return;
    }
    let cancelled = false;
    // Earlier lines stay visible while a new selection loads.
    setState((previous) => ({ ...previous, loading: true }));
    void fetchPreviousLogs(clusterId, scope, selection, () => ++seqRef.current).then((result) => {
      if (cancelled) {
        return;
      }
      setState((previous) =>
        result ? { ...result, loading: false } : { ...previous, loading: false }
      );
    });
    return () => {
      cancelled = true;
    };
  }, [clusterId, enabled, scope, selection]);

  return state;
}
