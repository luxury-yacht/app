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
  onDrop: (payload: Extract<TabDragPayload, { kind: K }>, event: DragEvent) => void;
  onDragEnter?: (payload: Extract<TabDragPayload, { kind: K }>) => void;
  onDragLeave?: () => void;
}

export interface UseTabDropTargetResult {
  ref: RefCallback<HTMLElement>;
  isDragOver: boolean;
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
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleDragLeave = useCallback((event: DragEvent) => {
    const el = elementRef.current;
    // Native dragleave fires when entering a descendant. Ignore those.
    if (el && event.relatedTarget instanceof Node && el.contains(event.relatedTarget)) {
      return;
    }
    setIsDragOver(false);
    onDragLeaveRef.current?.();
  }, []);

  const handleDrop = useCallback((event: DragEvent) => {
    const payload = readPayload(event);
    if (!payload || !acceptsRef.current.includes(payload.kind as K)) return;
    event.preventDefault();
    setIsDragOver(false);
    onDropRef.current(payload as Extract<TabDragPayload, { kind: K }>, event);
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

  return { ref, isDragOver };
}
