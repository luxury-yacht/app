import { useEffect, useMemo, useState } from 'react';
import { fetchSnapshot } from '@/core/refresh/client';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import type { CatalogItem, CatalogSnapshotPayload } from '@/core/refresh/types';
import { reportOperationalError } from '@/utils/errorHandler';

export const CATALOG_RESULT_LIMIT = 20;
export type CatalogStats = { total: number; truncated: boolean } | null;

interface SearchOptions {
  enabled: boolean;
  clusterId: string | null | undefined;
  query: string;
  tokens: { kindTokens: string[]; otherTokens: string[] };
}
interface SearchResult {
  items: CatalogItem[];
  stats: CatalogStats;
  loading: boolean;
}
const EMPTY: SearchResult = { items: [], stats: null, loading: false };
const PENDING: SearchResult = { ...EMPTY, loading: true };

export function usePaletteCatalogSearch({ enabled, clusterId, query, tokens }: SearchOptions) {
  const request = useMemo(() => {
    const activeClusterId = clusterId?.trim();
    if (!enabled || !activeClusterId || !query.trim()) {
      return null;
    }
    const params = new URLSearchParams({ limit: String(CATALOG_RESULT_LIMIT) });
    for (const kind of tokens.kindTokens) {
      params.append('kind', kind);
    }
    const primarySearchTerm = tokens.otherTokens[0];
    if (primarySearchTerm) {
      params.set('search', primarySearchTerm);
    } else if (tokens.kindTokens.length === 0) {
      params.set('search', query.trim());
    }
    // Identity includes the full query and each cluster visit, even when the
    // server's primary search term is unchanged.
    return { scope: buildClusterScope(activeClusterId, params.toString()) };
  }, [enabled, clusterId, query, tokens]);
  const [settled, setSettled] = useState<{ request: typeof request; result: SearchResult } | null>(
    null
  );

  useEffect(() => {
    if (!request) {
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetchSnapshot<CatalogSnapshotPayload>('catalog', {
        scope: request.scope,
        signal: controller.signal,
      })
        .then(({ snapshot }) => {
          if (controller.signal.aborted) {
            return;
          }
          const payload = snapshot?.payload;
          const items = payload?.items ?? [];
          setSettled({
            request,
            result: {
              items,
              stats: payload
                ? { total: payload.total, truncated: payload.total > items.length }
                : null,
              loading: false,
            },
          });
        })
        .catch((error) => {
          if (controller.signal.aborted) {
            return;
          }
          if (error?.name !== 'AbortError') {
            reportOperationalError(error, { source: 'CommandPalette', action: 'searchCatalog' });
          }
          setSettled({ request, result: EMPTY });
        });
    }, 200);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [request]);

  if (!request) {
    return EMPTY;
  }
  return settled?.request === request ? settled.result : PENDING;
}
