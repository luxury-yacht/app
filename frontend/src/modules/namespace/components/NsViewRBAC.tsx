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
import type { NamespaceRBACSnapshotPayload } from '@/core/refresh/types';
import { getDisplayKind } from '@/utils/kindAliasMap';

// Data interface for RBAC resources
export interface RBACData {
  kind: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  clusterId: string;
  clusterName?: string;
  // Role-specific fields
  rulesCount?: number;
  rules?: Array<{
    verbs?: string[];
    resources?: string[];
    apiGroups?: string[];
  }>;
  // RoleBinding-specific fields
  roleRef?: {
    kind?: string;
    name: string;
  };
  subjects?: Array<{
    kind: string;
    name: string;
    namespace?: string;
  }>;
  // ServiceAccount-specific fields
  secrets?: Array<{ name: string }>;
  automountServiceAccountToken?: boolean;
  roleBindings?: unknown[];
  labels?: Record<string, string>;
  age?: string;
}

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
  getIdentity: (resource) => ({
    kind: resource.kind || resource.kindAlias,
    name: resource.name,
    namespace: resource.namespace,
    clusterId: resource.clusterId,
    clusterName: resource.clusterName ?? undefined,
  }),
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
