import { useViewState } from '@core/contexts/ViewStateContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import type { ClusterObjectReference } from '@shared/utils/objectIdentity';
import React, { useCallback, useMemo } from 'react';
import { permissionDeniedFailure } from '@/core/refresh/refreshFailure';
import NamespaceSummaryTable, {
  type NamespaceTableRow,
  projectNamespaceSummary,
} from './NamespaceSummaryTable';

const ClusterViewNamespaces: React.FC = () => {
  const { selectedClusterId } = useKubeconfig();
  const {
    namespaceSummaries,
    namespaceMetricsState,
    namespaceError,
    namespaceLoading,
    namespacesPermissionDenied,
    setSelectedNamespace,
  } = useNamespace();
  const { onNamespaceSelect } = useViewState();

  const rows = useMemo<NamespaceTableRow[]>(() => {
    if (!selectedClusterId) {
      return [];
    }
    return namespaceSummaries
      .filter((namespace) => namespace.ref.clusterId === selectedClusterId)
      .map((namespace) => projectNamespaceSummary(namespace, namespaceMetricsState));
  }, [namespaceMetricsState, namespaceSummaries, selectedClusterId]);

  const goToNamespace = useCallback(
    (namespace: ClusterObjectReference) => {
      setSelectedNamespace(namespace.name, namespace.clusterId);
      onNamespaceSelect(namespace.name);
    },
    [onNamespaceSelect, setSelectedNamespace]
  );

  return (
    <div className="cluster-namespaces">
      <NamespaceSummaryTable
        rows={rows}
        goToNamespace={goToNamespace}
        clusterIdentity={selectedClusterId ?? ''}
        persistenceEnabled={Boolean(selectedClusterId)}
        loading={namespaceLoading}
        loaded={
          namespacesPermissionDenied ||
          Boolean(namespaceError) ||
          (Boolean(selectedClusterId) && !namespaceLoading)
        }
        error={
          namespacesPermissionDenied ? permissionDeniedFailure(namespaceError) : namespaceError
        }
        blocked={!selectedClusterId}
        tableMode="Local Complete"
        cacheKey={
          selectedClusterId ? `cluster-namespaces:${selectedClusterId}` : 'cluster-namespaces'
        }
        emptyMessage="No namespaces found"
      />
    </div>
  );
};

export default React.memo(ClusterViewNamespaces);
