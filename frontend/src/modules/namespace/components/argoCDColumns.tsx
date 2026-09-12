import type {
  CustomResourceGridRow,
  useCustomResourceGridParts,
} from '@modules/browse/components/CustomResourceGridView';
import { createTextColumn, withAutoWidthColumns } from '@shared/components/tables/columnFactories';
import { backendStatusTextClass } from '@shared/utils/backendStatusPresentation';

export function argoCDColumns(
  parts: Pick<ReturnType<typeof useCustomResourceGridParts>, 'baseColumns'>
) {
  return withAutoWidthColumns([
    ...parts.baseColumns.filter((column) => column.key === 'kind' || column.key === 'name'),
    createTextColumn<CustomResourceGridRow>('sync', 'Sync', (row) => row.argoCD?.sync, {
      sortable: false,
      getClassName: (row) => backendStatusTextClass(row.argoCD?.syncPresentation),
    }),
    createTextColumn<CustomResourceGridRow>('health', 'Health', (row) => row.argoCD?.health, {
      sortable: false,
      getClassName: (row) => backendStatusTextClass(row.argoCD?.healthPresentation),
    }),
    createTextColumn<CustomResourceGridRow>('project', 'Project', (row) => row.argoCD?.project, {
      sortable: false,
    }),
    createTextColumn<CustomResourceGridRow>(
      'destination',
      'Destination',
      (row) => row.argoCD?.destination,
      { sortable: false }
    ),
    createTextColumn<CustomResourceGridRow>(
      'destinationNamespace',
      'Target Namespace',
      (row) => row.argoCD?.destinationNamespace,
      { sortable: false }
    ),
    ...parts.baseColumns.filter((column) => column.key === 'age'),
  ]);
}
