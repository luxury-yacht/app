import type {
  CustomResourceGridRow,
  useCustomResourceGridParts,
} from '@modules/browse/components/CustomResourceGridView';
import { createTextColumn, withColumnSizing } from '@shared/components/tables/columnFactories';
import { createDetailSegmentsColumn } from '@shared/components/tables/detailSegmentsColumn';
import { getResourceLimitUsagePercent } from '@shared/utils/resourceCalculations';

const formatUsagePercent = (percentage: number | undefined): string =>
  percentage === undefined ? '-' : `${Number(percentage.toFixed(1))}%`;

function renderPoolUsage(row: CustomResourceGridRow) {
  if (row.ref.kind !== 'NodePool') {
    return '-';
  }
  const cpu = getResourceLimitUsagePercent(
    row.karpenter?.capacity?.cpu,
    row.karpenter?.limits?.cpu,
    'cpu'
  );
  const memory = getResourceLimitUsagePercent(
    row.karpenter?.capacity?.memory,
    row.karpenter?.limits?.memory,
    'memory'
  );
  if (cpu === undefined && memory === undefined) {
    return '-';
  }
  const cpuText = formatUsagePercent(cpu);
  const memoryText = formatUsagePercent(memory);
  return (
    <span data-gridtable-export-text={`CPU ${cpuText} / Mem ${memoryText}`}>
      CPU{' '}
      <span className={cpu !== undefined && cpu > 80 ? 'status-text warning' : undefined}>
        {cpuText}
      </span>
      {' / Mem '}
      <span className={memory !== undefined && memory > 80 ? 'status-text warning' : undefined}>
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
  return withColumnSizing(
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
      status: { minWidth: '6rem' },
      instanceType: { minWidth: '10rem' },
    }
  );
}
