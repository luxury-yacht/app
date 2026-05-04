/**
 * frontend/src/modules/cluster/components/ClusterViewCRDs.tsx
 *
 * UI component for ClusterViewCRDs.
 * Handles rendering and interactions for the cluster feature.
 */

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
import { useObjectActionController } from '@shared/hooks/useObjectActionController';
import { useClusterResourceGridTable } from '@shared/hooks/useResourceGridTable';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';

const CLUSTER_CRD_KIND_OPTIONS = ['CustomResourceDefinition'];

// Define the data structure for Custom Resource Definitions
interface CRDsData {
  kind: string;
  kindAlias?: string;
  name: string;
  clusterId: string;
  clusterName?: string;
  group: string;
  scope: string;
  /**
   * Storage version name (the version etcd persists). Rendered in the
   * Version column. Threaded from the backend's
   * ClusterCRDEntry.storageVersion.
   */
  storageVersion?: string;
  /** Count of additional served versions beyond the storage version. */
  extraServedVersionCount?: number;
  age?: string;
}

/**
 * Format the CRD's version cell. Single-version CRDs show just the
 * storage version (e.g. "v1"); multi-version CRDs append a `(+N)` count
 * of additional served versions (e.g. "v1 (+2)" for a CRD that also
 * serves v1beta1 and v1alpha1).
 */
const formatCRDVersionCell = (crd: CRDsData): string => {
  const storage = crd.storageVersion?.trim();
  if (!storage) {
    return '-';
  }
  const extra = crd.extraServedVersionCount ?? 0;
  return extra > 0 ? `${storage} (+${extra})` : storage;
};

// Define props for CRDsViewGrid component
interface CRDsViewProps {
  data: CRDsData[];
  loading?: boolean;
  loaded?: boolean;
  error?: string | null;
}

/**
 * GridTable component for cluster Custom Resource Definitions
 */
const CRDsViewGrid: React.FC<CRDsViewProps> = React.memo(
  ({ data, loading = false, loaded = false, error }) => {
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const { selectedClusterId } = useKubeconfig();
    const useShortResourceNames = useShortNames();

    const handleResourceClick = useCallback(
      (crd: CRDsData) => {
        openWithObject(
          buildRequiredObjectReference(
            {
              kind: 'CustomResourceDefinition',
              name: crd.name,
              clusterId: crd.clusterId,
              clusterName: crd.clusterName ?? undefined,
            },
            { fallbackClusterId: selectedClusterId }
          )
        );
      },
      [openWithObject, selectedClusterId]
    );

    const keyExtractor = useCallback(
      (crd: CRDsData) =>
        buildRequiredCanonicalObjectRowKey(
          {
            kind: 'CustomResourceDefinition',
            name: crd.name,
            clusterId: crd.clusterId,
          },
          { fallbackClusterId: selectedClusterId }
        ),
      [selectedClusterId]
    );

    // Define columns for CRDs
    const columns: GridColumnDefinition<CRDsData>[] = useMemo(() => {
      const baseColumns: GridColumnDefinition<CRDsData>[] = [
        cf.createKindColumn<CRDsData>({
          key: 'kind',
          getKind: (crd) => crd.kind || 'CustomResourceDefinition',
          getDisplayText: (crd) =>
            getDisplayKind(crd.kind || 'CustomResourceDefinition', useShortResourceNames),
          onClick: handleResourceClick,
          onAltClick: (crd) =>
            navigateToView(
              buildRequiredObjectReference(
                {
                  kind: 'CustomResourceDefinition',
                  name: crd.name,
                  clusterId: crd.clusterId,
                  clusterName: crd.clusterName,
                },
                { fallbackClusterId: selectedClusterId }
              )
            ),
        }),
        cf.createTextColumn<CRDsData>('name', 'Name', (crd) => crd.name, {
          sortable: true,
          onClick: handleResourceClick,
          onAltClick: (crd) =>
            navigateToView(
              buildRequiredObjectReference(
                {
                  kind: 'CustomResourceDefinition',
                  name: crd.name,
                  clusterId: crd.clusterId,
                  clusterName: crd.clusterName,
                },
                { fallbackClusterId: selectedClusterId }
              )
            ),
          getTitle: (crd) => `Open ${crd.name}`,
          getClassName: () => 'object-panel-link',
        }),
        cf.createTextColumn('group', 'Group', (crd) => crd.group || '-'),
        (() => {
          // Version column renders storage version with `(+N)` suffix for
          // multi-version CRDs. Sort uses bare storageVersion so that
          // sibling CRDs with the same storage version cluster together
          // regardless of whether they have additional served versions.
          //
          const versionColumn = cf.createTextColumn<CRDsData>(
            'version',
            'Version',
            formatCRDVersionCell
          );
          versionColumn.sortValue = (crd) => crd.storageVersion ?? '';
          return versionColumn;
        })(),
        cf.createTextColumn('scope', 'Scope', (crd) => crd.scope || '-'),
        cf.createAgeColumn(),
      ];

      const sizing: cf.ColumnSizingMap = {
        kind: { autoWidth: true },
        name: { autoWidth: true },
        group: { autoWidth: true },
        version: { autoWidth: true },
        scope: { autoWidth: true },
        age: { autoWidth: true },
      };
      cf.applyColumnSizing(baseColumns, sizing);

      return baseColumns;
    }, [handleResourceClick, navigateToView, selectedClusterId, useShortResourceNames]);

    const { gridTableProps, favModal } = useClusterResourceGridTable<CRDsData>({
      viewId: 'cluster-crds',
      data,
      columns,
      keyExtractor,
      availableKinds: CLUSTER_CRD_KIND_OPTIONS,
      showKindDropdown: true,
      filterOptions: { isNamespaceScoped: false },
    });

    const objectActions = useObjectActionController({
      context: 'gridtable',
      onOpen: (object) => openWithObject(object),
    });

    // Get context menu items
    const getContextMenuItems = useCallback(
      (crd: CRDsData): ContextMenuItem[] => {
        return objectActions.getMenuItems(
          buildRequiredObjectReference(
            {
              kind: 'CustomResourceDefinition',
              name: crd.name,
              clusterId: crd.clusterId,
              clusterName: crd.clusterName,
            },
            { fallbackClusterId: selectedClusterId }
          )
        );
      },
      [objectActions, selectedClusterId]
    );

    // Resolve empty state message
    const emptyMessage = useMemo(() => resolveEmptyStateMessage(error, 'No CRDs found'), [error]);

    return (
      <>
        <ResourceGridTableView
          gridTableProps={gridTableProps}
          boundaryLoading={loading ?? false}
          loaded={loaded}
          spinnerMessage="Loading CRDs..."
          favModal={favModal}
          columns={columns}
          diagnosticsLabel="Cluster CRDs"
          loading={loading}
          keyExtractor={keyExtractor}
          onRowClick={handleResourceClick}
          tableClassName="gridtable-crds"
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

CRDsViewGrid.displayName = 'ClusterCRDsView';

export default CRDsViewGrid;
