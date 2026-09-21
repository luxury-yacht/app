/**
 * frontend/src/shared/components/tabs/dragCoordinator/index.ts
 *
 * Public API for the tab drag coordinator.
 */

export { TabDragProvider } from './TabDragProvider';
export type { TabDragPayload, TabDragScope } from './types';
export { TAB_DRAG_DATA_TYPE } from './types';
export { useTabDragPresence } from './useTabDragPresence';
export { useTabDragSource, useTabDragSourceFactory } from './useTabDragSource';
export { useTabDropTarget } from './useTabDropTarget';
