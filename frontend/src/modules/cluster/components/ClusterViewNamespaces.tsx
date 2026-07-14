import { useViewState } from '@core/contexts/ViewStateContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNamespace } from '@modules/namespace/contexts/NamespaceContext';
import React, { useCallback, useMemo } from 'react';
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
      .filter(
        (namespace) =>
          namespace.clusterId === selectedClusterId && namespace.ref.clusterId === selectedClusterId
      )
      .map((namespace) => projectNamespaceSummary(namespace, namespaceMetricsState));
  }, [namespaceMetricsState, namespaceSummaries, selectedClusterId]);

  const navigate = useCallback(
    (row: NamespaceTableRow) => {
      if (row.scopeStatus) {
        return;
      }
      setSelectedNamespace(row.name, row.clusterId);
      onNamespaceSelect(row.name);
    },
    [onNamespaceSelect, setSelectedNamespace]
  );

  return (
    <div className="cluster-namespaces">
      <NamespaceSummaryTable
        rows={rows}
        navigate={navigate}
        clusterIdentity={selectedClusterId ?? ''}
        persistenceEnabled={Boolean(selectedClusterId)}
        loading={namespaceLoading}
        loaded={
          namespacesPermissionDenied ||
          Boolean(namespaceError) ||
          (Boolean(selectedClusterId) && !namespaceLoading)
        }
        error={
          namespacesPermissionDenied ? 'Insufficient permission to list namespaces' : namespaceError
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
