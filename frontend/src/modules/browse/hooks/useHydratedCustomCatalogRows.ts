import { useEffect, useMemo, useState } from 'react';

import { readHydratedCustomCatalogRows, requestData } from '@core/data-access';
import type { CatalogItem } from '@/core/refresh/types';
import {
  catalogItemToFallbackCustomRow,
  normalizeHydratedCustomRow,
  type CatalogBackedCustomResourceRow,
} from './customCatalogRowAdapter';

type HydrationQueryRow = {
  clusterId: string;
  group: string;
  version: string;
  kind: string;
  resource: string;
  namespace?: string;
  name: string;
  uid?: string;
};

const customRowKey = ({
  clusterId,
  group,
  version,
  kind,
  namespace,
  name,
}: {
  clusterId?: string;
  group?: string;
  version?: string;
  kind?: string;
  namespace?: string;
  name?: string;
}): string =>
  [clusterId ?? '', group ?? '', version ?? '', kind ?? '', namespace ?? '', name ?? ''].join('|');

const catalogItemToHydrationQueryRow = (item: CatalogItem): HydrationQueryRow => ({
  clusterId: item.clusterId,
  group: item.group,
  version: item.version,
  kind: item.kind,
  resource: item.resource,
  namespace: item.namespace,
  name: item.name,
  uid: item.uid,
});

export function useHydratedCustomCatalogRows(
  clusterId: string | null | undefined,
  catalogItems: CatalogItem[]
): CatalogBackedCustomResourceRow[] {
  const fallbackRows = useMemo(
    () => catalogItems.map(catalogItemToFallbackCustomRow),
    [catalogItems]
  );
  const requestRows = useMemo(
    () => catalogItems.map(catalogItemToHydrationQueryRow),
    [catalogItems]
  );
  const requestKey = useMemo(
    () =>
      requestRows
        .map((row) =>
          customRowKey({
            clusterId: row.clusterId,
            group: row.group,
            version: row.version,
            kind: row.kind,
            namespace: row.namespace,
            name: row.name,
          })
        )
        .join('\n'),
    [requestRows]
  );
  const [rows, setRows] = useState<CatalogBackedCustomResourceRow[]>(fallbackRows);

  useEffect(() => {
    setRows(fallbackRows);
    const resolvedClusterId = clusterId?.trim();
    if (!resolvedClusterId || requestRows.length === 0) {
      return undefined;
    }

    let cancelled = false;
    requestData({
      resource: 'custom-catalog-hydration',
      adapter: 'rpc-read',
      reason: 'startup',
      label: 'Custom catalog page hydration',
      scope: `${resolvedClusterId}|rows=${requestRows.length}`,
      read: () => readHydratedCustomCatalogRows(resolvedClusterId, requestRows),
    })
      .then((result) => {
        if (cancelled) {
          return;
        }
        if (result.status !== 'executed') {
          setRows(fallbackRows);
          return;
        }
        const hydratedRows = result.data;
        const hydratedByKey = new Map<string, CatalogBackedCustomResourceRow>();
        for (const rawRow of hydratedRows ?? []) {
          const hydrated = normalizeHydratedCustomRow(rawRow);
          hydratedByKey.set(customRowKey(hydrated), hydrated);
        }
        setRows(
          fallbackRows.map((row) => {
            const hydrated = hydratedByKey.get(customRowKey(row));
            return {
              ...row,
              ...(hydrated ?? {}),
              group: row.group,
              version: row.version,
              resource: row.resource,
              apiGroup: row.group,
              apiVersion: row.version,
              age: hydrated?.age || row.age,
            };
          })
        );
      })
      .catch((error) => {
        console.error('Failed to hydrate custom catalog rows', error);
        if (!cancelled) {
          setRows(fallbackRows);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [clusterId, fallbackRows, requestKey, requestRows]);

  return rows;
}
