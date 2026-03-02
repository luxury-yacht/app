/**
 * frontend/src/shared/components/tables/hooks/useGridTableExternalFocus.ts
 *
 * Subscribes to `gridtable:focus-request` events and focuses the matching
 * row in the current GridTable instance. Uses convention-based matching on
 * standard Kubernetes resource fields (name, namespace, kind, clusterId)
 * rather than constructing exact row keys.
 *
 * Uses a module-level buffer for pending requests so they survive across
 * view switches (component unmount → mount cycles). When a navigation
 * triggers a view change, the old GridTable unmounts before the new one
 * mounts — the module-level buffer ensures the request isn't lost.
 */

import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import { eventBus } from '@/core/events';

interface FocusRequest {
  kind: string;
  name: string;
  namespace?: string;
  clusterId: string;
}

interface UseGridTableExternalFocusOptions<T> {
  tableData: T[];
  keyExtractor: (item: T, index: number) => string;
  setFocusedRowKey: React.Dispatch<React.SetStateAction<string | null>>;
  wrapperRef: RefObject<HTMLDivElement | null>;
}

// Module-level pending request buffer. Survives component unmount/mount
// cycles so that focus requests emitted during a view switch are not lost.
// Set by useNavigateToView before emitting the event; cleared by the
// data-check effect when a match is found.
let pendingFocusRequest: FocusRequest | null = null;

/**
 * Sets the pending focus request buffer directly. Called by useNavigateToView
 * before emitting the event, so the buffer is guaranteed to be set regardless
 * of React effect scheduling order.
 */
export function setPendingFocusRequest(request: FocusRequest | null): void {
  pendingFocusRequest = request;
}

/**
 * Checks if a table row item matches the focus request by comparing
 * standard Kubernetes resource fields on the data object.
 */
function matchesRequest<T>(item: T, request: FocusRequest): boolean {
  const row = item as Record<string, unknown>;

  // Name must match (required)
  const rowName = row.name;
  if (typeof rowName !== 'string' || rowName !== request.name) {
    return false;
  }

  // ClusterId must match (required)
  const rowClusterId = row.clusterId;
  if (typeof rowClusterId !== 'string' || rowClusterId !== request.clusterId) {
    return false;
  }

  // Kind must match if present on the row (case-insensitive)
  const rowKind = row.kind;
  if (typeof rowKind === 'string' && rowKind.toLowerCase() !== request.kind.toLowerCase()) {
    return false;
  }

  // Namespace must match if the request specifies one
  if (request.namespace !== undefined) {
    const rowNamespace = row.namespace;
    if (typeof rowNamespace === 'string' && rowNamespace !== request.namespace) {
      return false;
    }
  }

  return true;
}

/**
 * Finds the matching row index and focuses it, scrolling it into view.
 * Returns true if a match was found.
 */
function tryFocus<T>(
  request: FocusRequest,
  tableData: T[],
  keyExtractor: (item: T, index: number) => string,
  setFocusedRowKey: React.Dispatch<React.SetStateAction<string | null>>,
  wrapperRef: RefObject<HTMLDivElement | null>
): boolean {
  for (let i = 0; i < tableData.length; i++) {
    if (matchesRequest(tableData[i], request)) {
      const key = keyExtractor(tableData[i], i);
      setFocusedRowKey(key);

      // Scroll the row into view after React renders the focus state.
      requestAnimationFrame(() => {
        const wrapper = wrapperRef.current;
        if (!wrapper) return;
        const escapedKey =
          typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(key) : key;
        const rowElement = wrapper.querySelector<HTMLElement>(
          `.gridtable-row[data-row-key="${escapedKey}"]`
        );
        rowElement?.scrollIntoView({ block: 'nearest' });
      });

      return true;
    }
  }
  return false;
}

export function useGridTableExternalFocus<T>({
  tableData,
  keyExtractor,
  setFocusedRowKey,
  wrapperRef,
}: UseGridTableExternalFocusOptions<T>): void {
  // Keep stable refs for the latest values so the event listener
  // doesn't need to re-subscribe on every data change.
  const tableDataRef = useRef(tableData);
  tableDataRef.current = tableData;
  const keyExtractorRef = useRef(keyExtractor);
  keyExtractorRef.current = keyExtractor;

  // Subscribe to focus-request events. The listener only attempts an
  // immediate focus — it never modifies the module-level buffer.
  // Buffer management is handled by useNavigateToView (sets) and the
  // data-check effect below (clears on match).
  useEffect(() => {
    return eventBus.on('gridtable:focus-request', (request) => {
      tryFocus(
        request,
        tableDataRef.current,
        keyExtractorRef.current,
        setFocusedRowKey,
        wrapperRef
      );
    });
  }, [setFocusedRowKey, wrapperRef]);

  // On mount and when tableData changes, check the module-level buffer
  // for a pending request that a previous (or current) event couldn't fulfill.
  // Uses keyExtractorRef instead of keyExtractor in deps to avoid spurious
  // re-runs when inline keyExtractor functions create new references on
  // re-render — this prevents object-panel GridTables from prematurely
  // consuming the buffer before the target view's GridTable loads data.
  useEffect(() => {
    const pending = pendingFocusRequest;
    if (!pending || tableData.length === 0) {
      return;
    }

    const matched = tryFocus(
      pending,
      tableData,
      keyExtractorRef.current,
      setFocusedRowKey,
      wrapperRef
    );
    if (matched) {
      pendingFocusRequest = null;
    }
  }, [tableData, setFocusedRowKey, wrapperRef]);
}
