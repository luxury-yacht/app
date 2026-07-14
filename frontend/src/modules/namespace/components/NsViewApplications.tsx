import './NsViewApplications.css';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useNamespaceColumnLink } from '@modules/namespace/components/useNamespaceColumnLink';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import { selectPayloadRows } from '@modules/resource-grid/typedResourceQueryScope';
import { useQueryBackedNamespaceResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import * as cf from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';
import { buildRequiredObjectReference } from '@shared/utils/objectIdentity';
import React, { useCallback, useMemo } from 'react';
import type {
  ApplicationConfidence,
  NamespaceApplicationSummary,
  NamespaceApplicationsSnapshotPayload,
  ResourceRef,
} from '@/core/refresh/types';
import { resolveEmptyStateMessage } from '@/utils/emptyState';

interface ApplicationsViewProps {
  namespace: string;
  showNamespaceColumn?: boolean;
}

const confidenceCopy: Record<ApplicationConfidence, string> = {
  high: 'Confirmed by active Helm release storage',
  medium: 'Linked by workload Helm metadata or a complete owner reference',
  low: 'Inferred from recommended application labels or incomplete ownership metadata',
};

const rootReference = (row: NamespaceApplicationSummary, root: ResourceRef) =>
  buildRequiredObjectReference(
    {
      clusterId: root.clusterId,
      clusterName: row.clusterName,
      group: root.group,
      version: root.version,
      kind: root.kind,
      resource: root.resource,
      namespace: root.namespace,
      name: root.name,
      uid: root.uid,
    },
    { fallbackClusterId: row.clusterId }
  );

const NsViewApplications: React.FC<ApplicationsViewProps> = React.memo(
  ({ namespace, showNamespaceColumn = false }) => {
    const { selectedClusterId } = useKubeconfig();
    const { openWithObject } = useObjectPanel();
    const { navigateToView } = useNavigateToView();
    const namespaceColumnLink = useNamespaceColumnLink<NamespaceApplicationSummary>('applications');

    const openRoot = useCallback(
      (row: NamespaceApplicationSummary) => {
        if (row.root) {
          openWithObject(rootReference(row, row.root));
        }
      },
      [openWithObject]
    );

    const navigateToRoot = useCallback(
      (row: NamespaceApplicationSummary) => {
        if (row.root) {
          navigateToView(rootReference(row, row.root));
        }
      },
      [navigateToView]
    );

    const columns = useMemo<GridColumnDefinition<NamespaceApplicationSummary>[]>(() => {
      const result: GridColumnDefinition<NamespaceApplicationSummary>[] = [
        cf.createTextColumn('name', 'Application', {
          onClick: openRoot,
          onAltClick: navigateToRoot,
          isInteractive: (row) => Boolean(row.root),
          getClassName: (row) => (row.root ? 'object-panel-link' : 'application-group-name'),
          getTitle: (row) =>
            row.root
              ? `Open ${row.root.kind} ${row.root.name}`
              : 'Grouping evidence has no navigable root object',
        }),
        {
          key: 'confidence',
          header: 'Confidence',
          sortable: true,
          sortValue: (row) => row.confidence,
          render: (row) => (
            <span
              className={`application-confidence application-confidence--${row.confidence}`}
              title={confidenceCopy[row.confidence]}
            >
              {row.confidence}
            </span>
          ),
        },
        cf.createTextColumn('status', 'Status', (row) => row.status, {
          getClassName: (row) => backendStatusTextClass(row.statusPresentation),
        }),
        cf.createTextColumn('workloadCount', 'Workloads', (row) => row.workloadCount),
        cf.createTextColumn('needsAttention', 'Needs attention', (row) => row.needsAttention),
        cf.createTextColumn(
          'workloadKinds',
          'Kinds',
          (row) => row.workloadKinds?.join(', ') || '-'
        ),
        cf.createTextColumn('evidence', 'Evidence', (row) => row.evidence?.join(', ') || '-'),
      ];

      cf.applyColumnSizing(result, {
        name: { autoWidth: true },
        namespace: { autoWidth: true },
        confidence: { autoWidth: true },
        status: { autoWidth: true },
        workloadCount: { autoWidth: true },
        needsAttention: { autoWidth: true },
      });

      if (showNamespaceColumn) {
        cf.upsertNamespaceColumn(result, {
          accessor: (row) => row.namespace,
          sortValue: (row) => row.namespace.toLowerCase(),
          ...namespaceColumnLink,
        });
      }
      return result;
    }, [namespaceColumnLink, navigateToRoot, openRoot, showNamespaceColumn]);

    const keyExtractor = useCallback(
      (row: NamespaceApplicationSummary) =>
        `${row.clusterId || selectedClusterId}|application|${row.namespace}/${row.name}`,
      [selectedClusterId]
    );
    const diagnosticsLabel =
      namespace === ALL_NAMESPACES_SCOPE ? 'All Namespaces Applications' : 'Namespace Applications';

    const { gridTableProps, favModal, source, queryPayload } =
      useQueryBackedNamespaceResourceGridTable<
        NamespaceApplicationsSnapshotPayload,
        NamespaceApplicationSummary
      >({
        queryTableMode: 'Query Backed Static',
        clusterId: selectedClusterId,
        domain: 'namespace-applications',
        label: diagnosticsLabel,
        selectRows: selectPayloadRows,
        viewId: 'namespace-applications',
        namespace,
        columns,
        keyExtractor,
        rowIdentity: keyExtractor,
        defaultSort: { key: 'name', direction: 'asc' },
        filterAccessors: {
          getKind: (row) => row.kind,
          getNamespace: (row) => row.namespace,
          getSearchText: (row) => [
            row.name,
            row.namespace,
            row.confidence,
            row.status,
            ...(row.evidence ?? []),
            ...(row.workloadKinds ?? []),
          ],
        },
        showKindDropdown: true,
        showNamespaceFilters: namespace === ALL_NAMESPACES_SCOPE,
        diagnosticsLabel,
      });

    const ungrouped = queryPayload?.ungroupedWorkloads ?? 0;
    const emptyMessage = resolveEmptyStateMessage(
      undefined,
      `No applications found ${namespace === ALL_NAMESPACES_SCOPE ? 'in any namespaces' : 'in this namespace'}`
    );

    return (
      <div className="applications-view">
        {ungrouped > 0 && (
          <div className="application-evidence-warning" role="status">
            {ungrouped} {ungrouped === 1 ? 'workload has' : 'workloads have'} no application
            evidence and {ungrouped === 1 ? 'is' : 'are'} not grouped.
          </div>
        )}
        <ResourceInventoryTable
          source={source}
          gridTableProps={gridTableProps}
          spinnerMessage="Grouping applications..."
          updatingMessage="Updating applications…"
          allowPartial
          favModal={favModal}
          columns={columns}
          diagnosticsLabel={diagnosticsLabel}
          diagnosticsMode="query"
          emptyMessage={emptyMessage}
          enableColumnVisibilityMenu
          allowHorizontalOverflow
        />
      </div>
    );
  }
);

NsViewApplications.displayName = 'NsViewApplications';

export default NsViewApplications;
