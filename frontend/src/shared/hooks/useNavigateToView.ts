/**
 * frontend/src/shared/hooks/useNavigateToView.ts
 *
 * Hook that orchestrates alt+click navigation for object panel links.
 * Looks up the target view for a Kubernetes resource kind, navigates
 * to that view, selects the namespace (if applicable), and emits a
 * gridtable:focus-request event so the target GridTable can highlight
 * the row.
 */

import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import {
  buildGridTableFocusRequest,
  type GridTableFocusRequest,
} from '@shared/components/tables/hooks/gridTableFocusRequest';
import { setPendingFocusRequest } from '@shared/components/tables/hooks/useGridTableExternalFocus';
import { useCallback } from 'react';
import { useOptionalSidebarState } from '@/core/contexts/SidebarStateContext';
import { useOptionalViewState } from '@/core/contexts/ViewStateContext';
import { eventBus } from '@/core/events';
import type { ClusterViewType, NamespaceViewType } from '@/types/navigation/views';
import type { KubernetesObjectReference } from '@/types/view-state';
import { getViewForKind } from '@/utils/kindViewMap';

export interface NavigateToViewResult {
  available: boolean;
  navigateToView: (objectRef: KubernetesObjectReference) => void;
}

export function useNavigateToView(): NavigateToViewResult {
  const viewState = useOptionalViewState();
  const sidebarState = useOptionalSidebarState();
  const { setSelectedNamespace } = useNamespace();

  const navigateToView = useCallback(
    (objectRef: KubernetesObjectReference) => {
      const target = navigationTarget(objectRef);
      if (!target || !viewState || !sidebarState) {
        return;
      }
      const { destination, request } = target;

      // 1. Navigate to the target view type
      viewState.setViewType(destination.viewType);

      // 2. Set the correct tab within the view
      if (destination.viewType === 'namespace') {
        viewState.setActiveNamespaceTab(destination.tab as NamespaceViewType);

        selectNavigationNamespace(request, setSelectedNamespace, sidebarState.setSidebarSelection);
      } else if (destination.viewType === 'cluster') {
        viewState.setActiveClusterView(destination.tab as ClusterViewType);

        // Update sidebar to reflect cluster view
        sidebarState.setSidebarSelection({ type: 'cluster', value: 'cluster' });
      }

      setPendingFocusRequest(request);
      eventBus.emit('gridtable:focus-request', request);
    },
    [viewState, sidebarState, setSelectedNamespace]
  );

  return { available: Boolean(viewState && sidebarState), navigateToView };
}

// Resolve identity before changing views, and direct focus only to the target
// table so a second table in the same cluster cannot consume the request.
function navigationTarget(objectRef: KubernetesObjectReference) {
  const focus = buildGridTableFocusRequest(objectRef);
  if (!focus?.version || focus.group === undefined) {
    return null;
  }
  const destination = getViewForKind(focus.kind, objectRef.group, focus.namespace);
  if (!destination) {
    return null;
  }
  return {
    destination,
    request: {
      ...focus,
      destinationViewId:
        destination.destinationViewId ?? `${destination.viewType}-${destination.tab}`,
    },
  };
}

function selectNavigationNamespace(
  request: GridTableFocusRequest,
  setNamespace: ReturnType<typeof useNamespace>['setSelectedNamespace'],
  setSidebarSelection: NonNullable<
    ReturnType<typeof useOptionalSidebarState>
  >['setSidebarSelection']
) {
  if (!request.namespace) {
    return;
  }
  setNamespace(request.namespace, request.clusterId);
  setSidebarSelection({ type: 'namespace', value: request.namespace });
}
