/**
 * frontend/src/modules/namespace/components/NsViewCustom.tsx
 *
 * UI component for NsViewCustom.
 * Handles rendering and interactions for the namespace feature.
 */

import './NsViewCustom.css';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useShortNames } from '@/hooks/useShortNames';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import * as cf from '@shared/components/tables/columnFactories';
import React, { useMemo, useCallback } from 'react';
import ResourceGridTableView from '@shared/components/tables/ResourceGridTableView';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { useNamespaceResourceGridTable } from '@shared/hooks/useResourceGridTable';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';

// Data interface for custom resources
export interface CustomResourceData {
  kind?: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  // Multi-cluster metadata used for per-tab actions and stable row keys.
  clusterId: string;
  clusterName?: string;
  apiGroup?: string;
  apiVersion?: string;
  /**
   * Canonical CRD name (`<plural>.<group>`) for the CustomResourceDefinition
   * that defines this resource's Kind. Threaded from the backend
   * NamespaceCustomSummary so the CRD column can render a clickable cell
   * that opens the owning CRD in the object panel.
   */
  crdName?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  spec?: {
    image?: string;
    url?: string;
    host?: string;
    endpoint?: string;
    serviceName?: string;
    replicas?: number;
    [key: string]: any;
  };
  status?: {
    phase?: string;
    state?: string;
    conditions?: Array<{
      kind: string;
      status: string;
    }>;
    replicas?: number;
    url?: string;
    endpoint?: string;
    [key: string]: any;
  };
  age?: string;
  [key: string]: any; // Allow additional fields
}

interface CustomViewProps {
  namespace: string;
  data: CustomResourceData[];
  availableKinds?: string[];
  loading?: boolean;
  loaded?: boolean;
  showNamespaceColumn?: boolean;
}

/**
 * GridTable component for namespace custom resources (instances of CRDs)
 */
const CustomViewGrid: React.FC<CustomViewProps> = React.memo(
  ({
    namespace,
    data,
    availableKinds: kindOptions,
    loading = false,
    loaded = false,
    showNamespaceColumn = false,
  }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const { selectedClusterId } = useKubeconfig();
    const useShortResourceNames = useShortNames();
    const namespaceColumnLink = useNamespaceColumnLink<CustomResourceData>('custom');

    const handleResourceClick = useCallback(
      (resource: CustomResourceData) => {
        // Preserve metadata and age so the object panel shows labels/annotations and Age.
        // CRITICAL: pass apiGroup/apiVersion so downstream scope/capability
        // resolution can disambiguate colliding Kinds (e.g. two DBInstance
        // CRDs from different operators). Without these, the object panel
        // falls back to first-match-wins discovery and opens the wrong
        // resource.
        openWithObject(
          buildRequiredObjectReference(
            {
              kind: resource.kind || resource.kindAlias || 'CustomResource',
              kindAlias: resource.kindAlias,
              name: resource.name,
              namespace: resource.namespace,
              group: resource.apiGroup,
              version: resource.apiVersion,
              clusterId: resource.clusterId,
              clusterName: resource.clusterName ?? undefined,
            },
            { fallbackClusterId: selectedClusterId },
            {
              age: resource.age,
              labels: resource.labels,
              annotations: resource.annotations,
            }
          )
        );
      },
      [openWithObject, selectedClusterId]
    );

    // Click handler for the CRD column. Opens the owning
    // CustomResourceDefinition in the object panel — the CRD itself is
    // a built-in (apiextensions.k8s.io/v1) so its GVK comes from the
    // built-in lookup table, not from row data.
    const handleCRDClick = useCallback(
      (resource: CustomResourceData) => {
        if (!resource.crdName) {
          return;
        }
        openWithObject(
          buildRequiredObjectReference(
            {
              kind: 'CustomResourceDefinition',
              name: resource.crdName,
              clusterId: resource.clusterId,
              clusterName: resource.clusterName ?? undefined,
            },
            { fallbackClusterId: selectedClusterId },
            {
              age: resource.age,
              labels: resource.labels,
              annotations: resource.annotations,
              requiresExplicitVersion: true,
              explicitVersionProvided: Boolean(resource.apiVersion),
            }
          )
        );
      },
      [openWithObject, selectedClusterId]
    );

    const keyExtractor = useCallback(
      (resource: CustomResourceData) =>
        buildRequiredCanonicalObjectRowKey(
          {
            kind: resource.kind || resource.kindAlias || 'CustomResource',
            name: resource.name,
            namespace: resource.namespace,
            clusterId: resource.clusterId,
            group: resource.apiGroup,
            version: resource.apiVersion,
          },
          { fallbackClusterId: selectedClusterId }
        ),
      [selectedClusterId]
    );

    const columns: GridColumnDefinition<CustomResourceData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<CustomResourceData>[] = [
        cf.createKindColumn<CustomResourceData>({
          getKind: (resource) => resource.kind || resource.kindAlias || 'Custom',
          getAlias: (resource) => resource.kindAlias,
          getDisplayText: (resource) =>
            getDisplayKind(resource.kind || resource.kindAlias || 'Custom', useShortResourceNames),
          onClick: handleResourceClick,
          onAltClick: (resource) =>
            navigateToView(
              buildRequiredObjectReference(
                {
                  kind: resource.kind || resource.kindAlias || 'CustomResource',
                  kindAlias: resource.kindAlias,
                  name: resource.name,
                  namespace: resource.namespace,
                  clusterId: resource.clusterId,
                  clusterName: resource.clusterName,
                  group: resource.apiGroup,
                  version: resource.apiVersion,
                },
                { fallbackClusterId: selectedClusterId }
              )
            ),
        }),
        cf.createTextColumn<CustomResourceData>('name', 'Name', {
          onClick: handleResourceClick,
          onAltClick: (resource) =>
            navigateToView(
              buildRequiredObjectReference(
                {
                  kind: resource.kind || resource.kindAlias || 'CustomResource',
                  kindAlias: resource.kindAlias,
                  name: resource.name,
                  namespace: resource.namespace,
                  clusterId: resource.clusterId,
                  clusterName: resource.clusterName,
                  group: resource.apiGroup,
                  version: resource.apiVersion,
                },
                { fallbackClusterId: selectedClusterId }
              )
            ),
          getClassName: () => 'object-panel-link',
        }),
        // CRD column: each cell is a clickable link back to the CRD
        // that defines the row's Kind. The cell hides itself (renders
        // as the column factory's default placeholder) for rows that
        // happen to have no `crdName` — e.g. legacy snapshots from
        // before the field was added.
        //
        // The column key is "crd" but the field on CustomResourceData
        // is "crdName", so we attach an explicit `sortValue` accessor.
        // Without it, useTableSort falls back to `row[column.key]`
        // (i.e. `resource['crd']`), gets undefined for every row, and
        // the column silently doesn't sort at all.
        (() => {
          const crdColumn = cf.createTextColumn<CustomResourceData>(
            'crd',
            'CRD',
            (resource) => resource.crdName ?? undefined,
            {
              onClick: handleCRDClick,
              onAltClick: (resource) => {
                if (!resource.crdName) {
                  return;
                }
                navigateToView(
                  buildRequiredObjectReference(
                    {
                      kind: 'CustomResourceDefinition',
                      name: resource.crdName,
                      clusterId: resource.clusterId,
                      clusterName: resource.clusterName,
                    },
                    { fallbackClusterId: selectedClusterId }
                  )
                );
              },
              isInteractive: (resource) => Boolean(resource.crdName),
              getClassName: (resource) => (resource.crdName ? 'object-panel-link' : undefined),
              getTitle: (resource) => (resource.crdName ? `Open ${resource.crdName}` : undefined),
            }
          );
          crdColumn.sortValue = (resource) => (resource.crdName ?? '').toLowerCase();
          return crdColumn;
        })(),
        cf.createAgeColumn(),
      ];

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        name: { autoWidth: true },
        crd: { autoWidth: true },
        namespace: { autoWidth: true },
        age: { autoWidth: true },
      };
      cf.applyColumnSizing(baseColumns, sizing);

      if (showNamespaceColumn) {
        cf.upsertNamespaceColumn(baseColumns, {
          accessor: (resource) => resource.namespace,
          sortValue: (resource) => (resource.namespace || '').toLowerCase(),
          ...namespaceColumnLink,
        });
      }

      return baseColumns;
    }, [
      handleResourceClick,
      handleCRDClick,
      namespaceColumnLink,
      navigateToView,
      selectedClusterId,
      showNamespaceColumn,
      useShortResourceNames,
    ]);

    const showNamespaceFilter = namespace === ALL_NAMESPACES_SCOPE;
    const diagnosticsLabel =
      namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces Custom' : 'Namespace Custom';

    const { gridTableProps, favModal } = useNamespaceResourceGridTable<CustomResourceData>({
      viewId: 'namespace-custom',
      namespace,
      data,
      columns,
      keyExtractor,
      defaultSort: { key: 'name', direction: 'asc' },
      availableKinds: kindOptions ?? [],
      showKindDropdown: true,
      kindDropdownSearchable: true,
      kindDropdownBulkActions: true,
      showNamespaceFilters: showNamespaceFilter,
      diagnosticsLabel,
      filterOptions: { isNamespaceScoped: namespace !== ALL_NAMESPACES_SCOPE },
    });

    const objectActions = useObjectActionController({
      context: 'gridtable',
      queryMissingPermissions: true,
      onOpen: (object) => openWithObject(object),
    });

    const getContextMenuItems = useCallback(
      (resource: CustomResourceData): ContextMenuItem[] => {
        const kind = resource.kind || resource.kindAlias || 'CustomResource';
        return objectActions.getMenuItems(
          buildRequiredObjectReference(
            {
              kind,
              kindAlias: resource.kindAlias,
              name: resource.name,
              namespace: resource.namespace,
              clusterId: resource.clusterId,
              clusterName: resource.clusterName,
              group: resource.apiGroup ?? undefined,
              version: resource.apiVersion ?? undefined,
            },
            { fallbackClusterId: selectedClusterId },
            {
              age: resource.age,
              labels: resource.labels,
              annotations: resource.annotations,
              requiresExplicitVersion: true,
              explicitVersionProvided: Boolean(resource.apiVersion),
            }
          )
        );
      },
      [objectActions, selectedClusterId]
    );

    const emptyMessage = useMemo(
      () =>
        resolveEmptyStateMessage(
          undefined,
          `No custom objects found ${namespace === ALL_NAMESPACES_SCOPE ? 'in any namespaces' : 'in this namespace'}`
        ),
      [namespace]
    );

    return (
      <>
        <ResourceGridTableView
          gridTableProps={gridTableProps}
          boundaryLoading={loading ?? false}
          loaded={loaded}
          spinnerMessage="Loading custom resources..."
          favModal={favModal}
          columns={columns}
          diagnosticsLabel={diagnosticsLabel}
          loading={loading}
          keyExtractor={keyExtractor}
          onRowClick={handleResourceClick}
          tableClassName="ns-custom-table"
          enableContextMenu={true}
          getCustomContextMenuItems={getContextMenuItems}
          useShortNames={useShortResourceNames}
          emptyMessage={emptyMessage}
        />

        {objectActions.modals}
      </>
    );
  }
);

CustomViewGrid.displayName = 'NsViewCustom';

export default CustomViewGrid;
