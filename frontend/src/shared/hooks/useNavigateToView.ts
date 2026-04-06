/**
 * frontend/src/shared/hooks/useNavigateToView.ts
 *
 * Hook that orchestrates alt+click navigation for object panel links.
 * Looks up the target view for a Kubernetes resource kind, navigates
 * to that view, selects the namespace (if applicable), and emits a
 * gridtable:focus-request event so the target GridTable can highlight
 * the row.
 */

import { useCallback } from 'react';
import { useViewState } from '@/core/contexts/ViewStateContext';
import { useSidebarState } from '@/core/contexts/SidebarStateContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import { eventBus } from '@/core/events';
import { setPendingFocusRequest } from '@shared/components/tables/hooks/useGridTableExternalFocus';
import { getViewForKind, isNamespaceScopedKind } from '@/utils/kindViewMap';
import type { KubernetesObjectReference } from '@/types/view-state';
import type { NamespaceViewType, ClusterViewType } from '@/types/navigation/views';

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
      if (!kind) return;

      const destination = getViewForKind(kind);
      if (!destination) return;

      // Multi-cluster rule (AGENTS.md): carry clusterId through as
      // `string | undefined` rather than a `''` fallback. Downstream
      // helpers treat undefined as "no cluster context" explicitly;
      // empty string would silently conflate "no cluster" with "cluster
      // named ''" and break cluster-scoped navigation.
      const clusterId = objectRef.clusterId ?? undefined;
      const name = (objectRef.name ?? objectRef.metadata?.name ?? '') as string;
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
      //    Skipped when clusterId is missing — the focus-request consumer
      //    needs a cluster identity to route to the right table.
      if (clusterId && name) {
        const focusRequest = { kind, name, namespace, clusterId };
        setPendingFocusRequest(focusRequest);
        eventBus.emit('gridtable:focus-request', focusRequest);
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
