/**
 * frontend/src/modules/cluster/components/ClusterViewRBAC.tsx
 *
 * GridTable view for cluster RBAC resources (ClusterRoles and
 * ClusterRoleBindings) in a single aggregated table.
 */

import {
  type AggregatedResourceGridViewSpec,
  ClusterAggregatedResourceGridView,
} from '@modules/resource-grid/AggregatedResourceGridView';
import * as cf from '@shared/components/tables/columnFactories';
import React from 'react';
import type { ClusterRBACEntry, ClusterRBACSnapshotPayload } from '@/core/refresh/types';
import { getDisplayKind } from '@/utils/kindAliasMap';

type RBACData = ClusterRBACEntry & { kindAlias?: string };

// Define props for RBACViewGrid component
interface RBACViewProps {
  error?: string | null;
}

const rbacSpec: AggregatedResourceGridViewSpec<RBACData> = {
  domain: 'cluster-rbac',
  viewId: 'cluster-rbac',
  labels: { cluster: 'Cluster RBAC' },
  emptyMessage: () => 'No cluster-scoped RBAC objects found',
  spinnerMessage: 'Loading RBAC resources...',
  tableClassName: 'gridtable-rbac',
  showKindDropdown: true,
  buildColumns: ({ identity, useShortResourceNames }) => [
    cf.createKindColumn<RBACData>({
      key: 'kind',
      getKind: (resource) => resource.kind,
      getAlias: (resource) => resource.kindAlias,
      getDisplayText: (resource) => getDisplayKind(resource.kind, useShortResourceNames),
      onClick: identity.open,
      onAltClick: identity.navigate,
    }),
    cf.createTextColumn<RBACData>('name', 'Name', (resource) => resource.name, {
      sortable: true,
      onClick: identity.open,
      onAltClick: identity.navigate,
      getClassName: () => 'object-panel-link',
    }),
    cf.createAgeColumn(),
  ],
};

/**
 * GridTable component for cluster RBAC resources
 * Shows ClusterRoles and ClusterRoleBindings in a single aggregated table
 */
const RBACViewGrid: React.FC<RBACViewProps> = React.memo(({ error }) => (
  <ClusterAggregatedResourceGridView<ClusterRBACSnapshotPayload, RBACData>
    spec={rbacSpec}
    error={error}
  />
));

RBACViewGrid.displayName = 'ClusterViewRBAC';

export default RBACViewGrid;
