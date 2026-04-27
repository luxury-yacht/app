/**
 * frontend/src/shared/components/tabs/dragCoordinator/useTabDragSource.ts
 *
 * Source-side drag API. Two entry points:
 *
 *   • useTabDragSource(payload, options)  — hook API for the simple
 *     case where a component declares a single draggable element.
 *     Calls useContext internally.
 *
 *   • useTabDragSourceFactory()           — hook API for consumers
 *     that build per-tab drag props inside `.map()` over a
 *     dynamic-length tabs array. Returns a plain factory function;
 *     the factory is safe to call inside loops because it contains
 *     no hook calls. Calls useContext exactly ONCE per consumer
 *     render regardless of tab count.
 *
 * Both entry points ultimately delegate to the same pure factory.
 */
import { useContext, type DragEventHandler } from 'react';

import { TabDragContext } from './TabDragProvider';
import { TAB_DRAG_DATA_TYPE, type TabDragPayload } from './types';

export interface UseTabDragSourceOptions {
  /**
   * Optional custom drag preview. Invoked synchronously at dragstart.
   * Return the element + cursor offset to use as the drag image, or
   * null to fall back to the browser's default (a translucent copy of
   * the source element).
   *
   * The element MUST already be in the DOM when this is called — the
   * browser screenshots it once and never re-reads it.
   */
  getDragImage?: () => { element: HTMLElement; offsetX: number; offsetY: number } | null;
}

export interface TabDragSourceProps {
  draggable: boolean;
  onDragStart?: DragEventHandler<HTMLElement>;
  onDragEnd?: DragEventHandler<HTMLElement>;
}

/**
 * Pure factory — builds the drag-source event handlers for one tab
 * given an already-resolved TabDragContext. No hooks inside, so this
 * can be called anywhere (including inside loops).
 */
function createTabDragSourceProps(
  payload: TabDragPayload | null,
  beginDrag: (payload: TabDragPayload) => void,
  endDrag: () => void,
  options?: UseTabDragSourceOptions
): TabDragSourceProps {
  if (!payload) {
    return { draggable: false };
  }
  return {
    draggable: true,
    onDragStart: (event) => {
      event.dataTransfer.setData(TAB_DRAG_DATA_TYPE, JSON.stringify(payload));
      event.dataTransfer.effectAllowed = 'move';
      if (options?.getDragImage) {
        const result = options.getDragImage();
        if (result) {
          event.dataTransfer.setDragImage(result.element, result.offsetX, result.offsetY);
        }
      }
      beginDrag(payload);
    },
    onDragEnd: () => {
      endDrag();
    },
  };
}

/**
 * Hook variant for single-source consumers (one draggable element per
 * component). Calls useContext internally. For dynamic-length tab
 * lists, use `useTabDragSourceFactory` instead.
 */
export function useTabDragSource(
  payload: TabDragPayload | null,
  options?: UseTabDragSourceOptions
): TabDragSourceProps {
  const { beginDrag, endDrag } = useContext(TabDragContext);
  return createTabDragSourceProps(payload, beginDrag, endDrag, options);
}

/**
 * Hook variant for consumers that render an unbounded number of
 * draggable tabs. Calls useContext exactly once, then returns a plain
 * factory the consumer calls per tab during render. The returned
 * factory closes over the current context values, so it's safe to
 * call inside `.map()` without violating the rules of hooks.
 *
 * Note: the returned factory has a new identity on every render (it's
 * a fresh closure over the current context values). Do NOT pass it
 * directly as a `useMemo` / `useEffect` / `useCallback` dependency —
 * doing so will re-run the hook on every render. Consumers that need
 * dependency stability should depend on the per-tab props the factory
 * produces, not on the factory itself.
 *
 * Typical usage:
 *
 *   const makeDragSource = useTabDragSourceFactory();
 *   const tabDescriptors = tabs.map((tab) => ({
 *     id: tab.id,
 *     label: tab.label,
 *     extraProps: makeDragSource({ kind: 'cluster-tab', clusterId: tab.id }),
 *   }));
 */
export function useTabDragSourceFactory(): (
  payload: TabDragPayload | null,
  options?: UseTabDragSourceOptions
) => TabDragSourceProps {
  const { beginDrag, endDrag } = useContext(TabDragContext);
  return (payload, options) => createTabDragSourceProps(payload, beginDrag, endDrag, options);
}
