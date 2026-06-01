import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requestRefreshDomainState } from '@/core/data-access';
import type {
  GridTableFilterState,
  GridTableFilterOptions,
} from '@shared/components/tables/GridTable';
import type { SortConfig } from '@hooks/useTableSort';
import type { RefreshDomain, ResourceQueryDynamicRef } from '@/core/refresh/types';
import {
  buildTypedResourceQueryScope,
  filterOptionsFromTypedPayload,
  typedResourceQueryLifecycleIdentity,
  type TypedQueryPayload,
} from './typedResourceQueryScope';
export type { TypedQueryPayload } from './typedResourceQueryScope';

export interface UseTypedResourceQueryParams<TPayload extends TypedQueryPayload, TRow> {
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

export interface UseTypedResourceQueryResult<TRow> {
  rows: TRow[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  continueToken: string | null;
  isRequestingMore: boolean;
  loadMore: () => void;
  filterOptions: Partial<GridTableFilterOptions>;
  dynamic: ResourceQueryDynamicRef | null;
}

const DEFAULT_PAGE_LIMIT = 250;

export function useTypedResourceQuery<TPayload extends TypedQueryPayload, TRow>({
  enabled,
  clusterId,
  domain,
  label,
  filters,
  sortConfig,
  pageLimit = DEFAULT_PAGE_LIMIT,
  predicates,
  selectRows,
}: UseTypedResourceQueryParams<TPayload, TRow>): UseTypedResourceQueryResult<TRow> {
  const [rows, setRows] = useState<TRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [continueToken, setContinueToken] = useState<string | null>(null);
  const [requestToken, setRequestToken] = useState<string | null>(null);
  const [isRequestingMore, setIsRequestingMore] = useState(false);
  const [filterOptions, setFilterOptions] = useState<Partial<GridTableFilterOptions>>({});
  const [dynamic, setDynamic] = useState<ResourceQueryDynamicRef | null>(null);
  const queryIdentity = useMemo(
    () =>
      typedResourceQueryLifecycleIdentity({
        enabled,
        clusterId,
        domain,
        filters,
        sortConfig,
        pageLimit,
        predicates,
      }),
    [clusterId, domain, enabled, filters, pageLimit, predicates, sortConfig]
  );
  const queryIdentityRef = useRef(queryIdentity);
  queryIdentityRef.current = queryIdentity;

  useEffect(() => {
    setRequestToken(null);
    setContinueToken(null);
    setRows([]);
    setLoaded(false);
    setDynamic(null);
  }, [queryIdentity]);

  const scope = useMemo(() => {
    if (!enabled) {
      return null;
    }
    return buildTypedResourceQueryScope(clusterId, {
      filters,
      sortConfig,
      pageLimit,
      predicates,
      continueToken: requestToken,
    });
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
          setError(`${label} returned no data`);
          setLoaded(true);
          return;
        }
        if (payload.cursorInvalid) {
          setRequestToken(null);
          setContinueToken(null);
          return;
        }
        setRows(selectRows(payload));
        setContinueToken(payload.continue ?? null);
        setFilterOptions(filterOptionsFromTypedPayload(payload));
        setDynamic(payload.dynamic ?? null);
        setLoaded(true);
      } catch (caught) {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : String(caught));
          setLoaded(true);
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
    dynamic,
  };
}
