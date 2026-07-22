/**
 * frontend/src/modules/namespace/components/NsViewQuotas.tsx
 *
 * UI component for NsViewQuotas.
 * Handles rendering and interactions for the namespace feature.
 */

import {
  type AggregatedResourceGridViewSpec,
  NamespaceAggregatedResourceGridView,
} from '@modules/resource-grid/AggregatedResourceGridView';
import * as cf from '@shared/components/tables/columnFactories';
import React from 'react';
import type { NamespaceQuotaSummary, NamespaceQuotasSnapshotPayload } from '@/core/refresh/types';
import { getDisplayKind } from '@/utils/kindAliasMap';

export type QuotaData = NamespaceQuotaSummary & { kindAlias?: string };

interface QuotasViewProps {
  namespace: string;
  showNamespaceColumn?: boolean;
}

const quotasSpec: AggregatedResourceGridViewSpec<QuotaData> = {
  domain: 'namespace-quotas',
  viewId: 'namespace-quotas',
  labels: {
    namespace: 'Namespace Quotas',
    allNamespaces: 'All Namespaces Quotas',
  },
  emptyMessage: (scopeSuffix) => `No quota objects found ${scopeSuffix}`,
  spinnerMessage: 'Loading quotas...',
  tableClassName: 'ns-quotas-table',
  defaultSort: { key: 'name', direction: 'asc' },
  showKindDropdown: true,
  namespaceLinkTab: 'quotas',
  // Keep the quotas table focused on core identity fields.
  buildColumns: ({ identity, useShortResourceNames }) => [
    cf.createKindColumn<QuotaData>({
      key: 'kind',
      getKind: (resource) => resource.ref.kind,
      getAlias: (resource) => resource.kindAlias,
      getDisplayText: (resource) => getDisplayKind(resource.ref.kind, useShortResourceNames),
      onClick: identity.open,
      onAltClick: identity.navigate,
    }),
    cf.createTextColumn<QuotaData>('name', 'Name', (resource) => resource.ref.name, {
      onClick: identity.open,
      onAltClick: identity.navigate,
      getClassName: () => 'object-panel-link',
    }),
    cf.createAgeColumn(),
  ],
};

/**
 * GridTable component for namespace quota resources
 * Aggregates ResourceQuotas, LimitRanges, and PodDisruptionBudgets
 */
const QuotasViewGrid: React.FC<QuotasViewProps> = React.memo(
  ({ namespace, showNamespaceColumn = false }) => (
    <NamespaceAggregatedResourceGridView<NamespaceQuotasSnapshotPayload, QuotaData>
      spec={quotasSpec}
      namespace={namespace}
      showNamespaceColumn={showNamespaceColumn}
    />
  )
);

QuotasViewGrid.displayName = 'NsViewQuotas';

export default QuotasViewGrid;
