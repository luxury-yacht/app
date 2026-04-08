/**
 * frontend/src/shared/components/tabs/dragCoordinator/index.ts
 *
 * Public API for the tab drag coordinator.
 */
export { TabDragProvider, TabDragContext } from './TabDragProvider';
export type { TabDragProviderProps, DropTargetRegistration } from './TabDragProvider';

export {
  useTabDragSource,
  useTabDragSourceFactory,
  createTabDragSourceProps,
} from './useTabDragSource';
export type { TabDragSourceProps, UseTabDragSourceOptions } from './useTabDragSource';

export { useTabDropTarget } from './useTabDropTarget';
export type { UseTabDropTargetOptions, UseTabDropTargetResult } from './useTabDropTarget';

export { TAB_DRAG_DATA_TYPE } from './types';
export type { TabDragPayload, TabDragKind } from './types';
