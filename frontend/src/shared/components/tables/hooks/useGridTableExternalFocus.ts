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
 * Escapes a row key for use in a CSS attribute selector.
 */
function escapeKey(key: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ? CSS.escape(key) : key;
}

/**
 * Finds the matching row index and focuses it, scrolling it into view.
 * Handles virtualized tables where the target row may not be in the DOM.
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
      scrollToFocusedRow(key, i, tableData.length, wrapperRef);
      return true;
    }
  }
  return false;
}

/**
 * Scrolls a focused row into view. When the table is virtualized and
 * the row is outside the current virtual viewport, scrolls the container
 * to the approximate position first, then retries the DOM lookup once
 * the virtual window has updated.
 */
function scrollToFocusedRow(
  key: string,
  rowIndex: number,
  rowCount: number,
  wrapperRef: RefObject<HTMLDivElement | null>
): void {
  const selector = `.gridtable-row[data-row-key="${escapeKey(key)}"]`;

  requestAnimationFrame(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;

    // Try direct DOM lookup — works for non-virtualized tables and rows
    // that happen to be within the current virtual viewport.
    const rowElement = wrapper.querySelector<HTMLElement>(selector);
    if (rowElement) {
      rowElement.scrollIntoView({ block: 'nearest' });
      return;
    }

    // Row not in DOM — table is likely virtualized and the row is off-screen.
    // Scroll the container to bring the row into the virtual viewport.
    const virtualBody = wrapper.querySelector<HTMLElement>('.gridtable-virtual-body');
    if (!virtualBody || rowCount <= 0) return;

    const totalHeight = virtualBody.offsetHeight;
    const estimatedRowHeight = totalHeight / rowCount;
    const targetTop = Math.max(0, rowIndex * estimatedRowHeight - wrapper.clientHeight / 2);
    wrapper.scrollTo({ top: targetTop, behavior: 'auto' });

    // Retry a few frames later once the virtual viewport has re-rendered.
    let retries = 3;
    const retryScroll = () => {
      const el = wrapperRef.current?.querySelector<HTMLElement>(selector);
      if (el) {
        el.scrollIntoView({ block: 'nearest' });
        return;
      }
      if (--retries > 0) {
        requestAnimationFrame(retryScroll);
      }
    };
    requestAnimationFrame(retryScroll);
  });
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

  // Tracks the last request this instance matched via the eventBus.
  // When the eventBus fires, every mounted GridTable tries an immediate
  // match. If this instance succeeds, we record the request here so the
  // data-check effect below knows NOT to consume the module-level buffer
  // for the same request — the buffer must survive for the *target* view's
  // GridTable, which may not have mounted yet.
  const eventBusMatchRef = useRef<FocusRequest | null>(null);

  // Subscribe to focus-request events. The listener attempts an immediate
  // focus and records the match, but never clears the module-level buffer.
  useEffect(() => {
    return eventBus.on('gridtable:focus-request', (request) => {
      const matched = tryFocus(
        request,
        tableDataRef.current,
        keyExtractorRef.current,
        setFocusedRowKey,
        wrapperRef
      );
      if (matched) {
        eventBusMatchRef.current = request;
      }
    });
  }, [setFocusedRowKey, wrapperRef]);

  // On mount and when tableData changes, check the module-level buffer
  // for a pending request that a previous (or current) event couldn't fulfill.
  // Uses keyExtractorRef instead of keyExtractor in deps to avoid spurious
  // re-runs when inline keyExtractor functions create new references on
  // re-render.
  useEffect(() => {
    const pending = pendingFocusRequest;
    if (!pending || tableData.length === 0) {
      return;
    }

    // If this instance already matched this exact request via the eventBus,
    // skip buffer consumption. The buffer is reserved for a newly-mounting
    // GridTable in the target view (e.g. navigateToView switched from
    // the Object Panel to a namespace view — the Object Panel's GridTable
    // matched immediately via eventBus, but the target view still needs
    // the buffer to highlight the row once it loads data).
    if (eventBusMatchRef.current === pending) {
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
