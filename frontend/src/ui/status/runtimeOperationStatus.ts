/**
 * frontend/src/ui/status/runtimeOperationStatus.ts
 *
 * React hook for consuming shared runtime-operation rows and backend events.
 */

import { useEffect, useMemo, useReducer } from 'react';
import {
  readPortForwardSessions,
  readRuntimeOperations,
  readShellSessions,
  requestAppState,
} from '@/core/app-state-access';
import { onEvent } from '@/core/desktop-runtime';
import {
  initialRuntimeOperationStatusState,
  normalizePortForwardSession,
  normalizePortForwardStatusEvent,
  runtimeOperationStatusReducer,
  selectRuntimeOperationRows,
} from './runtimeOperationStatusAdapter';

export type { ShellSessionInfo } from './runtimeOperationStatusAdapter';

type RuntimeOperationStatusReadResource =
  | 'runtime-operations'
  | 'shell-sessions'
  | 'port-forward-sessions';

export interface RuntimeOperationStatusOptions {
  readInitialState?: boolean;
  onInitialReadError?: (error: unknown, resource: RuntimeOperationStatusReadResource) => void;
}

export function useRuntimeOperationStatus(
  selectedClusterId?: string | null,
  options?: RuntimeOperationStatusOptions
) {
  const [state, dispatch] = useReducer(
    runtimeOperationStatusReducer,
    initialRuntimeOperationStatusState
  );
  const readInitialState = options?.readInitialState ?? true;
  const onInitialReadError = options?.onInitialReadError;

  useEffect(() => {
    if (!readInitialState) {
      return;
    }
    let cancelled = false;
    const readInitialList = async <T>(
      resource: RuntimeOperationStatusReadResource,
      read: () => Promise<T>,
      receive: (value: T) => void
    ): Promise<'cancelled' | 'settled'> => {
      try {
        const value = await requestAppState({ resource, adapter: 'runtime-read', read });
        if (cancelled) {
          return 'cancelled';
        }
        receive(value);
      } catch (error) {
        onInitialReadError?.(error, resource);
        // Runtime events will repopulate the list if the initial read fails.
      }
      return 'settled';
    };
    const load = async () => {
      const operationsRead = await readInitialList(
        'runtime-operations',
        readRuntimeOperations,
        (rows) => dispatch({ type: 'runtime-operations:list', operations: rows || [] })
      );
      if (operationsRead === 'cancelled') {
        return;
      }
      const shellsRead = await readInitialList('shell-sessions', readShellSessions, (rows) =>
        dispatch({ type: 'object-shell:list', sessions: rows || [] })
      );
      if (shellsRead === 'cancelled') {
        return;
      }
      await readInitialList('port-forward-sessions', readPortForwardSessions, (rows) =>
        dispatch({
          type: 'portforward:list',
          sessions: (rows || []).map(normalizePortForwardSession),
        })
      );
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [onInitialReadError, readInitialState]);

  useEffect(() => {
    const cancelShellList = onEvent('object-shell:list', (sessions) =>
      dispatch({ type: 'object-shell:list', sessions: sessions ?? [] })
    );

    const cancelPortForwardList = onEvent('portforward:list', (sessions) =>
      dispatch({
        type: 'portforward:list',
        sessions: (sessions ?? []).map(normalizePortForwardSession),
      })
    );

    const cancelRuntimeOperationsList = onEvent('runtime-operations:list', (operations) =>
      dispatch({
        type: 'runtime-operations:list',
        operations: operations ?? [],
      })
    );

    const cancelPortForwardStatus = onEvent('portforward:status', (raw) => {
      if (!raw?.sessionId) {
        return;
      }
      dispatch({ type: 'portforward:status', event: normalizePortForwardStatusEvent(raw) });
    });

    return () => {
      cancelShellList();
      cancelPortForwardList();
      cancelRuntimeOperationsList();
      cancelPortForwardStatus();
    };
  }, []);

  return useMemo(
    () => selectRuntimeOperationRows(state, selectedClusterId),
    [selectedClusterId, state]
  );
}
