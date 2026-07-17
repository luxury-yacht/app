import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import ResourceInventoryTable from '@modules/resource-grid/ResourceInventoryTable';
import { selectPayloadRows } from '@modules/resource-grid/typedResourceQueryScope';
import { useQueryBackedClusterResourceGridTable } from '@modules/resource-grid/useQueryBackedResourceGridTable';
import type { ContextMenuItem } from '@shared/components/ContextMenu';
import { SettingsIcon } from '@shared/components/icons/SharedIcons';
import { StatusChip, type StatusChipVariant } from '@shared/components/StatusChip';
import * as cf from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { useGridTableExternalFilters } from '@shared/components/tables/hooks/useGridTableExternalFilters';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
} from '@shared/utils/objectIdentity';
import { useCallback, useMemo, useState } from 'react';
import type { ClusterAttentionFinding, ClusterAttentionSnapshot } from '@/core/refresh/types';
import {
  ignoreClusterAttentionFindingType,
  ignoreClusterAttentionObjectFinding,
  ignoreGlobalAttentionFindingType,
  restoreClusterAttentionFindingType,
  restoreClusterAttentionObjectFinding,
  restoreGlobalAttentionFindingType,
} from '@/core/settings/clusterAttentionIgnores';
import { useShortNames } from '@/hooks/useShortNames';
import { errorHandler } from '@/utils/errorHandler';
import { getDisplayKind } from '@/utils/kindAliasMap';
import AttentionIgnoredModal from './AttentionIgnoredModal';
import './ClusterViewAttention.css';

const severityChipVariants = {
  info: 'info',
  warning: 'warning',
  error: 'unhealthy',
} satisfies Record<ClusterAttentionFinding['severity'], StatusChipVariant>;

const compactFindingText = (values: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const trimmed = value.trim();
    const key = trimmed.toLocaleLowerCase();
    if (!trimmed || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(trimmed);
  }
  return result;
};

const renderFinding = (row: ClusterAttentionFinding) => {
  const causes = row.causes ?? [];
  const labels = compactFindingText(causes.map((cause) => cause.label));
  const status = row.status.trim();
  const details = compactFindingText([
    ...(status.toLocaleLowerCase() === row.severity.toLocaleLowerCase() ? [] : [status]),
    ...causes.map((cause) => cause.message),
  ]);

  return (
    <div className="attention-finding-cell">
      <span className="attention-finding-labels">{labels.join(' · ') || '-'}</span>
      {details.length > 0 && (
        <span className="attention-finding-details">{details.join(' · ')}</span>
      )}
    </div>
  );
};

export default function ClusterViewAttention() {
  const { selectedClusterId } = useKubeconfig();
  const { openWithObject } = useObjectPanel();
  const { navigateToView } = useNavigateToView();
  const useShortResourceNames = useShortNames();
  const [ignoredModalOpen, setIgnoredModalOpen] = useState(false);

  const reportIgnoreError = useCallback((error: unknown, action: string) => {
    errorHandler.handle(error instanceof Error ? error : new Error(String(error)), { action });
  }, []);

  const objectReference = useCallback(
    (row: ClusterAttentionFinding) =>
      buildRequiredObjectReference(row.ref, { fallbackClusterId: selectedClusterId }),
    [selectedClusterId]
  );
  const openObject = useCallback(
    (row: ClusterAttentionFinding) => openWithObject(objectReference(row)),
    [objectReference, openWithObject]
  );
  const navigateObject = useCallback(
    (row: ClusterAttentionFinding) => navigateToView(objectReference(row)),
    [navigateToView, objectReference]
  );

  const columns = useMemo<GridColumnDefinition<ClusterAttentionFinding>[]>(() => {
    const result: GridColumnDefinition<ClusterAttentionFinding>[] = [
      cf.createKindColumn<ClusterAttentionFinding>({
        getKind: (row) => row.kind,
        getDisplayText: (row) => getDisplayKind(row.kind, useShortResourceNames),
        onClick: openObject,
        onAltClick: navigateObject,
      }),
      cf.createTextColumn('namespace', 'Namespace', (row) => row.namespace || '-'),
      cf.createTextColumn('name', 'Name', (row) => row.name, {
        onClick: openObject,
        onAltClick: navigateObject,
        getClassName: () => 'object-panel-link',
      }),
      {
        key: 'severity',
        header: 'Severity',
        sortable: true,
        sortValue: (row) => row.severity,
        render: (row) => (
          <StatusChip variant={severityChipVariants[row.severity]}>{row.severity}</StatusChip>
        ),
      },
      {
        key: 'reason',
        header: 'Finding',
        sortable: true,
        sortValue: (row) =>
          compactFindingText((row.causes ?? []).map((cause) => cause.label)).join(', '),
        render: renderFinding,
      },
      cf.createAgeColumn<ClusterAttentionFinding>('age', 'Age', (row) => row.age),
    ];
    cf.applyColumnSizing(result, {
      kind: { autoWidth: true },
      name: { width: 220 },
      namespace: { width: 180 },
      severity: { autoWidth: true },
      reason: { width: 320 },
      age: { autoWidth: true },
    });
    return result;
  }, [navigateObject, openObject, useShortResourceNames]);

  const keyExtractor = useCallback(
    (row: ClusterAttentionFinding) =>
      buildRequiredCanonicalObjectRowKey(row.ref, { fallbackClusterId: selectedClusterId }),
    [selectedClusterId]
  );

  const getCustomContextMenuItems = useCallback(
    (row: ClusterAttentionFinding): ContextMenuItem[] => {
      const causes = row.causes ?? [];
      const seenTypes = new Set<string>();
      const items: ContextMenuItem[] = [];
      for (const cause of causes) {
        if (seenTypes.has(cause.type)) {
          continue;
        }
        seenTypes.add(cause.type);
        items.push({
          actionId: `attention-ignore-object-finding:${cause.type}`,
          label: `Ignore "${cause.label}" for this object only`,
          disabled: !row.ref.uid,
          disabledReason: !row.ref.uid ? 'The object has no UID' : undefined,
          onClick: () => {
            void ignoreClusterAttentionObjectFinding(selectedClusterId, row.ref, cause.type).catch(
              (error) => reportIgnoreError(error, 'ignoreAttentionObjectFinding')
            );
          },
        });
        items.push({
          actionId: `attention-ignore-cluster-type:${cause.type}`,
          label: `Ignore "${cause.label}" in this cluster`,
          onClick: () => {
            void ignoreClusterAttentionFindingType(selectedClusterId, cause.type).catch((error) =>
              reportIgnoreError(error, 'ignoreAttentionFindingType')
            );
          },
        });
        items.push({
          actionId: `attention-ignore-global-type:${cause.type}`,
          label: `Ignore "${cause.label}" in all clusters`,
          onClick: () => {
            void ignoreGlobalAttentionFindingType(selectedClusterId, cause.type).catch((error) =>
              reportIgnoreError(error, 'ignoreGlobalAttentionFindingType')
            );
          },
        });
      }
      return items;
    },
    [reportIgnoreError, selectedClusterId]
  );

  const filterOptionOverrides = useMemo(
    () => ({
      postActions: [
        { type: 'separator' as const },
        {
          type: 'action' as const,
          id: 'attention-ignored-findings',
          icon: <SettingsIcon width={18} height={18} />,
          title: 'Manage ignored findings',
          onClick: () => setIgnoredModalOpen(true),
        },
      ],
    }),
    []
  );

  const { gridTableProps, favModal, source, queryPayload, persistence } =
    useQueryBackedClusterResourceGridTable<ClusterAttentionSnapshot, ClusterAttentionFinding>({
      queryTableMode: 'Query Backed Static',
      clusterId: selectedClusterId,
      domain: 'cluster-attention',
      label: 'Cluster Attention',
      selectRows: selectPayloadRows,
      viewId: 'cluster-attention',
      columns,
      keyExtractor,
      showKindDropdown: true,
      showNamespaceFilters: true,
      defaultSortKey: 'severity',
      defaultSortDirection: 'asc',
      diagnosticsLabel: 'Cluster Attention',
      filterOptionOverrides,
    });

  useGridTableExternalFilters({
    clusterId: selectedClusterId,
    destinationViewId: 'cluster-attention',
    persistence,
  });

  const ignoreRules = queryPayload?.ignoreRules ?? {
    objectFindings: [],
    clusterFindingTypes: [],
    globalFindingTypes: [],
  };
  const findingTypes = queryPayload?.findingTypes ?? [];

  return (
    <>
      <ResourceInventoryTable
        source={source}
        gridTableProps={gridTableProps}
        spinnerMessage="Loading attention findings..."
        favModal={favModal}
        columns={columns}
        diagnosticsLabel="Cluster Attention"
        emptyMessage="No cluster objects need attention"
        enableContextMenu
        getCustomContextMenuItems={getCustomContextMenuItems}
      />
      <AttentionIgnoredModal
        isOpen={ignoredModalOpen}
        rules={ignoreRules}
        findingTypes={findingTypes}
        onRestoreObjectFinding={async (ignore) => {
          try {
            return await restoreClusterAttentionObjectFinding(
              selectedClusterId,
              ignore.ref,
              ignore.findingType
            );
          } catch (error) {
            reportIgnoreError(error, 'restoreAttentionObjectFinding');
            return ignoreRules;
          }
        }}
        onRestoreClusterType={async (findingType) => {
          try {
            return await restoreClusterAttentionFindingType(selectedClusterId, findingType);
          } catch (error) {
            reportIgnoreError(error, 'restoreAttentionFindingType');
            return ignoreRules;
          }
        }}
        onRestoreGlobalType={async (findingType) => {
          try {
            return await restoreGlobalAttentionFindingType(selectedClusterId, findingType);
          } catch (error) {
            reportIgnoreError(error, 'restoreGlobalAttentionFindingType');
            return ignoreRules;
          }
        }}
        onClose={() => setIgnoredModalOpen(false)}
      />
    </>
  );
}
