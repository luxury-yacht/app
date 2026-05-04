/**
 * frontend/src/modules/cluster/components/ClusterViewCustom.tsx
 *
 * UI component for ClusterViewCustom.
 * Handles rendering and interactions for the cluster feature.
 */

import './ClusterViewCustom.css';
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { getDisplayKind } from '@/utils/kindAliasMap';
import { resolveEmptyStateMessage } from '@/utils/emptyState';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useShortNames } from '@/hooks/useShortNames';
import * as cf from '@shared/components/tables/columnFactories';
import React, { useMemo, useCallback } from 'react';
import ResourceGridTableView from '@shared/components/tables/ResourceGridTableView';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { type GridColumnDefinition } from '@shared/components/tables/GridTable';
import { useClusterResourceGridTable } from '@shared/hooks/useResourceGridTable';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';

// Define the data structure for cluster custom resources
interface ClusterCustomData {
  kind: string;
  kindAlias?: string;
  name: string;
  clusterId: string;
  clusterName?: string;
  apiGroup?: string;
  /** API version for the owning CRD. Paired with apiGroup so the object
   * panel can disambiguate colliding Kinds across API groups.
   */
  apiVersion?: string;
  /**
   * Canonical CRD name (`<plural>.<group>`) for the CustomResourceDefinition
   * that defines this resource's Kind. Threaded from the backend
   * ClusterCustomSummary so the CRD column can render a clickable cell
   * that opens the owning CRD in the object panel.
   */
  crdName?: string;
  age?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

// Define props for ClusterViewCustom component
interface ClusterCustomViewProps {
  data: ClusterCustomData[];
  availableKinds?: string[];
  loading?: boolean;
  loaded?: boolean;
  error?: string | null;
}

/**
 * GridTable component for cluster custom resources
 * Displays various custom resources in the cluster
 */
const ClusterViewCustom: React.FC<ClusterCustomViewProps> = React.memo(
  ({ data, availableKinds: kindOptions, loading = false, loaded = false, error }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const { selectedClusterId } = useKubeconfig();
    const useShortResourceNames = useShortNames();

    const handleResourceClick = useCallback(
      (resource: ClusterCustomData) => {
        // Preserve metadata and age so the object panel shows labels/annotations and Age.
        // CRITICAL: pass apiGroup/apiVersion so downstream scope/capability
        // resolution can disambiguate colliding Kinds. See
        //  step 1.
        openWithObject(
          buildRequiredObjectReference(
            {
              kind: resource.kind,
              name: resource.name,
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
    // built-in lookup table, not from row data. Mirrors NsViewCustom.
    const handleCRDClick = useCallback(
      (resource: ClusterCustomData) => {
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
      (resource: ClusterCustomData) =>
        buildRequiredCanonicalObjectRowKey(
          {
            kind: resource.kind,
            name: resource.name,
            clusterId: resource.clusterId,
            group: resource.apiGroup,
            version: resource.apiVersion,
          },
          { fallbackClusterId: selectedClusterId }
        ),
      [selectedClusterId]
    );

    // Define columns for the custom resources
    const columns: GridColumnDefinition<ClusterCustomData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<ClusterCustomData>[] = [
        cf.createKindColumn<ClusterCustomData>({
          key: 'kind',
          getKind: (resource) => resource.kind,
          getAlias: (resource) => resource.kindAlias,
          getDisplayText: (resource) => getDisplayKind(resource.kind, useShortResourceNames),
          onClick: handleResourceClick,
          onAltClick: (resource) =>
            navigateToView(
              buildRequiredObjectReference(
                {
                  kind: resource.kind,
                  name: resource.name,
                  clusterId: resource.clusterId,
                  clusterName: resource.clusterName,
                  group: resource.apiGroup,
                  version: resource.apiVersion,
                },
                { fallbackClusterId: selectedClusterId }
              )
            ),
        }),
        cf.createTextColumn<ClusterCustomData>('name', 'Name', {
          sortable: true,
          onClick: handleResourceClick,
          onAltClick: (resource) =>
            navigateToView(
              buildRequiredObjectReference(
                {
                  kind: resource.kind,
                  name: resource.name,
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
        // that defines the row's Kind. Replaces the previous API Group
        // column — `<plural>.<group>` is a strict superset of the group
        // alone (the group is the right-hand side of the dot), and the
        // clickable link adds a navigation path the old column lacked.
        // The column key is "crd" but the data field is "crdName", so
        // we attach an explicit `sortValue` — without it, useTableSort
        // would fall back to `row["crd"]` (undefined) and silently
        // fail to sort. Matches NsViewCustom's CRD column exactly.
        (() => {
          const crdColumn = cf.createTextColumn<ClusterCustomData>(
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
        age: { autoWidth: true },
      };
      cf.applyColumnSizing(baseColumns, sizing);

      return baseColumns;
    }, [
      handleResourceClick,
      handleCRDClick,
      navigateToView,
      selectedClusterId,
      useShortResourceNames,
    ]);

    const { gridTableProps, favModal } = useClusterResourceGridTable<ClusterCustomData>({
      viewId: 'cluster-custom',
      data,
      columns,
      keyExtractor,
      availableKinds: kindOptions ?? [],
      showKindDropdown: true,
      kindDropdownSearchable: true,
      kindDropdownBulkActions: true,
      filterOptions: { isNamespaceScoped: false },
    });

    const objectActions = useObjectActionController({
      context: 'gridtable',
      queryMissingPermissions: true,
      onOpen: (object) => openWithObject(object),
    });

    // Get context menu items
    const getContextMenuItems = useCallback(
      (resource: ClusterCustomData): ContextMenuItem[] => {
        return objectActions.getMenuItems(
          buildRequiredObjectReference(
            {
              kind: resource.kind,
              name: resource.name,
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

    // Resolve empty state message
    const emptyMessage = useMemo(
      () => resolveEmptyStateMessage(error, 'No cluster-scoped custom objects found'),
      [error]
    );

    return (
      <>
        <ResourceGridTableView
          gridTableProps={gridTableProps}
          boundaryLoading={loading ?? false}
          loaded={loaded}
          spinnerMessage="Loading cluster custom resources..."
          favModal={favModal}
          columns={columns}
          diagnosticsLabel="Cluster Custom"
          loading={loading}
          keyExtractor={keyExtractor}
          onRowClick={handleResourceClick}
          tableClassName="cluster-custom-table"
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

ClusterViewCustom.displayName = 'ClusterViewCustom';

export default ClusterViewCustom;
