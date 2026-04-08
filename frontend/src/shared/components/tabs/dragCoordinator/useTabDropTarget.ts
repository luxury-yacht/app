/**
 * frontend/src/shared/components/tabs/dragCoordinator/useTabDropTarget.ts
 *
 * Target hook. Returns a ref callback the consumer attaches to a drop
 * zone element, plus an `isDragOver` boolean for hover styling. The
 * hook only fires onDrop when the current drag's kind matches one of
 * the kinds in `accepts`.
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

function readPayload(event: DragEvent): TabDragPayload | null {
  if (!event.dataTransfer) return null;
  const raw = event.dataTransfer.getData(TAB_DRAG_DATA_TYPE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as TabDragPayload;
  } catch {
    return null;
  }
}

export function useTabDropTarget<K extends TabDragPayload['kind']>(
  opts: UseTabDropTargetOptions<K>
): UseTabDropTargetResult {
  const { accepts, onDrop, onDragEnter, onDragLeave } = opts;
  const { registerTarget, unregisterTarget } = useContext(TabDragContext);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropInsertIndex, setDropInsertIndex] = useState<number | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const idRef = useRef<number>(nextTargetId++);

  const acceptsRef = useRef(accepts);
  const onDropRef = useRef(onDrop);
  const onDragEnterRef = useRef(onDragEnter);
  const onDragLeaveRef = useRef(onDragLeave);
  acceptsRef.current = accepts;
  onDropRef.current = onDrop;
  onDragEnterRef.current = onDragEnter;
  onDragLeaveRef.current = onDragLeave;

  const handleDragEnter = useCallback((event: DragEvent) => {
    const payload = readPayload(event);
    if (!payload || !acceptsRef.current.includes(payload.kind as K)) return;
    event.preventDefault();
    setIsDragOver(true);
    onDragEnterRef.current?.(payload as Extract<TabDragPayload, { kind: K }>);
  }, []);

  const handleDragOver = useCallback((event: DragEvent) => {
    const payload = readPayload(event);
    if (!payload || !acceptsRef.current.includes(payload.kind as K)) return;
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
    const payload = readPayload(event);
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
