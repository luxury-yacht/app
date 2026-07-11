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
import { buildGridTableFocusRequest } from '@shared/components/tables/hooks/gridTableFocusRequest';
import { setPendingFocusRequest } from '@shared/components/tables/hooks/useGridTableExternalFocus';
import { useCallback } from 'react';
import { useSidebarState } from '@/core/contexts/SidebarStateContext';
import { useViewState } from '@/core/contexts/ViewStateContext';
import { eventBus } from '@/core/events';
import type { ClusterViewType, NamespaceViewType } from '@/types/navigation/views';
import type { KubernetesObjectReference } from '@/types/view-state';
import { getViewForKind, isNamespaceScopedKind } from '@/utils/kindViewMap';

export interface NavigateToViewResult {
  navigateToView: (objectRef: KubernetesObjectReference) => void;
}

export function useNavigateToView(): NavigateToViewResult {
  const { setViewType, setActiveNamespaceTab, setActiveClusterView } = useViewState();
  const { setSidebarSelection } = useSidebarState();
  const { setSelectedNamespace } = useNamespace();

  const navigateToView = useCallback(
    (objectRef: KubernetesObjectReference) => {
      const kind = objectRef.kind ?? objectRef.metadata?.kind;
      if (!kind) {
        return;
      }

      const destination = getViewForKind(kind);
      if (!destination) {
        return;
      }

      // Multi-cluster rule (AGENTS.md): carry clusterId through as
      // `string | undefined` rather than a `''` fallback. Downstream
      // helpers treat undefined as "no cluster context" explicitly;
      // empty string would silently conflate "no cluster" with "cluster
      // named ''" and break cluster-scoped navigation.
      const clusterId = objectRef.clusterId ?? undefined;
      const namespace = (objectRef.namespace ?? objectRef.metadata?.namespace ?? undefined) as
        | string
        | undefined;

      // 1. Navigate to the target view type
      setViewType(destination.viewType);

      // 2. Set the correct tab within the view
      if (destination.viewType === 'namespace') {
        setActiveNamespaceTab(destination.tab as NamespaceViewType);

        // 3. Select the namespace so the view loads the right data
        if (namespace && isNamespaceScopedKind(kind)) {
          setSelectedNamespace(namespace, clusterId);
        }

        // 4. Update sidebar to reflect the namespace selection
        if (namespace) {
          setSidebarSelection({ type: 'namespace', value: namespace });
        }
      } else if (destination.viewType === 'cluster') {
        setActiveClusterView(destination.tab as ClusterViewType);

        // Update sidebar to reflect cluster view
        setSidebarSelection({ type: 'cluster', value: 'cluster' });
      }

      // 5. Emit focus request so the target GridTable highlights the row.
      //    Use the same canonical identity backbone as object opening. Stamp the
      //    destination viewId (`${viewType}-${tab}`, matching a table's viewId) so
      //    only the destination table can turn an unmatched request into an
      //    anchor jump — a same-cluster non-target table (e.g. an object-panel
      //    pods list) must not consume it and fire a false not-found.
      const focusRequest = buildGridTableFocusRequest(objectRef);
      if (focusRequest) {
        const request = {
          ...focusRequest,
          destinationViewId: `${destination.viewType}-${destination.tab}`,
        };
        setPendingFocusRequest(request);
        eventBus.emit('gridtable:focus-request', request);
      }
    },
    [
      setViewType,
      setActiveNamespaceTab,
      setActiveClusterView,
      setSidebarSelection,
      setSelectedNamespace,
    ]
  );

  return { navigateToView };
}
