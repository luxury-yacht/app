import type {
  CustomResourceGridRow,
  useCustomResourceGridParts,
} from '@modules/browse/components/CustomResourceGridView';
import { createStatusChipMeasurementElement, StatusChip } from '@shared/components/StatusChip';
import { createTextColumn, withAutoWidthColumns } from '@shared/components/tables/columnFactories';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { TABLE_NO_VALUE_TEXT } from '@shared/components/tables/tableNoValue';
import { backendStatusChipVariant } from '@shared/utils/backendStatusPresentation';

// Sync and health are separate signals (a synced Application can still be degraded), so each gets
// its own chip. Objects that report neither (ApplicationSets, AppProjects) show the empty placeholder
// rather than a chip claiming a state they do not have.
const argoCDStatusColumn = (
  key: string,
  header: string,
  getStatus: (row: CustomResourceGridRow) => { value?: string; presentation?: string }
): GridColumnDefinition<CustomResourceGridRow> => ({
  key,
  header,
  className: 'gridtable-badge-column',
  sortable: false,
  measurementElement: (row) => {
    const { value, presentation } = getStatus(row);
    return value
      ? createStatusChipMeasurementElement(backendStatusChipVariant(presentation), value)
      : { tagName: 'span', textContent: TABLE_NO_VALUE_TEXT };
  },
  render: (row) => {
    const { value, presentation } = getStatus(row);
    if (!value) {
      return TABLE_NO_VALUE_TEXT;
    }
    return <StatusChip variant={backendStatusChipVariant(presentation)}>{value}</StatusChip>;
  },
});

export function argoCDColumns(
  parts: Pick<ReturnType<typeof useCustomResourceGridParts>, 'baseColumns'>
) {
  return withAutoWidthColumns([
    ...parts.baseColumns.filter((column) => column.key === 'kind' || column.key === 'name'),
    argoCDStatusColumn('sync', 'Sync', (row) => ({
      value: row.argoCD?.sync,
      presentation: row.argoCD?.syncPresentation,
    })),
    argoCDStatusColumn('health', 'Health', (row) => ({
      value: row.argoCD?.health,
      presentation: row.argoCD?.healthPresentation,
    })),
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
