/**
 * frontend/src/shared/components/tabs/dragCoordinator/useTabDropTarget.ts
 *
 * Target hook. Returns a ref callback the consumer attaches to a drop
 * zone element, plus an `isDragOver` boolean for hover styling. The
 * hook only fires onDrop when the current drag's kind matches one of
 * the kinds in `accepts`.
 *
 * ## Why we check `dataTransfer.types` + provider state, not `getData`
 *
 * Per the HTML5 drag-and-drop spec, the drag data store is in
 * "protected mode" during `dragenter`, `dragover`, and `dragleave`.
 * Protected mode restricts `dataTransfer.getData()` for custom MIME
 * types to return the empty string — only the `types` list is readable.
 * So during dragenter/dragover we can tell *which types* the source
 * set, but not read their values. At drop time the store enters
 * "read-only mode" and `getData()` works again, so we can read the
 * payload for the onDrop callback.
 *
 * To decide whether to accept a dragenter/dragover (which requires
 * calling `preventDefault()` — without it the browser refuses to fire
 * the subsequent drop), we:
 *
 *   1. Check `event.dataTransfer.types.includes(TAB_DRAG_DATA_TYPE)` —
 *      "is this a Luxury Yacht tab drag at all?" This works in every
 *      browser during protected mode.
 *   2. Read the payload KIND from the provider's `currentDrag` state,
 *      which was set at dragstart by the source hook via `beginDrag`.
 *      This is a plain React state, bridged into event handlers via a
 *      ref so the (memoised) listeners always see the latest value.
 *
 * At drop time we still read the full payload from `getData()` — that
 * path works in read-only mode and preserves the contract that the
 * payload survives the DataTransfer round trip (important for the
 * future tear-off case where drops may happen in a different window).
 *
 * Earlier implementations called `getData()` inside dragenter/dragover
 * and relied on jsdom's permissive mock to pass tests. In real browsers
 * that returns the empty string, no preventDefault is called, and the
 * browser silently rejects the drop — drag-and-drop appears "broken" in
 * production with no errors or warnings.
 */
import { useCallback, useContext, useEffect, useRef, useState, type RefCallback } from 'react';

import { TabDragContext, type DropTargetRegistration } from './TabDragProvider';
import { TAB_DRAG_DATA_TYPE, type TabDragPayload } from './types';

export interface UseTabDropTargetOptions<K extends TabDragPayload['kind']> {
  accepts: K[];
  /**
   * Fires when a drag of an accepted kind is dropped on the target. The
   * third argument is the computed insert index in `[0, tabCount]` — use
   * it to place the dropped tab without having to re-measure the DOM.
   */
  onDrop: (
    payload: Extract<TabDragPayload, { kind: K }>,
    event: DragEvent,
    insertIndex: number
  ) => void;
  onDragEnter?: (payload: Extract<TabDragPayload, { kind: K }>) => void;
  onDragLeave?: () => void;
}

export interface UseTabDropTargetResult {
  ref: RefCallback<HTMLElement>;
  isDragOver: boolean;
  /**
   * Index in `[0, tabCount]` where the dragged tab would be inserted if
   * dropped right now. `null` when no drag is hovering. Computed from the
   * horizontal midpoint of each `[role="tab"]` button inside the drop
   * zone: cursor left of midpoint inserts before that tab; right of
   * midpoint inserts after. Pass this straight to `<Tabs dropInsertIndex>`
   * to render the drop position indicator.
   */
  dropInsertIndex: number | null;
}

/**
 * Compute the insert index for a drop at `clientX` relative to the tab
 * buttons found inside `container`. Uses each button's midpoint — cursor
 * left of midpoint inserts before that tab, right inserts after.
 */
function computeDropInsertIndex(container: HTMLElement, clientX: number): number {
  const buttons = container.querySelectorAll<HTMLElement>('[role="tab"]');
  for (let i = 0; i < buttons.length; i += 1) {
    const rect = buttons[i].getBoundingClientRect();
    if (clientX < rect.left + rect.width / 2) return i;
  }
  return buttons.length;
}

let nextTargetId = 0;

/**
 * Read the full payload from the DataTransfer store. Only valid at
 * `drop` time — during dragenter/dragover the store is in protected
 * mode and this returns null for custom MIME types.
 */
function readPayloadFromDataTransfer(event: DragEvent): TabDragPayload | null {
  if (!event.dataTransfer) return null;
  const raw = event.dataTransfer.getData(TAB_DRAG_DATA_TYPE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TabDragPayload;
  } catch {
    return null;
  }
}

/**
 * Check whether a dragenter/dragover event represents a Luxury Yacht
 * tab drag. `dataTransfer.types` is always readable (even in protected
 * mode), so we use it as the presence gate. Works cross-browser.
 */
function hasTabDragType(event: DragEvent): boolean {
  if (!event.dataTransfer) return false;
  const types = event.dataTransfer.types;
  // `types` is a frozen array in modern browsers and a DOMStringList in
  // older ones. Both are iterable, but only the former has `.includes`,
  // so loop manually for portability.
  for (let i = 0; i < types.length; i += 1) {
    if (types[i] === TAB_DRAG_DATA_TYPE) return true;
  }
  return false;
}

export function useTabDropTarget<K extends TabDragPayload['kind']>(
  opts: UseTabDropTargetOptions<K>
): UseTabDropTargetResult {
  const { accepts, onDrop, onDragEnter, onDragLeave } = opts;
  const { currentDrag, registerTarget, unregisterTarget } = useContext(TabDragContext);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropInsertIndex, setDropInsertIndex] = useState<number | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const idRef = useRef<number>(nextTargetId++);

  const acceptsRef = useRef(accepts);
  const onDropRef = useRef(onDrop);
  const onDragEnterRef = useRef(onDragEnter);
  const onDragLeaveRef = useRef(onDragLeave);
  // Bridge the React state `currentDrag` into the event listeners, which
  // are memoised with empty deps and would otherwise capture a stale
  // value. Updated on every render via the bare assignment below.
  const currentDragRef = useRef(currentDrag);
  acceptsRef.current = accepts;
  onDropRef.current = onDrop;
  onDragEnterRef.current = onDragEnter;
  onDragLeaveRef.current = onDragLeave;
  currentDragRef.current = currentDrag;

  const handleDragEnter = useCallback((event: DragEvent) => {
    if (!hasTabDragType(event)) return;
    const drag = currentDragRef.current;
    if (!drag || !acceptsRef.current.includes(drag.kind as K)) return;
    event.preventDefault();
    setIsDragOver(true);
    onDragEnterRef.current?.(drag as Extract<TabDragPayload, { kind: K }>);
  }, []);

  const handleDragOver = useCallback((event: DragEvent) => {
    if (!hasTabDragType(event)) return;
    const drag = currentDragRef.current;
    if (!drag || !acceptsRef.current.includes(drag.kind as K)) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    const el = elementRef.current;
    if (el) {
      const nextIndex = computeDropInsertIndex(el, event.clientX);
      setDropInsertIndex((prev) => (prev === nextIndex ? prev : nextIndex));
    }
  }, []);

  const handleDragLeave = useCallback((event: DragEvent) => {
    const el = elementRef.current;
    // Native dragleave fires when entering a descendant. Ignore those.
    if (el && event.relatedTarget instanceof Node && el.contains(event.relatedTarget)) {
      return;
    }
    setIsDragOver(false);
    setDropInsertIndex(null);
    onDragLeaveRef.current?.();
  }, []);

  const handleDrop = useCallback((event: DragEvent) => {
    // At drop time the store is in read-only mode — getData() works and
    // gives us the authoritative payload. Prefer it over currentDragRef
    // so that the payload round-trips through DataTransfer correctly
    // (important for the future tear-off case where drops may land in a
    // different document/window where the provider's state isn't
    // visible).
    const payload = readPayloadFromDataTransfer(event) ?? currentDragRef.current ?? null;
    if (!payload || !acceptsRef.current.includes(payload.kind as K)) return;
    event.preventDefault();
    event.stopPropagation();
    const el = elementRef.current;
    const insertIndex = el ? computeDropInsertIndex(el, event.clientX) : 0;
    setIsDragOver(false);
    setDropInsertIndex(null);
    onDropRef.current(payload as Extract<TabDragPayload, { kind: K }>, event, insertIndex);
  }, []);

  const ref = useCallback<RefCallback<HTMLElement>>(
    (el) => {
      // Detach from old element
      const previous = elementRef.current;
      if (previous) {
        previous.removeEventListener('dragenter', handleDragEnter);
        previous.removeEventListener('dragover', handleDragOver);
        previous.removeEventListener('dragleave', handleDragLeave);
        previous.removeEventListener('drop', handleDrop);
        unregisterTarget(idRef.current);
      }

      elementRef.current = el;
      if (el) {
        el.addEventListener('dragenter', handleDragEnter);
        el.addEventListener('dragover', handleDragOver);
        el.addEventListener('dragleave', handleDragLeave);
        el.addEventListener('drop', handleDrop);
        registerTarget(idRef.current, {
          element: el,
          accepts: acceptsRef.current,
          onDrop: onDropRef.current as DropTargetRegistration['onDrop'],
          onDragEnter: onDragEnterRef.current as DropTargetRegistration['onDragEnter'],
          onDragLeave: onDragLeaveRef.current,
        });
      }
    },
    // The handler functions are stable (empty deps) so they don't need
    // to be listed; including them would churn the ref callback identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [registerTarget, unregisterTarget]
  );

  // Cleanup on unmount.
  useEffect(() => {
    // Capture refs to locals so the cleanup function uses the values that
    // existed when the effect ran, not whatever they happen to be at unmount.
    const id = idRef.current;
    return () => {
      const el = elementRef.current;
      if (el) {
        el.removeEventListener('dragenter', handleDragEnter);
        el.removeEventListener('dragover', handleDragOver);
        el.removeEventListener('dragleave', handleDragLeave);
        el.removeEventListener('drop', handleDrop);
      }
      unregisterTarget(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { ref, isDragOver, dropInsertIndex };
}
