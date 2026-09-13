import type { ResourceFamily } from '@core/navigation/resourceFamilies';
import type { ResourceLink } from '@core/refresh/types';
import { createTextColumn, withAutoWidthColumns } from '@shared/components/tables/columnFactories';
import { createDetailSegmentsColumn } from '@shared/components/tables/detailSegmentsColumn';
import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { formatFullDate } from '@/utils/ageFormatter';
import type { CustomResourceGridRow, useCustomResourceGridParts } from './CustomResourceGridView';

type Parts = Pick<
  ReturnType<typeof useCustomResourceGridParts>,
  'baseColumns' | 'openReference' | 'navigateReference' | 'selectedClusterName'
>;

function referenceColumn(
  parts: Parts,
  key: string,
  header: string,
  getLink: (row: CustomResourceGridRow) => ResourceLink | undefined,
  getName?: (row: CustomResourceGridRow) => string | undefined
) {
  return createDetailSegmentsColumn<CustomResourceGridRow>({
    key,
    header,
    getSegments: (row) => {
      const link = getLink(row);
      const value = link?.ref?.name ?? link?.display?.name ?? getName?.(row);
      return value ? [{ value, link }] : undefined;
    },
    openReference: parts.openReference,
    navigateReference: parts.navigateReference,
    clusterName: parts.selectedClusterName,
  });
}

const text = (
  key: string,
  header: string,
  get: (row: CustomResourceGridRow) => string | undefined
) => createTextColumn(key, header, get, { sortable: false });

export function operatorColumns(
  family: Exclude<ResourceFamily, 'karpenter' | 'argocd'>,
  parts: Parts,
  clusterScoped = false
) {
  let columns: GridColumnDefinition<CustomResourceGridRow>[];
  switch (family) {
    case 'cert-manager':
      columns = [
        referenceColumn(parts, 'issuer', 'Issuer', (row) => row.certManager?.issuer),
        referenceColumn(parts, 'secret', 'Secret', (row) => row.certManager?.secret),
        text('expires', 'Expires', (row) =>
          row.certManager?.notAfter ? formatFullDate(row.certManager.notAfter) : undefined
        ),
      ];
      if (clusterScoped) {
        columns = [
          text('issuerType', 'Type', (row) => row.certManager?.issuerType),
          text('server', 'Server', (row) => row.certManager?.server),
        ];
      }
      break;
    case 'external-secrets':
      columns = [
        text('provider', 'Provider', (row) => row.externalSecrets?.provider),
        referenceColumn(
          parts,
          'store',
          'Store',
          (row) => row.externalSecrets?.store,
          (row) => row.externalSecrets?.storeName
        ),
        referenceColumn(
          parts,
          'target',
          'Target Secret',
          (row) => row.externalSecrets?.target,
          (row) => row.externalSecrets?.targetName
        ),
        text('refreshInterval', 'Refresh', (row) => row.externalSecrets?.refreshInterval),
      ];
      break;
    default:
      columns = [
        text('endpoints', 'Endpoints', (row) => row.prometheus?.endpoints?.toString()),
        text('rules', 'Rules', (row) => row.prometheus?.rules?.toString()),
        text('version', 'Version', (row) => row.prometheus?.version),
        text('replicas', 'Replicas', (row) => row.prometheus?.replicas?.toString()),
      ];
  }
  return withAutoWidthColumns([
    ...parts.baseColumns.filter((column) => ['kind', 'name', 'status'].includes(column.key)),
    ...columns,
    ...parts.baseColumns.filter((column) => column.key === 'age'),
  ]);
}
