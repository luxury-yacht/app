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
import { argoCDColumns } from './argoCDColumns';

const CUSTOM_VIEW = {
  viewId: 'namespace-custom',
  label: 'Custom',
  objectLabel: 'custom',
  spinner: 'Loading custom resources...',
  exportFilename: 'custom-resources',
};
const ARGOCD_VIEW = {
  viewId: 'namespace-argocd',
  label: 'Argo CD',
  objectLabel: 'Argo CD',
  spinner: 'Loading Argo CD resources...',
  exportFilename: 'argocd-resources',
};

// Data interface for custom resources
export type CustomResourceData = CustomResourceGridRow;

interface CustomViewProps {
  namespace: string;
  resourceFamily?: 'argocd';
  showNamespaceColumn?: boolean;
}

/**
 * GridTable component for namespace custom resources (instances of CRDs)
 */
const CustomViewGrid: React.FC<CustomViewProps> = React.memo(
  ({ namespace, resourceFamily, showNamespaceColumn = false }) => {
    const parts = useCustomResourceGridParts({ kindFallback: 'Custom' });
    const { keyExtractor, selectedClusterId } = parts;
    const namespaceColumnLink = useNamespaceColumnLink<CustomResourceData>(
      resourceFamily ?? 'custom'
    );

    const config = resourceFamily ? ARGOCD_VIEW : CUSTOM_VIEW;
    const columns = useMemo(() => {
      const baseColumns = resourceFamily
        ? argoCDColumns({ baseColumns: parts.baseColumns })
        : parts.baseColumns;
      if (!showNamespaceColumn) {
        return baseColumns;
      }
      return cf.withNamespaceColumn(baseColumns, {
        afterColumnKey: 'name',
        accessor: (resource) => resource.ref.namespace,
        sortValue: (resource) => (resource.ref.namespace || '').toLowerCase(),
        ...namespaceColumnLink,
      });
    }, [namespaceColumnLink, parts.baseColumns, showNamespaceColumn, resourceFamily]);

    const showNamespaceFilter = namespace === ALL_NAMESPACES_SCOPE;
    const diagnosticsLabel = `${namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces' : 'Namespace'} ${config.label}`;

    const persistenceState = useNamespaceGridTablePersistence<CustomResourceData>({
      viewId: config.viewId,
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
      resourceFamily,
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
      supportsCustomMetadataColumns: true,
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

    const emptyText = `No ${config.objectLabel} objects found ${
      namespace === ALL_NAMESPACES_SCOPE ? 'in any namespaces' : 'in this namespace'
    }`;

    return (
      <CustomResourceGridFrame
        parts={parts}
        catalog={catalog}
        gridTableProps={gridTableProps}
        favModal={favModal}
        columns={columns}
        idPrefix={config.viewId}
        cacheKeySuffix={namespace}
        exportFilename={config.exportFilename}
        spinnerMessage={config.spinner}
        diagnosticsLabel={diagnosticsLabel}
        tableClassName="ns-custom-table"
        emptyText={emptyText}
      />
    );
  }
);

CustomViewGrid.displayName = 'NsViewCustom';

export const NsViewArgoCD = ({ namespace }: { namespace: string }) => (
  <CustomViewGrid namespace={namespace} resourceFamily="argocd" />
);

export default CustomViewGrid;
