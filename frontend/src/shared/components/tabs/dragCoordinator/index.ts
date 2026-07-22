/**
 * frontend/src/shared/components/tabs/dragCoordinator/index.ts
 *
 * Public API for the tab drag coordinator.
 */

export { TabDragProvider } from './TabDragProvider';
export type { TabDragPayload } from './types';
export { TAB_DRAG_DATA_TYPE } from './types';
export { useTabDragSource, useTabDragSourceFactory } from './useTabDragSource';
export { useTabDropTarget } from './useTabDropTarget';
