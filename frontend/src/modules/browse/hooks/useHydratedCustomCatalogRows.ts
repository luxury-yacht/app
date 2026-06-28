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

// Merge backend-hydrated rows onto the fallback rows by identity, preserving the adapter's
// group/version/resource fields. Shared by the page hook and the imperative export path.
const mergeHydratedRows = (
  fallbackRows: CatalogBackedCustomResourceRow[],
  hydratedRaw: readonly unknown[] | null | undefined
): CatalogBackedCustomResourceRow[] => {
  const hydratedByKey = new Map<string, CatalogBackedCustomResourceRow>();
  for (const rawRow of hydratedRaw ?? []) {
    const hydrated = normalizeHydratedCustomRow(rawRow);
    hydratedByKey.set(customRowKey(hydrated), hydrated);
  }
  return fallbackRows.map((row) => {
    const hydrated = hydratedByKey.get(customRowKey(row));
    return {
      ...row,
      ...(hydrated ?? {}),
      group: row.group,
      version: row.version,
      resource: row.resource,
      age: hydrated?.age || row.age,
      ageTimestamp: hydrated?.ageTimestamp ?? row.ageTimestamp,
      creationTimestamp: hydrated?.creationTimestamp ?? row.creationTimestamp,
    };
  });
};

// Imperatively hydrate catalog items into custom-resource rows via ONE batched backend read,
// falling back to the un-hydrated rows on any failure. Used by the export "all matching rows"
// path, which can't go through the page hook.
export async function hydrateCustomCatalogRows(
  clusterId: string | null | undefined,
  catalogItems: CatalogItem[]
): Promise<CatalogBackedCustomResourceRow[]> {
  const fallbackRows = catalogItems.map(catalogItemToFallbackCustomRow);
  const resolvedClusterId = clusterId?.trim();
  if (!resolvedClusterId || catalogItems.length === 0) {
    return fallbackRows;
  }
  const requestRows = catalogItems.map(catalogItemToHydrationQueryRow);
  try {
    const result = await requestData({
      resource: 'custom-catalog-hydration',
      adapter: 'rpc-read',
      reason: 'user',
      label: 'Custom catalog export hydration',
      scope: `${resolvedClusterId}|export-rows=${requestRows.length}`,
      read: () => readHydratedCustomCatalogRows(resolvedClusterId, requestRows),
    });
    if (result.status !== 'executed') {
      return fallbackRows;
    }
    return mergeHydratedRows(fallbackRows, result.data);
  } catch (error) {
    console.error('Failed to hydrate custom catalog export rows', error);
    return fallbackRows;
  }
}

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
        setRows(mergeHydratedRows(fallbackRows, result.data));
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
  }, [clusterId, fallbackRows, requestRows]);

  return rows;
}
