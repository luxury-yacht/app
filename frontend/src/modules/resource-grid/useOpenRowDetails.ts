import type { ClusterObjectReference } from '@shared/utils/objectIdentity';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { eventBus } from '@/core/events';

type OpenRefs = ReadonlyMap<string, ClusterObjectReference>;

const NO_OPEN_REFS: OpenRefs = new Map();

// Each open cluster's open rows by view, so leaving a view and coming back
// shows the same rows open. A cluster's entries live until it closes.
const openRefsByCluster = new Map<string, Map<string, OpenRefs>>();
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const notify = () => {
  listeners.forEach((listener) => {
    listener();
  });
};

const viewKeyOf = (viewId: string, namespace: string | undefined) =>
  namespace ? `${viewId}|${namespace}` : viewId;

const readOpenRefs = (clusterId: string, viewKey: string): OpenRefs =>
  openRefsByCluster.get(clusterId)?.get(viewKey) ?? NO_OPEN_REFS;

const writeOpenRefs = (
  clusterId: string,
  viewKey: string,
  update: (current: OpenRefs) => OpenRefs
): void => {
  const current = readOpenRefs(clusterId, viewKey);
  const next = update(current);
  if (next === current) {
    return;
  }
  const views = openRefsByCluster.get(clusterId) ?? new Map<string, OpenRefs>();
  if (next.size === 0) {
    views.delete(viewKey);
  } else {
    views.set(viewKey, next);
  }
  if (views.size === 0) {
    openRefsByCluster.delete(clusterId);
  } else {
    openRefsByCluster.set(clusterId, views);
  }
  notify();
};

// Open rows die with the cluster: on its close, and all at once when the last
// cluster closes.
eventBus.on('refresh:cluster-pruned', ({ clusterId }) => {
  if (openRefsByCluster.delete(clusterId.trim())) {
    notify();
  }
});
eventBus.on('kubeconfig:changing', () => {
  if (openRefsByCluster.size > 0) {
    openRefsByCluster.clear();
    notify();
  }
});

export interface OpenRowDetails {
  /** Each open row's object by row key, in opening order. */
  openRefs: OpenRefs;
  /** The open rows' keys, for GridTableRowDetail.openRowKeys. */
  openKeys: readonly string[];
  /** Opens a row's detail, or closes it when it is open. */
  toggle: (ref: ClusterObjectReference) => void;
  /** Closes one row's detail, for its attached table's Close. */
  close: (ref: ClusterObjectReference) => void;
  /** Closes these rows' details, for rows that left the table. */
  closeKeys: (rowKeys: readonly string[]) => void;
}

/**
 * The rows of a table whose details are open; any number can be open at once.
 * Each is kept as its object reference, so a detail follows its object rather
 * than the row data and a row refresh never rebuilds it. Open rows are kept
 * per cluster, view, and namespace until the cluster closes, so a view that
 * mounts again shows the rows the user left open.
 */
export function useOpenRowDetails({
  clusterId,
  viewId,
  namespace,
  keyOf,
}: {
  clusterId: string;
  viewId: string;
  namespace?: string;
  keyOf: (ref: ClusterObjectReference) => string;
}): OpenRowDetails {
  const cluster = clusterId.trim();
  const viewKey = viewKeyOf(viewId, namespace);
  const getSnapshot = useCallback(() => readOpenRefs(cluster, viewKey), [cluster, viewKey]);
  const openRefs = useSyncExternalStore(subscribe, getSnapshot);

  const toggle = useCallback(
    (ref: ClusterObjectReference) => {
      const rowKey = keyOf(ref);
      writeOpenRefs(cluster, viewKey, (current) => {
        const next = new Map(current);
        if (!next.delete(rowKey)) {
          next.set(rowKey, ref);
        }
        return next;
      });
    },
    [cluster, keyOf, viewKey]
  );
  const closeKeys = useCallback(
    (rowKeys: readonly string[]) => {
      writeOpenRefs(cluster, viewKey, (current) => {
        if (!rowKeys.some((rowKey) => current.has(rowKey))) {
          return current;
        }
        const next = new Map(current);
        for (const rowKey of rowKeys) {
          next.delete(rowKey);
        }
        return next;
      });
    },
    [cluster, viewKey]
  );
  const close = useCallback(
    (ref: ClusterObjectReference) => closeKeys([keyOf(ref)]),
    [closeKeys, keyOf]
  );
  const openKeys = useMemo(() => Array.from(openRefs.keys()), [openRefs]);

  return { openRefs, openKeys, toggle, close, closeKeys };
}
