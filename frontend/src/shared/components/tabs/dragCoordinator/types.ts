/**
 * frontend/src/shared/components/tabs/dragCoordinator/types.ts
 *
 * Discriminated union describing what's being dragged. Drop targets
 * declare which kinds they accept; the type system guarantees a target
 * registered for one kind cannot be invoked with a payload of another
 * kind. This is what makes cross-system drops (e.g., dragging a cluster
 * tab onto a dockable strip) impossible by construction.
 */
export type TabDragPayload =
  | { kind: 'cluster-tab'; clusterId: string }
  | { kind: 'dockable-tab'; panelId: string; sourceGroupId: string };

/**
 * Wire-format key used with DataTransfer.setData / getData. Includes the
 * project namespace so it doesn't collide with anything the OS or other
 * apps put in the clipboard during drag.
 */
export const TAB_DRAG_DATA_TYPE = 'application/x-luxury-yacht-tab';
