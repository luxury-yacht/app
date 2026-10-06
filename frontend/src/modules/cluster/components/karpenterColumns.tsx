import type {
  CustomResourceGridRow,
  useCustomResourceGridParts,
} from '@modules/browse/components/CustomResourceGridView';
import {
  createTextColumn,
  withAutoWidthColumns,
  withColumnSizing,
} from '@shared/components/tables/columnFactories';
import { createDetailSegmentsColumn } from '@shared/components/tables/detailSegmentsColumn';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';
import { formatLimitUsagePercent } from '@shared/utils/resourceCalculations';
import type { LimitUsage } from '@/core/refresh/types';

const usageText = (usage: LimitUsage | undefined): string =>
  usage ? formatLimitUsagePercent(usage.percent) : '-';

// The backend computes NodePool usage and decides when it warrants a warning, so the table,
// the NodePool details, and Attention flag the same pools.
function renderPoolUsage(row: CustomResourceGridRow) {
  if (row.ref.kind !== 'NodePool') {
    return '-';
  }
  const cpu = row.karpenter?.limitUsage?.cpu;
  const memory = row.karpenter?.limitUsage?.memory;
  if (!cpu && !memory) {
    return '-';
  }
  const cpuText = usageText(cpu);
  const memoryText = usageText(memory);
  return (
    <span data-gridtable-export-text={`CPU ${cpuText} / Mem ${memoryText}`}>
      CPU{' '}
      <span className={cpu?.presentation ? backendStatusTextClass(cpu.presentation) : undefined}>
        {cpuText}
      </span>
      {' / Mem '}
      <span
        className={memory?.presentation ? backendStatusTextClass(memory.presentation) : undefined}
      >
        {memoryText}
      </span>
    </span>
  );
}

// Use named facts, so a cell and its CSV value contain exactly the field in
// the heading. The shared link renderer preserves complete related identity.
export function karpenterColumns(
  parts: Pick<
    ReturnType<typeof useCustomResourceGridParts>,
    'baseColumns' | 'openReference' | 'navigateReference' | 'selectedClusterName'
  >
) {
  const references = (
    [
      ['nodePool', 'NodePool'],
      ['nodeClass', 'NodeClass'],
    ] as const
  ).map(([key, header]) =>
    createDetailSegmentsColumn<CustomResourceGridRow>({
      key,
      header,
      getSegments: (row) => {
        const link = row.karpenter?.[key];
        const value = link?.ref?.name ?? link?.display?.name;
        return value ? [{ value, link }] : undefined;
      },
      openReference: parts.openReference,
      navigateReference: parts.navigateReference,
      clusterName: parts.selectedClusterName,
    })
  );
  const columns = withColumnSizing(
    [
      ...parts.baseColumns.filter((column) => column.key !== 'crd' && column.key !== 'age'),
      { key: 'usage', header: 'Usage', sortable: false, render: renderPoolUsage },
      ...references,
      createTextColumn<CustomResourceGridRow>(
        'instanceType',
        'Instance Type',
        (row) => row.karpenter?.instanceType,
        { sortable: false }
      ),
      ...parts.baseColumns.filter((column) => column.key === 'age'),
    ],
    {
      instanceType: { minWidth: '10rem' },
    }
  );
  return withAutoWidthColumns(columns);
}
