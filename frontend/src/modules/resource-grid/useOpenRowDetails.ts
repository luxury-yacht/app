import type { ClusterObjectReference } from '@shared/utils/objectIdentity';
import { useCallback, useEffect, useMemo, useState } from 'react';

type OpenRefs = ReadonlyMap<string, ClusterObjectReference>;

const NO_OPEN_REFS: OpenRefs = new Map();

// `refs` without the ones `keep` rejects; the same map when it keeps them all.
const retainRefs = (refs: OpenRefs, keep: (ref: ClusterObjectReference) => boolean): OpenRefs => {
  const kept = new Map([...refs].filter(([, ref]) => keep(ref)));
  return kept.size === refs.size ? refs : kept;
};

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
 * than the row data and a row refresh never rebuilds it. With `inScope`, open
 * rows outside the current scope never show and are dropped.
 */
export function useOpenRowDetails({
  keyOf,
  inScope,
}: {
  keyOf: (ref: ClusterObjectReference) => string;
  inScope?: (ref: ClusterObjectReference) => boolean;
}): OpenRowDetails {
  const [open, setOpen] = useState(NO_OPEN_REFS);
  const scoped = useMemo(() => (inScope ? retainRefs(open, inScope) : open), [inScope, open]);
  useEffect(() => {
    if (inScope && scoped !== open) {
      setOpen((current) => retainRefs(current, inScope));
    }
  }, [inScope, open, scoped]);

  const toggle = useCallback(
    (ref: ClusterObjectReference) => {
      const rowKey = keyOf(ref);
      setOpen((current) => {
        const next = new Map(current);
        if (!next.delete(rowKey)) {
          next.set(rowKey, ref);
        }
        return next;
      });
    },
    [keyOf]
  );
  const closeKeys = useCallback((rowKeys: readonly string[]) => {
    setOpen((current) => {
      if (!rowKeys.some((rowKey) => current.has(rowKey))) {
        return current;
      }
      const next = new Map(current);
      for (const rowKey of rowKeys) {
        next.delete(rowKey);
      }
      return next;
    });
  }, []);
  const close = useCallback(
    (ref: ClusterObjectReference) => closeKeys([keyOf(ref)]),
    [closeKeys, keyOf]
  );
  const openKeys = useMemo(() => Array.from(scoped.keys()), [scoped]);

  return { openRefs: scoped, openKeys, toggle, close, closeKeys };
}
