/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Logs/hooks/useLogScopeContainers.ts
 *
 * The container list of a Container Logs scope. It is read when the scope
 * opens, and again when the logs hold a container the list lacks: one that
 * started later, such as a debug container or a sidecar a rollout added.
 */

import type { types } from '@core/backend-api/models';
import { type Dispatch, useEffect, useRef, useState } from 'react';
import { readContainerLogsScopeContainers, requestData } from '@/core/data-access';
import { logContainerKind, toContainerFilterValueForKind } from '../containerLogFilters';
import type { LogViewerAction } from '../logViewerReducer';

const requestLogScopeContainers = async (
  clusterId: string,
  scope: string
): Promise<types.PodContainer[]> => {
  const result = await requestData({
    resource: 'log-scope-containers',
    reason: 'startup',
    adapter: 'rpc-read',
    label: 'Log Scope Containers',
    scope,
    read: () => readContainerLogsScopeContainers(clusterId, scope),
  });
  return result.status === 'executed' ? (result.data ?? []) : [];
};

// A container's identity in the list: its name and kind, as the Containers
// dropdown names it.
const containerKey = (container: types.PodContainer): string =>
  toContainerFilterValueForKind(container.name, logContainerKind(container));

/** The distinct containers that a set of log entries came from. */
export const containersOfEntries = (
  entries: readonly { container: string; isInit: boolean; isEphemeral?: boolean }[]
): types.PodContainer[] => {
  const containers = new Map<string, types.PodContainer>();
  for (const entry of entries) {
    const container = {
      name: entry.container,
      isInit: entry.isInit,
      isEphemeral: Boolean(entry.isEphemeral),
    };
    containers.set(containerKey(container), container);
  }
  return Array.from(containers.values());
};

type ScopeRead = {
  scope: string | null;
  // The scope's first read has finished.
  loaded: boolean;
  // Containers the list has been read again for, so each is read for once.
  reread: Set<string>;
};

export const useLogScopeContainers = ({
  clusterId,
  scope,
  isWorkload,
  containers,
  heldContainers,
  dispatch,
}: {
  clusterId: string;
  scope: string | null;
  isWorkload: boolean;
  /** The list as last read. */
  containers: types.PodContainer[];
  /** The containers the shown logs came from. */
  heldContainers: readonly types.PodContainer[];
  dispatch: Dispatch<LogViewerAction>;
}): void => {
  const [rereadCount, setRereadCount] = useState(0);
  const readRef = useRef<ScopeRead>({ scope: null, loaded: false, reread: new Set() });

  useEffect(() => {
    // Keep the inventory recheck on pod/workload transitions and rereads.
    void isWorkload;
    void rereadCount;
    if (!scope) {
      dispatch({ type: 'SET_CONTAINERS', payload: [] });
      return;
    }
    if (readRef.current.scope !== scope) {
      readRef.current = { scope, loaded: false, reread: new Set() };
    }
    const read = readRef.current;

    let isCancelled = false;
    const apply = (list: types.PodContainer[]) => {
      if (isCancelled) {
        return;
      }
      read.loaded = true;
      dispatch({ type: 'SET_CONTAINERS', payload: list });
    };
    void requestLogScopeContainers(clusterId, scope)
      .then(apply)
      .catch((err) => {
        if (!isCancelled) {
          console.warn('Failed to fetch containers:', err);
        }
        apply([]);
      });

    return () => {
      isCancelled = true;
    };
  }, [isWorkload, scope, clusterId, rereadCount, dispatch]);

  // Once the scope's list has been read, a container the logs hold but the list
  // lacks started later: read the list again, once for each such container, so
  // one that never shows up in it (its pod ended, or the read failed) can't loop.
  useEffect(() => {
    const read = readRef.current;
    if (read.scope !== scope || !read.loaded) {
      return;
    }
    const listed = new Set(containers.map(containerKey));
    const missing = heldContainers
      .map(containerKey)
      .filter((key) => !listed.has(key) && !read.reread.has(key));
    if (missing.length === 0) {
      return;
    }
    for (const key of missing) {
      read.reread.add(key);
    }
    setRereadCount((count) => count + 1);
  }, [scope, containers, heldContainers]);
};
