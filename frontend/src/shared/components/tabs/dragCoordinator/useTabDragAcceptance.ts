import { hasDragDataType } from '@shared/components/dragReorder';
import { useCallback, useContext, useRef } from 'react';
import { TabDragContext } from './TabDragProvider';
import {
  TAB_DRAG_DATA_TYPE,
  type TabDragPayload,
  type TabDragScope,
  tabDragKindFromDataTypes,
  tabDragMatchesScope,
  tabDragScopeDataType,
} from './types';

export interface TabDragAcceptance<K extends TabDragPayload['kind']> {
  accepts: K[];
  /** Restricts cross-document panel drops to the same cluster. */
  scope?: TabDragScope;
  /** Cluster strips can accept cluster tabs from any app window. */
  allowExternal?: boolean;
}

/** Shared admission for protected drag events, before payload values are readable. */
export function useTabDragAcceptance<K extends TabDragPayload['kind']>(
  options: TabDragAcceptance<K>
) {
  const { getCurrentDrag } = useContext(TabDragContext);
  const optionsRef = useRef(options);
  optionsRef.current = options;
  return useCallback(
    (event: DragEvent) => {
      if (!hasDragDataType(event.dataTransfer, TAB_DRAG_DATA_TYPE)) {
        return false;
      }
      const drag = getCurrentDrag();
      const kind = drag?.kind ?? tabDragKindFromDataTypes(event.dataTransfer?.types);
      if (!kind || !optionsRef.current.accepts.includes(kind as K)) {
        return false;
      }
      const targetScope = optionsRef.current.scope;
      if (drag) {
        return !targetScope || tabDragMatchesScope(drag, targetScope);
      }
      return targetScope
        ? hasDragDataType(event.dataTransfer, tabDragScopeDataType(targetScope))
        : (optionsRef.current.allowExternal ?? false);
    },
    [getCurrentDrag]
  );
}
