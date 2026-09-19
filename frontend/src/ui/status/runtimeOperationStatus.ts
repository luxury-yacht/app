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
  type PortForwardStatusEvent,
  type RuntimeOperationStatusAction,
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
    let cancelled = false;
    const receivedLists = new Set<RuntimeOperationStatusReadResource>();
    let awaitingPortForwardList = readInitialState;
    const pendingStatuses: PortForwardStatusEvent[] = [];
    const receiveList = (
      resource: RuntimeOperationStatusReadResource,
      action: RuntimeOperationStatusAction
    ) => {
      receivedLists.add(resource);
      dispatch(action);
    };

    // Subscribe before taking snapshots. Full event lists supersede bootstrap
    // reads; status-only events wait for the details needed to identify a row.
    const unsubscribers = [
      onEvent('runtime-operations:list', (operations) =>
        receiveList('runtime-operations', {
          type: 'runtime-operations:list',
          operations: operations ?? [],
        })
      ),
      onEvent('object-shell:list', (sessions) =>
        receiveList('shell-sessions', { type: 'object-shell:list', sessions: sessions ?? [] })
      ),
      onEvent('portforward:list', (sessions) => {
        awaitingPortForwardList = false;
        pendingStatuses.length = 0;
        receiveList('port-forward-sessions', {
          type: 'portforward:list',
          sessions: (sessions ?? []).map(normalizePortForwardSession),
        });
      }),
      onEvent('portforward:status', (raw) => {
        if (!raw?.sessionId) {
          return;
        }
        const event = normalizePortForwardStatusEvent(raw);
        if (awaitingPortForwardList) {
          pendingStatuses.push(event);
        }
        dispatch({ type: 'portforward:status', event });
      }),
    ];

    const readInitialList = async <T>(
      resource: RuntimeOperationStatusReadResource,
      read: () => Promise<T>,
      receive: (value: T) => void
    ): Promise<boolean> => {
      try {
        const value = await requestAppState({ resource, adapter: 'runtime-read', read });
        if (!cancelled && !receivedLists.has(resource)) {
          receive(value);
        }
      } catch (error) {
        if (!cancelled) {
          onInitialReadError?.(error, resource);
        }
        // Runtime events can repopulate a list after its initial read fails.
      }
      return !cancelled;
    };
    const load = async () => {
      if (
        !(await readInitialList('runtime-operations', readRuntimeOperations, (rows) =>
          dispatch({ type: 'runtime-operations:list', operations: rows || [] })
        ))
      ) {
        return;
      }
      if (
        !(await readInitialList('shell-sessions', readShellSessions, (rows) =>
          dispatch({ type: 'object-shell:list', sessions: rows || [] })
        ))
      ) {
        return;
      }
      await readInitialList('port-forward-sessions', readPortForwardSessions, (rows) => {
        dispatch({
          type: 'portforward:list',
          sessions: (rows || []).map(normalizePortForwardSession),
        });
        for (const event of pendingStatuses) {
          dispatch({ type: 'portforward:status', event });
        }
      });
      awaitingPortForwardList = false;
      pendingStatuses.length = 0;
    };
    if (readInitialState) {
      void load();
    }
    return () => {
      cancelled = true;
      pendingStatuses.length = 0;
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
    };
  }, [onInitialReadError, readInitialState]);

  return useMemo(
    () => selectRuntimeOperationRows(state, selectedClusterId),
    [selectedClusterId, state]
  );
}
