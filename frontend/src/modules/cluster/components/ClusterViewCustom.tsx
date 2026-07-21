/**
 * frontend/src/modules/cluster/components/ClusterViewCustom.tsx
 *
 * UI component for ClusterViewCustom.
 * Handles rendering and interactions for the cluster feature.
 */

import './ClusterViewCustom.css';
import {
  CustomResourceGridFrame,
  type CustomResourceGridRow,
  useCustomResourceGridParts,
} from '@modules/browse/components/CustomResourceGridView';
import { useCatalogBackedCustomResourceRows } from '@modules/browse/hooks/useCatalogBackedCustomResourceRows';
import { useQueryResourceGridTable } from '@modules/resource-grid/useResourceGridTable';
import { TABLE_PAGE_SIZE_OPTIONS } from '@shared/components/tables/pageSizeOptions';
import { useGridTablePersistence } from '@shared/components/tables/persistence/useGridTablePersistence';
import React, { useMemo } from 'react';

// The binding's header arrow and the catalog query must agree on the default
// order. NsViewCustom gets this from useNamespaceGridTablePersistence's
// defaultSort seed; this view seeds the same default onto its raw persistence.
const CLUSTER_CUSTOM_DEFAULT_SORT = { key: 'name', direction: 'asc' } as const;

// Define props for ClusterViewCustom component
interface ClusterCustomViewProps {
  loading?: boolean;
  loaded?: boolean;
  error?: string | null;
}

/**
 * GridTable component for cluster custom resources
 * Displays various custom resources in the cluster
 */
const ClusterViewCustom: React.FC<ClusterCustomViewProps> = React.memo(
  ({ loading = false, loaded = false, error }) => {
    const parts = useCustomResourceGridParts();
    const { keyExtractor, baseColumns: columns, selectedClusterId } = parts;

    const basePersistence = useGridTablePersistence<CustomResourceGridRow>({
      viewId: 'cluster-custom',
      clusterIdentity: selectedClusterId,
      namespace: null,
      isNamespaceScoped: false,
      columns,
      keyExtractor,
      data: [],
      filterOptions: { isNamespaceScoped: false },
      pageSizeOptions: TABLE_PAGE_SIZE_OPTIONS,
    });
    const persistence = useMemo(
      () => ({
        ...basePersistence,
        sortConfig: basePersistence.sortConfig ?? CLUSTER_CUSTOM_DEFAULT_SORT,
      }),
      [basePersistence]
    );

    const catalog = useCatalogBackedCustomResourceRows({
      clusterId: selectedClusterId,
      clusterScopedOnly: true,
      persistence,
      diagnosticLabel: 'Cluster Custom',
    });
    const {
      filterOptions: catalogFilterOptions,
      totalCount,
      unfilteredTotal,
      totalIsExact,
    } = catalog;

    const { gridTableProps, favModal } = useQueryResourceGridTable<CustomResourceGridRow>({
      tableMode: 'Query Backed Static',
      data: catalog.rows,
      columns,
      persistence,
      keyExtractor,
      defaultSortKey: 'name',
      defaultSortDirection: 'asc',
      diagnosticsLabel: 'Cluster Custom',
      filterOptions: {
        searchBehavior: 'query',
        kinds: catalogFilterOptions.kinds,
        namespaces: undefined,
        showKindDropdown: true,
        totalCount,
        unfilteredTotal,
        totalIsExact,
        partialDataLabel: catalogFilterOptions.partialDataLabel,
      },
    });

    return (
      <CustomResourceGridFrame
        parts={parts}
        catalog={catalog}
        gridTableProps={gridTableProps}
        favModal={favModal}
        columns={columns}
        idPrefix="cluster-custom"
        cacheKeySuffix=""
        exportFilename="cluster-custom-resources"
        spinnerMessage="Loading cluster custom resources..."
        diagnosticsLabel="Cluster Custom"
        tableClassName="cluster-custom-table"
        emptyError={error}
        emptyText="No cluster-scoped custom objects found"
        extraLoading={loading ?? false}
        extraLoaded={loaded}
      />
    );
  }
);

ClusterViewCustom.displayName = 'ClusterViewCustom';

export default ClusterViewCustom;
