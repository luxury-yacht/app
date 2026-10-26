import type {
  CustomResourceGridRow,
  useCustomResourceGridParts,
} from '@modules/browse/components/CustomResourceGridView';
import {
  createStatusChipColumn,
  createTextColumn,
  withAutoWidthColumns,
} from '@shared/components/tables/columnFactories';

export function argoCDColumns(
  parts: Pick<ReturnType<typeof useCustomResourceGridParts>, 'baseColumns'>
) {
  return withAutoWidthColumns([
    ...parts.baseColumns.filter((column) => column.key === 'kind' || column.key === 'name'),
    // Sync and health are separate signals (a synced Application can still be degraded), so each
    // gets its own chip. Objects that report neither (ApplicationSets, AppProjects) show the empty
    // placeholder.
    createStatusChipColumn<CustomResourceGridRow>(
      'sync',
      'Sync',
      (row) => ({ value: row.argoCD?.sync, presentation: row.argoCD?.syncPresentation }),
      { sortable: false }
    ),
    createStatusChipColumn<CustomResourceGridRow>(
      'health',
      'Health',
      (row) => ({ value: row.argoCD?.health, presentation: row.argoCD?.healthPresentation }),
      { sortable: false }
    ),
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
