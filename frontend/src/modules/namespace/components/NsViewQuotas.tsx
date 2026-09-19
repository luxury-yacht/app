/**
 * frontend/src/modules/namespace/components/NsViewQuotas.tsx
 *
 * UI component for NsViewQuotas.
 * Handles rendering and interactions for the namespace feature.
 */

import {
  type AggregatedResourceGridViewSpec,
  createAggregatedIdentityColumns,
  NamespaceAggregatedResourceGridView,
} from '@modules/resource-grid/AggregatedResourceGridView';
import * as cf from '@shared/components/tables/columnFactories';
import React from 'react';
import type { NamespaceQuotaSummary, NamespaceQuotasSnapshotPayload } from '@/core/refresh/types';

export type QuotaData = NamespaceQuotaSummary & { kindAlias?: string };

interface QuotasViewProps {
  namespace: string;
  showNamespaceColumn?: boolean;
}

const quotasSpec: AggregatedResourceGridViewSpec<QuotaData> = {
  domain: 'namespace-quotas',
  viewId: 'namespace-quotas',
  supportsCustomMetadataColumns: true,
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
    ...createAggregatedIdentityColumns<QuotaData>({ identity, useShortResourceNames }),
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
