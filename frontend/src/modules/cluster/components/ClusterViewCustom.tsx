import {
  type ClusterResourceFamily,
  RESOURCE_FAMILY_LABELS,
} from '@core/navigation/resourceFamilies';
import { operatorColumns } from '@modules/browse/components/operatorColumns';
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
import { karpenterColumns } from './karpenterColumns';

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
const FAMILY_VIEWS = {
  karpenter: { viewId: 'cluster-karpenter' },
  'cert-manager': { viewId: 'cluster-cert-manager' },
  'external-secrets': { viewId: 'cluster-external-secrets' },
} satisfies Record<ClusterResourceFamily, { viewId: string }>;
// Define props for ClusterViewCustom component
interface ClusterCustomViewProps {
  resourceFamily?: ClusterResourceFamily;
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
    const label = resourceFamily ? RESOURCE_FAMILY_LABELS[resourceFamily] : '';
    const config = resourceFamily
      ? {
          ...FAMILY_VIEWS[resourceFamily],
          label,
          spinner: `Loading ${label} resources...`,
          empty: `No ${label} objects found`,
        }
      : CUSTOM_VIEW;
    const parts = useCustomResourceGridParts();
    const {
      keyExtractor,
      selectedClusterId,
      baseColumns,
      openReference,
      navigateReference,
      selectedClusterName,
    } = parts;
    const columns = useMemo(() => {
      if (!resourceFamily) {
        return baseColumns;
      }
      const buildColumns =
        resourceFamily === 'karpenter'
          ? karpenterColumns
          : (columnParts: Parameters<typeof operatorColumns>[1]) =>
              operatorColumns(resourceFamily, columnParts, true);
      return buildColumns({
        baseColumns,
        openReference,
        navigateReference,
        selectedClusterName,
      });
    }, [resourceFamily, baseColumns, openReference, navigateReference, selectedClusterName]);

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
