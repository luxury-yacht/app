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
import { createDetailSegmentsColumn } from '@shared/components/tables/detailSegmentsColumn';
import { TABLE_PAGE_SIZE_OPTIONS } from '@shared/components/tables/pageSizeOptions';
import { useGridTablePersistence } from '@shared/components/tables/persistence/useGridTablePersistence';
import React, { useMemo } from 'react';

// The binding's header arrow and the catalog query must agree on the default
// order. NsViewCustom gets this from useNamespaceGridTablePersistence's
// defaultSort seed; this view seeds the same default onto its raw persistence.
const CLUSTER_CUSTOM_DEFAULT_SORT = { key: 'name', direction: 'asc' } as const;

const CUSTOM_VIEW = {
  viewId: 'cluster-custom',
  label: 'Cluster Custom',
  spinner: 'Loading cluster custom resources...',
  empty: 'No cluster-scoped custom objects found',
};
const KARPENTER_VIEW = {
  viewId: 'cluster-karpenter',
  label: 'Karpenter',
  spinner: 'Loading Karpenter resources...',
  empty: 'No Karpenter objects found',
};

// Define props for ClusterViewCustom component
interface ClusterCustomViewProps {
  resourceFamily?: 'karpenter';
  loading?: boolean;
  loaded?: boolean;
  error?: string | null;
}

/**
 * GridTable component for cluster custom resources
 * Displays various custom resources in the cluster
 */
const ClusterViewCustom: React.FC<ClusterCustomViewProps> = React.memo(
  ({ loading = false, loaded = false, error, resourceFamily }) => {
    const config = resourceFamily ? KARPENTER_VIEW : CUSTOM_VIEW;
    const parts = useCustomResourceGridParts();
    const { keyExtractor, selectedClusterId } = parts;
    const columns = useMemo(() => {
      if (!resourceFamily) {
        return parts.baseColumns;
      }
      const details = [
        ['reference', 'Context'],
        ['counts', 'Capacity'],
        ['configuration', 'Configuration'],
      ].map(([slot, header]) =>
        createDetailSegmentsColumn<CustomResourceGridRow>({
          key: slot,
          header,
          slot,
          openReference: parts.openReference,
          navigateReference: parts.navigateReference,
          clusterName: parts.selectedClusterName,
        })
      );
      return [
        ...parts.baseColumns.filter((column) => column.key !== 'crd' && column.key !== 'age'),
        ...details,
        ...parts.baseColumns.filter((column) => column.key === 'age'),
      ];
    }, [
      resourceFamily,
      parts.baseColumns,
      parts.openReference,
      parts.navigateReference,
      parts.selectedClusterName,
    ]);

    const basePersistence = useGridTablePersistence<CustomResourceGridRow>({
      viewId: config.viewId,
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
      resourceFamily,
      persistence,
      diagnosticLabel: config.label,
    });
    const {
      filterOptions: catalogFilterOptions,
      totalCount,
      unfilteredTotal,
      totalIsExact,
    } = catalog;

    const { gridTableProps, favModal } = useQueryResourceGridTable<CustomResourceGridRow>({
      tableMode: 'Query Backed Static',
      supportsCustomMetadataColumns: true,
      data: catalog.rows,
      columns,
      persistence,
      keyExtractor,
      defaultSortKey: 'name',
      defaultSortDirection: 'asc',
      diagnosticsLabel: config.label,
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
        idPrefix={config.viewId}
        cacheKeySuffix=""
        exportFilename={`${config.viewId}-resources`}
        spinnerMessage={config.spinner}
        diagnosticsLabel={config.label}
        tableClassName="cluster-custom-table"
        emptyError={error}
        emptyText={config.empty}
        extraLoading={loading ?? false}
        extraLoaded={loaded}
      />
    );
  }
);

ClusterViewCustom.displayName = 'ClusterViewCustom';

export default ClusterViewCustom;
