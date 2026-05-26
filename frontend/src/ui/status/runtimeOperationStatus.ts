import { useEffect, useMemo, useReducer } from 'react';
import {
  readPortForwardSessions,
  readRuntimeOperations,
  readShellSessions,
  requestAppState,
} from '@/core/app-state-access';
import {
  initialRuntimeOperationStatusState,
  runtimeOperationStatusReducer,
  selectRuntimeOperationRows,
  type PortForwardSession,
  type PortForwardStatusEvent,
  type RuntimeOperation,
  type ShellSessionInfo,
} from './runtimeOperationStatusAdapter';

export {
  type PortForwardSession,
  type PortForwardStatusEvent,
  type RuntimeOperation,
  type RuntimeOperationStatusState,
  type ShellSessionInfo,
} from './runtimeOperationStatusAdapter';

export function useRuntimeOperationStatus(selectedClusterId?: string | null) {
  const [state, dispatch] = useReducer(
    runtimeOperationStatusReducer,
    initialRuntimeOperationStatusState
  );

  useEffect(() => {
    const load = async () => {
      try {
        const operations = await requestAppState({
          resource: 'runtime-operations',
          adapter: 'runtime-read',
          read: () => readRuntimeOperations(),
        });
        dispatch({ type: 'runtime-operations:list', operations: operations || [] });
      } catch {
        // Runtime events will repopulate the list if the initial read fails.
      }
      try {
        const shellList = await requestAppState({
          resource: 'shell-sessions',
          adapter: 'runtime-read',
          read: () => readShellSessions(),
        });
        dispatch({ type: 'object-shell:list', sessions: shellList || [] });
      } catch {
        // Runtime events will repopulate the list if the initial read fails.
      }
      try {
        const portForwardList = await requestAppState({
          resource: 'port-forward-sessions',
          adapter: 'runtime-read',
          read: () => readPortForwardSessions(),
        });
        dispatch({ type: 'portforward:list', sessions: portForwardList || [] });
      } catch {
        // Runtime events will repopulate the list if the initial read fails.
      }
    };
    void load();
  }, []);

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
        sessions: (args[0] as PortForwardSession[]) || [],
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
      const event = args[0] as PortForwardStatusEvent | undefined;
      if (!event?.sessionId) return;
      dispatch({ type: 'portforward:status', event });
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
