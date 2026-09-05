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
 *   2. Read the payload kind from the provider's `currentDrag` state, or
 *      from the source's kind-specific MIME marker when the source is in
 *      another native webview and therefore has a different provider. An
 *      external source must also match the destination's owner/cluster MIME
 *      marker; targets without a scope accept local drags only.
 *
 * At drop time we still read the full payload from `getData()` — that
 * path works in read-only mode and preserves the contract that the
 * payload survives the DataTransfer round trip across native webviews.
 *
 * Earlier implementations called `getData()` inside dragenter/dragover
 * and relied on jsdom's permissive mock to pass tests. In real browsers
 * that returns the empty string, no preventDefault is called, and the
 * browser silently rejects the drop — drag-and-drop appears "broken" in
 * production with no errors or warnings.
 */

import { getHorizontalDropInsertIndex, hasDragDataType } from '@shared/components/dragReorder';
import {
  type RefCallback,
  useCallback,
  useContext,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react';
import { type DropTargetRegistration, TabDragContext } from './TabDragProvider';
import {
  TAB_DRAG_DATA_TYPE,
  type TabDragPayload,
  type TabDragScope,
  tabDragKindFromDataTypes,
  tabDragMatchesScope,
  tabDragScopeDataType,
} from './types';

export interface UseTabDropTargetOptions<K extends TabDragPayload['kind']> {
  accepts: K[];
  /** Allows cross-document drops only from this owner and cluster. */
  scope?: TabDragScope;
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

let nextTargetId = 0;

/**
 * Read the full payload from the DataTransfer store. Only valid at
 * `drop` time — during dragenter/dragover the store is in protected
 * mode and this returns null for custom MIME types.
 */
function readPayloadFromDataTransfer(event: DragEvent): TabDragPayload | null {
  if (!event.dataTransfer) {
    return null;
  }
  const raw = event.dataTransfer.getData(TAB_DRAG_DATA_TYPE);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as TabDragPayload;
  } catch {
    return null;
  }
}

export function useTabDropTarget<K extends TabDragPayload['kind']>(
  opts: UseTabDropTargetOptions<K>
): UseTabDropTargetResult {
  const { accepts, scope, onDrop, onDragEnter, onDragLeave } = opts;
  const { getCurrentDrag, registerTarget, unregisterTarget } = useContext(TabDragContext);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropInsertIndex, setDropInsertIndex] = useState<number | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const idRef = useRef<number>(nextTargetId++);

  const acceptsRef = useRef(accepts);
  const scopeRef = useRef(scope);
  const onDropRef = useRef(onDrop);
  const onDragEnterRef = useRef(onDragEnter);
  const onDragLeaveRef = useRef(onDragLeave);
  acceptsRef.current = accepts;
  scopeRef.current = scope;
  onDropRef.current = onDrop;
  onDragEnterRef.current = onDragEnter;
  onDragLeaveRef.current = onDragLeave;

  const acceptsDrag = useCallback(
    (event: DragEvent) => {
      if (!hasDragDataType(event.dataTransfer, TAB_DRAG_DATA_TYPE)) {
        return false;
      }
      const drag = getCurrentDrag();
      const kind = drag?.kind ?? tabDragKindFromDataTypes(event.dataTransfer?.types);
      if (!kind || !acceptsRef.current.includes(kind as K)) {
        return false;
      }
      const targetScope = scopeRef.current;
      if (drag) {
        return !targetScope || tabDragMatchesScope(drag, targetScope);
      }
      return (
        !!targetScope && hasDragDataType(event.dataTransfer, tabDragScopeDataType(targetScope))
      );
    },
    [getCurrentDrag]
  );

  const rejectDrag = useCallback((event: DragEvent) => {
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'none';
    }
    setIsDragOver(false);
    setDropInsertIndex(null);
  }, []);

  const handleDragEnter = useCallback(
    (event: DragEvent) => {
      if (!acceptsDrag(event)) {
        rejectDrag(event);
        return;
      }
      const drag = getCurrentDrag();
      event.preventDefault();
      setIsDragOver(true);
      if (drag) {
        onDragEnterRef.current?.(drag as Extract<TabDragPayload, { kind: K }>);
      }
    },
    [acceptsDrag, getCurrentDrag, rejectDrag]
  );

  const handleDragOver = useCallback(
    (event: DragEvent) => {
      if (!acceptsDrag(event)) {
        rejectDrag(event);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.dataTransfer) {
        event.dataTransfer.dropEffect = 'move';
      }
      const el = elementRef.current;
      if (el) {
        const nextIndex = getHorizontalDropInsertIndex(
          el.querySelectorAll<HTMLElement>('[role="tab"]'),
          event.clientX
        );
        setDropInsertIndex((prev) => (prev === nextIndex ? prev : nextIndex));
      }
    },
    [acceptsDrag, rejectDrag]
  );

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

  const handleDrop = useCallback(
    (event: DragEvent) => {
      // At drop time the store is in read-only mode — getData() works and
      // gives us the authoritative payload. Prefer it over the local drag
      // so that the payload round-trips through DataTransfer correctly
      // (important for cross-window transfers where drops may land in a
      // different document/window where the provider's state isn't
      // visible).
      const localDrag = getCurrentDrag();
      const payload = readPayloadFromDataTransfer(event) ?? localDrag;
      if (
        !payload ||
        !acceptsRef.current.includes(payload.kind as K) ||
        (!scopeRef.current && !localDrag) ||
        (scopeRef.current && !tabDragMatchesScope(payload, scopeRef.current))
      ) {
        rejectDrag(event);
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const el = elementRef.current;
      const insertIndex = el
        ? getHorizontalDropInsertIndex(
            el.querySelectorAll<HTMLElement>('[role="tab"]'),
            event.clientX
          )
        : 0;
      setIsDragOver(false);
      setDropInsertIndex(null);
      onDropRef.current(payload as Extract<TabDragPayload, { kind: K }>, event, insertIndex);
    },
    [getCurrentDrag, rejectDrag]
  );

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
    [handleDragEnter, handleDragLeave, handleDragOver, handleDrop, registerTarget, unregisterTarget]
  );

  // Cleanup on unmount.
  const cleanUpDropTarget = useEffectEvent(() => {
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
  });
  useEffect(() => cleanUpDropTarget(), []);

  return { ref, isDragOver, dropInsertIndex };
}
