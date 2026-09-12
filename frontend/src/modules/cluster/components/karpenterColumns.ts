import type {
  CustomResourceGridRow,
  useCustomResourceGridParts,
} from '@modules/browse/components/CustomResourceGridView';
import { createTextColumn, withColumnSizing } from '@shared/components/tables/columnFactories';
import { createDetailSegmentsColumn } from '@shared/components/tables/detailSegmentsColumn';

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
