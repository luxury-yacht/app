import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requestRefreshDomainState } from '@/core/data-access';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import type {
  GridTableFilterState,
  GridTableFilterOptions,
} from '@shared/components/tables/GridTable';
import type { SortConfig } from '@hooks/useTableSort';
import type { RefreshDomain } from '@/core/refresh/types';

interface TypedQueryPayload {
  continue?: string;
  total?: number;
  totalIsExact?: boolean;
  namespaces?: string[];
  kinds?: string[];
}

interface UseAllNamespacesTypedQueryParams<TPayload extends TypedQueryPayload, TRow> {
  enabled: boolean;
  clusterId?: string | null;
  domain: RefreshDomain;
  label: string;
  filters: GridTableFilterState;
  sortConfig: SortConfig | null;
  pageLimit?: number;
  predicates?: Record<string, string | null | undefined>;
  selectRows: (payload: TPayload) => TRow[];
}

interface UseAllNamespacesTypedQueryResult<TRow> {
  rows: TRow[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  continueToken: string | null;
  isRequestingMore: boolean;
  loadMore: () => void;
  filterOptions: Partial<GridTableFilterOptions>;
}

const DEFAULT_PAGE_LIMIT = 250;

const stableList = (values: string[]) =>
  values
    .map((value) => value.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

const queryIdentityFor = (
  filters: GridTableFilterState,
  sortConfig: SortConfig | null,
  predicates?: Record<string, string | null | undefined>
) =>
  JSON.stringify({
    search: filters.search,
    caseSensitive: filters.caseSensitive,
    kinds: stableList(filters.kinds),
    namespaces: stableList(filters.namespaces),
    sort: sortConfig,
    predicates: Object.fromEntries(
      Object.entries(predicates ?? {})
        .filter(([, value]) => Boolean(value))
        .sort(([left], [right]) => left.localeCompare(right))
    ),
  });

export function useAllNamespacesTypedQuery<TPayload extends TypedQueryPayload, TRow>({
  enabled,
  clusterId,
  domain,
  label,
  filters,
  sortConfig,
  pageLimit = DEFAULT_PAGE_LIMIT,
  predicates,
  selectRows,
}: UseAllNamespacesTypedQueryParams<TPayload, TRow>): UseAllNamespacesTypedQueryResult<TRow> {
  const [rows, setRows] = useState<TRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [continueToken, setContinueToken] = useState<string | null>(null);
  const [requestToken, setRequestToken] = useState<string | null>(null);
  const [isRequestingMore, setIsRequestingMore] = useState(false);
  const [filterOptions, setFilterOptions] = useState<Partial<GridTableFilterOptions>>({});
  const queryIdentity = useMemo(
    () => queryIdentityFor(filters, sortConfig, predicates),
    [filters, predicates, sortConfig]
  );
  const queryIdentityRef = useRef(queryIdentity);
  queryIdentityRef.current = queryIdentity;

  useEffect(() => {
    setRequestToken(null);
    setContinueToken(null);
    setRows([]);
    setLoaded(false);
  }, [queryIdentity]);

  const scope = useMemo(() => {
    if (!enabled || !clusterId) {
      return null;
    }
    const params = new URLSearchParams();
    params.set('limit', String(pageLimit));
    if (filters.search.trim()) {
      params.set('search', filters.search.trim());
    }
    if (filters.namespaces.length > 0) {
      params.set('namespaces', stableList(filters.namespaces).join(','));
    }
    if (filters.kinds.length > 0) {
      params.set('kinds', stableList(filters.kinds).join(','));
    }
    if (sortConfig?.key && sortConfig.direction) {
      params.set('sort', sortConfig.key);
      params.set('sortDirection', sortConfig.direction);
    }
    for (const [key, value] of Object.entries(predicates ?? {})) {
      if (value) {
        params.set(`predicate.${key}`, value);
      }
    }
    if (requestToken) {
      params.set('continue', requestToken);
    }
    return buildClusterScope(clusterId, `namespace:all?${params.toString()}`);
  }, [clusterId, enabled, filters, pageLimit, predicates, requestToken, sortConfig]);

  useEffect(() => {
    if (!enabled || !scope) {
      return;
    }
    let cancelled = false;
    const identityAtRequest = queryIdentityRef.current;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const result = await requestRefreshDomainState({
          domain,
          scope,
          reason: requestToken ? 'user' : 'startup',
          label,
        });
        if (
          cancelled ||
          result.status !== 'executed' ||
          queryIdentityRef.current !== identityAtRequest
        ) {
          return;
        }
        const payload = result.data?.data as TPayload | null | undefined;
        if (!payload) {
          return;
        }
        setRows(selectRows(payload));
        setContinueToken(payload.continue ?? null);
        setFilterOptions({
          kinds: payload.kinds,
          namespaces: payload.namespaces,
          totalCount: payload.total,
          totalIsExact: payload.totalIsExact,
        });
        setLoaded(true);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setIsRequestingMore(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [domain, enabled, label, requestToken, scope, selectRows]);

  const loadMore = useCallback(() => {
    if (!continueToken || isRequestingMore) {
      return;
    }
    setIsRequestingMore(true);
    setRequestToken(continueToken);
  }, [continueToken, isRequestingMore]);

  return {
    rows,
    loading,
    loaded,
    error,
    continueToken,
    isRequestingMore,
    loadMore,
    filterOptions,
  };
}
