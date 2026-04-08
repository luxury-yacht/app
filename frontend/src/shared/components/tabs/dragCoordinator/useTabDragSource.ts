/**
 * frontend/src/shared/components/tabs/dragCoordinator/useTabDragSource.ts
 *
 * Source hook. Returns props that the consumer spreads onto a tab via
 * the `extraProps` field on its TabDescriptor. The hook updates the
 * provider's currentDrag state, writes the payload to dataTransfer for
 * round-trip survival, and optionally calls setDragImage with a custom
 * preview element.
 */
import { useCallback, useContext, type DragEventHandler } from 'react';

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

export function useTabDragSource(
  payload: TabDragPayload | null,
  options?: UseTabDragSourceOptions
): TabDragSourceProps {
  const { beginDrag, endDrag } = useContext(TabDragContext);

  const onDragStart = useCallback<DragEventHandler<HTMLElement>>(
    (event) => {
      if (!payload) return;
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
    [payload, options, beginDrag]
  );

  const onDragEnd = useCallback<DragEventHandler<HTMLElement>>(() => {
    endDrag();
  }, [endDrag]);

  if (!payload) {
    return { draggable: false };
  }

  return {
    draggable: true,
    onDragStart,
    onDragEnd,
  };
}
