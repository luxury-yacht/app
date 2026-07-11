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
  PortForwardStatusEvent,
  RuntimeOperation,
  RuntimeOperationStatusState,
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
    const runtime = window.runtime;
    if (!runtime?.EventsOn) {
      return;
    }

    const cancelShellList = runtime.EventsOn('object-shell:list', (...args: unknown[]) =>
      dispatch({ type: 'object-shell:list', sessions: (args[0] as ShellSessionInfo[]) || [] })
    ) as unknown as (() => void) | undefined;

    const cancelPortForwardList = runtime.EventsOn('portforward:list', (...args: unknown[]) =>
      dispatch({
        type: 'portforward:list',
        sessions: ((args[0] as RawPortForwardSession[]) || []).map(normalizePortForwardSession),
      })
    ) as unknown as (() => void) | undefined;

    const cancelRuntimeOperationsList = runtime.EventsOn(
      'runtime-operations:list',
      (...args: unknown[]) =>
        dispatch({
          type: 'runtime-operations:list',
          operations: (args[0] as RuntimeOperation[]) || [],
        })
    ) as unknown as (() => void) | undefined;

    const cancelPortForwardStatus = runtime.EventsOn('portforward:status', (...args: unknown[]) => {
      const raw = args[0] as RawPortForwardStatusEvent | undefined;
      if (!raw?.sessionId) {
        return;
      }
      dispatch({ type: 'portforward:status', event: normalizePortForwardStatusEvent(raw) });
    }) as unknown as (() => void) | undefined;

    return () => {
      cancelShellList?.();
      cancelPortForwardList?.();
      cancelRuntimeOperationsList?.();
      cancelPortForwardStatus?.();
    };
  }, []);

  return useMemo(
    () => selectRuntimeOperationRows(state, selectedClusterId),
    [selectedClusterId, state]
  );
}
