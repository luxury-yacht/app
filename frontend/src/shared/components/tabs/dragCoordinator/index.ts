/**
 * frontend/src/shared/components/tabs/dragCoordinator/index.ts
 *
 * Public API for the tab drag coordinator.
 */

export type { DropTargetRegistration, TabDragProviderProps } from './TabDragProvider';
export { TabDragProvider } from './TabDragProvider';
export type { TabDragPayload } from './types';
export { TAB_DRAG_DATA_TYPE } from './types';
export type { TabDragSourceProps, UseTabDragSourceOptions } from './useTabDragSource';
export { useTabDragSource, useTabDragSourceFactory } from './useTabDragSource';
export type { UseTabDropTargetOptions, UseTabDropTargetResult } from './useTabDropTarget';
export { useTabDropTarget } from './useTabDropTarget';
