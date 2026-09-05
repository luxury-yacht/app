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
  | {
      kind: 'dockable-tab';
      panelId: string;
      sourceGroupId: string;
      sourceWindowName?: string;
      sourceWindowGroupId?: string;
      ownerWindowName?: string;
      clusterId?: string;
      tab?: {
        kind: string;
        panelId: string;
        objectRef: {
          clusterId: string;
          group: string;
          version: string;
          kind: string;
          namespace: string;
          name: string;
        };
        activeView: string;
      };
    };

/**
 * Wire-format key used with DataTransfer.setData / getData. Includes the
 * project namespace so it doesn't collide with anything the OS or other
 * apps put in the clipboard during drag.
 */
export const TAB_DRAG_DATA_TYPE = 'application/x-luxury-yacht-tab';

export interface TabDragScope {
  ownerWindowName: string;
  clusterId: string;
}

// MIME types remain readable during protected dragover. Hex preserves case in
// identities even though native drag stores normalize MIME names to lowercase.
export const tabDragScopeDataType = (scope: TabDragScope): string => {
  const bytes = new TextEncoder().encode(JSON.stringify([scope.ownerWindowName, scope.clusterId]));
  const identity = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${TAB_DRAG_DATA_TYPE}-scope-${identity}`;
};

export const tabDragMatchesScope = (payload: TabDragPayload, scope: TabDragScope): boolean =>
  payload.kind === 'dockable-tab' &&
  payload.ownerWindowName === scope.ownerWindowName &&
  payload.clusterId === scope.clusterId;

export const tabDragKindDataType = (kind: TabDragPayload['kind']): string =>
  `${TAB_DRAG_DATA_TYPE}-${kind}`;

export const tabDragKindFromDataTypes = (
  types: readonly string[] | undefined
): TabDragPayload['kind'] | null => {
  if (!types) {
    return null;
  }
  if (types.includes(tabDragKindDataType('dockable-tab'))) {
    return 'dockable-tab';
  }
  if (types.includes(tabDragKindDataType('cluster-tab'))) {
    return 'cluster-tab';
  }
  return null;
};
