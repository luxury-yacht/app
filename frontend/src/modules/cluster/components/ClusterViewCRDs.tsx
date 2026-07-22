/**
 * frontend/src/modules/cluster/components/ClusterViewCRDs.tsx
 *
 * GridTable view for cluster Custom Resource Definitions.
 */

import {
  type AggregatedResourceGridViewSpec,
  ClusterAggregatedResourceGridView,
} from '@modules/resource-grid/AggregatedResourceGridView';
import * as cf from '@shared/components/tables/columnFactories';
import React from 'react';
import type { ClusterCRDEntry, ClusterCRDSnapshotPayload } from '@/core/refresh/types';
import { getDisplayKind } from '@/utils/kindAliasMap';

type CRDsData = ClusterCRDEntry & { kindAlias?: string };

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
  error?: string | null;
}

const crdsSpec: AggregatedResourceGridViewSpec<CRDsData> = {
  domain: 'cluster-crds',
  viewId: 'cluster-crds',
  labels: { cluster: 'Cluster CRDs' },
  emptyMessage: () => 'No CRDs found',
  spinnerMessage: 'Loading CRDs...',
  tableClassName: 'gridtable-crds',
  filterOptions: () => ({ isNamespaceScoped: false }),
  buildColumns: ({ identity, useShortResourceNames }) => [
    cf.createKindColumn<CRDsData>({
      key: 'kind',
      getKind: (crd) => crd.ref.kind || 'CustomResourceDefinition',
      getDisplayText: (crd) =>
        getDisplayKind(crd.ref.kind || 'CustomResourceDefinition', useShortResourceNames),
      onClick: identity.open,
      onAltClick: identity.navigate,
    }),
    cf.createTextColumn<CRDsData>('name', 'Name', (crd) => crd.ref.name, {
      sortable: true,
      onClick: identity.open,
      onAltClick: identity.navigate,
      getTitle: (crd) => `Open ${crd.ref.name}`,
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
  ],
};

/**
 * GridTable component for cluster Custom Resource Definitions
 */
const CRDsViewGrid: React.FC<CRDsViewProps> = React.memo(({ error }) => (
  <ClusterAggregatedResourceGridView<ClusterCRDSnapshotPayload, CRDsData>
    spec={crdsSpec}
    error={error}
  />
));

CRDsViewGrid.displayName = 'ClusterCRDsView';

export default CRDsViewGrid;
