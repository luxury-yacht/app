/**
 * frontend/src/modules/namespace/components/NsViewCustom.tsx
 *
 * UI component for NsViewCustom.
 * Handles rendering and interactions for the namespace feature.
 */

import {
  CustomResourceGridFrame,
  type CustomResourceGridRow,
  useCustomResourceGridParts,
} from '@modules/browse/components/CustomResourceGridView';
import { useCatalogBackedCustomResourceRows } from '@modules/browse/hooks/useCatalogBackedCustomResourceRows';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useNamespaceGridTablePersistence } from '@modules/namespace/hooks/useNamespaceGridTablePersistence';
import { useQueryResourceGridTable } from '@modules/resource-grid/useResourceGridTable';
import * as cf from '@shared/components/tables/columnFactories';
import { TABLE_PAGE_SIZE_OPTIONS } from '@shared/components/tables/pageSizeOptions';
import React, { useMemo } from 'react';

// Data interface for custom resources
export type CustomResourceData = CustomResourceGridRow;

interface CustomViewProps {
  namespace: string;
  showNamespaceColumn?: boolean;
}

/**
 * GridTable component for namespace custom resources (instances of CRDs)
 */
const CustomViewGrid: React.FC<CustomViewProps> = React.memo(
  ({ namespace, showNamespaceColumn = false }) => {
    const parts = useCustomResourceGridParts({ kindFallback: 'Custom' });
    const { keyExtractor, selectedClusterId } = parts;
    const namespaceColumnLink = useNamespaceColumnLink<CustomResourceData>('custom');

    const columns = useMemo(() => {
      if (!showNamespaceColumn) {
        return parts.baseColumns;
      }
      const withNamespace = [...parts.baseColumns];
      cf.upsertNamespaceColumn(withNamespace, {
        accessor: (resource) => resource.ref.namespace,
        sortValue: (resource) => (resource.ref.namespace || '').toLowerCase(),
        ...namespaceColumnLink,
      });
      return withNamespace;
    }, [namespaceColumnLink, parts.baseColumns, showNamespaceColumn]);

    const showNamespaceFilter = namespace === ALL_NAMESPACES_SCOPE;
    const diagnosticsLabel =
      namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces Custom' : 'Namespace Custom';

    const persistenceState = useNamespaceGridTablePersistence<CustomResourceData>({
      viewId: 'namespace-custom',
      namespace,
      columns,
      keyExtractor,
      defaultSort: { key: 'name', direction: 'asc' },
      data: [],
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
      pageSizeOptions: TABLE_PAGE_SIZE_OPTIONS,
    });
    const persistence = persistenceState.persistence;

    const catalog = useCatalogBackedCustomResourceRows({
      clusterId: selectedClusterId,
      namespace,
      allNamespaces: namespace === ALL_NAMESPACES_SCOPE,
      persistence,
      diagnosticLabel: diagnosticsLabel,
    });
    const {
      filterOptions: catalogFilterOptions,
      totalCount,
      unfilteredTotal,
      totalIsExact,
    } = catalog;

    const { gridTableProps, favModal } = useQueryResourceGridTable<CustomResourceData>({
      tableMode: 'Query Backed Static',
      data: catalog.rows,
      columns,
      persistence,
      keyExtractor,
      defaultSortKey: 'name',
      defaultSortDirection: 'asc',
      diagnosticsLabel,
      filterOptions: {
        searchBehavior: 'query',
        kinds: catalogFilterOptions.kinds,
        namespaces: showNamespaceFilter ? catalogFilterOptions.namespaces : undefined,
        showKindDropdown: true,
        showNamespaceDropdown: showNamespaceFilter,
        namespaceDropdownSearchable: showNamespaceFilter,
        namespaceDropdownBulkActions: showNamespaceFilter,
        totalCount,
        unfilteredTotal,
        totalIsExact,
        partialDataLabel: catalogFilterOptions.partialDataLabel,
      },
    });

    const emptyText = `No custom objects found ${
      namespace === ALL_NAMESPACES_SCOPE ? 'in any namespaces' : 'in this namespace'
    }`;

    return (
      <CustomResourceGridFrame
        parts={parts}
        catalog={catalog}
        gridTableProps={gridTableProps}
        favModal={favModal}
        columns={columns}
        idPrefix="namespace-custom"
        cacheKeySuffix={namespace}
        exportFilename="custom-resources"
        spinnerMessage="Loading custom resources..."
        diagnosticsLabel={diagnosticsLabel}
        tableClassName="ns-custom-table"
        emptyText={emptyText}
      />
    );
  }
);

CustomViewGrid.displayName = 'NsViewCustom';

export default CustomViewGrid;
