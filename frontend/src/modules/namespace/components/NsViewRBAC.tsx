/**
 * frontend/src/modules/namespace/components/NsViewRBAC.tsx
 *
 * UI component for NsViewRBAC.
 * Handles rendering and interactions for the namespace feature.
 */

import {
  type AggregatedResourceGridViewSpec,
  NamespaceAggregatedResourceGridView,
} from '@modules/resource-grid/AggregatedResourceGridView';
import * as cf from '@shared/components/tables/columnFactories';
import React from 'react';
import type { NamespaceRBACSnapshotPayload, NamespaceRBACSummary } from '@/core/refresh/types';
import { getDisplayKind } from '@/utils/kindAliasMap';

export type RBACData = NamespaceRBACSummary & { kindAlias?: string };

interface RBACViewProps {
  namespace: string;
  showNamespaceColumn?: boolean;
}

const rbacSpec: AggregatedResourceGridViewSpec<RBACData> = {
  domain: 'namespace-rbac',
  viewId: 'namespace-rbac',
  labels: {
    namespace: 'Namespace RBAC',
    allNamespaces: 'All Namespaces RBAC',
  },
  emptyMessage: (scopeSuffix) => `No RBAC objects found ${scopeSuffix}`,
  spinnerMessage: 'Loading RBAC resources...',
  tableClassName: 'ns-rbac-table',
  defaultSort: { key: 'name', direction: 'asc' },
  showKindDropdown: true,
  namespaceLinkTab: 'rbac',
  buildColumns: ({ identity, useShortResourceNames }) => [
    cf.createKindColumn<RBACData>({
      key: 'kind',
      getKind: (resource) => resource.kind,
      getAlias: (resource) => resource.kindAlias,
      getDisplayText: (resource) => getDisplayKind(resource.kind, useShortResourceNames),
      onClick: identity.open,
      onAltClick: identity.navigate,
    }),
    cf.createTextColumn<RBACData>('name', 'Name', {
      onClick: identity.open,
      onAltClick: identity.navigate,
      getClassName: () => 'object-panel-link',
    }),
    cf.createAgeColumn(),
  ],
};

/**
 * GridTable component for namespace RBAC resources
 * Aggregates Roles, RoleBindings, and ServiceAccounts
 */
const RBACViewGrid: React.FC<RBACViewProps> = React.memo(
  ({ namespace, showNamespaceColumn = false }) => (
    <NamespaceAggregatedResourceGridView<NamespaceRBACSnapshotPayload, RBACData>
      spec={rbacSpec}
      namespace={namespace}
      showNamespaceColumn={showNamespaceColumn}
    />
  )
);

RBACViewGrid.displayName = 'NsViewRBAC';

export default RBACViewGrid;
