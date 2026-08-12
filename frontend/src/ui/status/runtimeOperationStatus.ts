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
  type RawPortForwardSession,
  type RawPortForwardStatusEvent,
  type RuntimeOperation,
  runtimeOperationStatusReducer,
  type ShellSessionInfo,
  selectRuntimeOperationRows,
} from './runtimeOperationStatusAdapter';

export type {
  PortForwardSession,
  PortForwardStatus,
  ShellSessionInfo,
} from './runtimeOperationStatusAdapter';

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
    const load = async () => {
      try {
        const operations = await requestAppState({
          resource: 'runtime-operations',
          adapter: 'runtime-read',
          read: () => readRuntimeOperations(),
        });
        if (cancelled) {
          return;
        }
        dispatch({ type: 'runtime-operations:list', operations: operations || [] });
      } catch (error) {
        onInitialReadError?.(error, 'runtime-operations');
        // Runtime events will repopulate the list if the initial read fails.
      }
      try {
        const shellList = await requestAppState({
          resource: 'shell-sessions',
          adapter: 'runtime-read',
          read: () => readShellSessions(),
        });
        if (cancelled) {
          return;
        }
        dispatch({ type: 'object-shell:list', sessions: shellList || [] });
      } catch (error) {
        onInitialReadError?.(error, 'shell-sessions');
        // Runtime events will repopulate the list if the initial read fails.
      }
      try {
        const portForwardList = await requestAppState({
          resource: 'port-forward-sessions',
          adapter: 'runtime-read',
          read: () => readPortForwardSessions(),
        });
        if (cancelled) {
          return;
        }
        dispatch({
          type: 'portforward:list',
          sessions: (portForwardList || []).map(normalizePortForwardSession),
        });
      } catch (error) {
        onInitialReadError?.(error, 'port-forward-sessions');
        // Runtime events will repopulate the list if the initial read fails.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [onInitialReadError, readInitialState]);

  useEffect(() => {
    const cancelShellList = onEvent('object-shell:list', (sessions?: ShellSessionInfo[]) =>
      dispatch({ type: 'object-shell:list', sessions: sessions || [] })
    );

    const cancelPortForwardList = onEvent(
      'portforward:list',
      (sessions?: RawPortForwardSession[]) =>
        dispatch({
          type: 'portforward:list',
          sessions: (sessions || []).map(normalizePortForwardSession),
        })
    );

    const cancelRuntimeOperationsList = onEvent(
      'runtime-operations:list',
      (operations?: RuntimeOperation[]) =>
        dispatch({
          type: 'runtime-operations:list',
          operations: operations || [],
        })
    );

    const cancelPortForwardStatus = onEvent(
      'portforward:status',
      (raw?: RawPortForwardStatusEvent) => {
        if (!raw?.sessionId) {
          return;
        }
        dispatch({ type: 'portforward:status', event: normalizePortForwardStatusEvent(raw) });
      }
    );

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
