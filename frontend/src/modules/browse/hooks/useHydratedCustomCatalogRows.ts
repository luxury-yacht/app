import { useEffect, useMemo, useState } from 'react';

import { readHydratedCustomCatalogRows, requestData } from '@core/data-access';
import type { CatalogItem } from '@/core/refresh/types';

export interface HydratedCustomCatalogRow {
  kind: string;
  kindAlias?: string;
  name: string;
  namespace: string;
  clusterId: string;
  clusterName?: string;
  apiGroup?: string;
  apiVersion?: string;
  crdName?: string;
  status?: string;
  statusState?: string;
  statusPresentation?: string;
  ready?: boolean;
  observedGeneration?: number;
  conditions?: Array<{
    type: string;
    status: string;
    reason?: string;
    message?: string;
  }>;
  age?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
}

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
  apiGroup,
  apiVersion,
  kind,
  namespace,
  name,
}: {
  clusterId?: string;
  apiGroup?: string;
  apiVersion?: string;
  kind?: string;
  namespace?: string;
  name?: string;
}): string =>
  [clusterId ?? '', apiGroup ?? '', apiVersion ?? '', kind ?? '', namespace ?? '', name ?? ''].join(
    '|'
  );

const catalogItemToFallbackRow = (item: CatalogItem): HydratedCustomCatalogRow => ({
  kind: item.kind,
  kindAlias: item.kind,
  name: item.name,
  namespace: item.namespace ?? '',
  clusterId: item.clusterId,
  clusterName: item.clusterName,
  apiGroup: item.group,
  apiVersion: item.version,
  crdName: item.group ? `${item.resource}.${item.group}` : item.resource,
  status: item.actionFacts?.status,
  statusPresentation: item.actionFacts?.status,
  age: item.creationTimestamp,
});

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

const normalizeHydratedRow = (row: any): HydratedCustomCatalogRow => ({
  kind: row.kind,
  kindAlias: row.kindAlias ?? row.kind,
  name: row.name,
  namespace: row.namespace ?? '',
  clusterId: row.clusterId,
  clusterName: row.clusterName,
  apiGroup: row.apiGroup,
  apiVersion: row.apiVersion,
  crdName: row.crdName,
  status: row.status,
  statusState: row.statusState,
  statusPresentation: row.statusPresentation,
  ready: row.ready,
  observedGeneration: row.observedGeneration,
  conditions: row.conditions,
  age: row.age,
  labels: row.labels,
  annotations: row.annotations,
});

export function useHydratedCustomCatalogRows(
  clusterId: string | null | undefined,
  catalogItems: CatalogItem[]
): HydratedCustomCatalogRow[] {
  const fallbackRows = useMemo(() => catalogItems.map(catalogItemToFallbackRow), [catalogItems]);
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
            apiGroup: row.group,
            apiVersion: row.version,
            kind: row.kind,
            namespace: row.namespace,
            name: row.name,
          })
        )
        .join('\n'),
    [requestRows]
  );
  const [rows, setRows] = useState<HydratedCustomCatalogRow[]>(fallbackRows);

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
        const hydratedByKey = new Map<string, HydratedCustomCatalogRow>();
        for (const rawRow of hydratedRows ?? []) {
          const hydrated = normalizeHydratedRow(rawRow);
          hydratedByKey.set(customRowKey(hydrated), hydrated);
        }
        setRows(fallbackRows.map((row) => hydratedByKey.get(customRowKey(row)) ?? row));
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
