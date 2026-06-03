import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { requestRefreshDomainState } from '@/core/data-access';
import { useRefreshScopedDomain } from '@/core/refresh';
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
  baseScope?: string;
  filters: GridTableFilterState;
  sortConfig: SortConfig | null;
  pageLimit?: number;
  predicates?: Record<string, string | null | undefined>;
  liveDataVersion?: string | null;
  selectRows: (payload: TPayload) => TRow[];
}

export interface UseTypedResourceQueryResult<TRow> {
  rows: TRow[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
  continueToken: string | null;
  hasPrevious: boolean;
  isRequestingMore: boolean;
  loadMore: () => void;
  loadPrevious: () => void;
  pageIndex: number;
  pageSize: number;
  totalCount: number;
  totalIsExact: boolean;
  filterOptions: Partial<GridTableFilterOptions>;
  dynamic: ResourceQueryDynamicRef | null;
}

const DEFAULT_PAGE_LIMIT = 50;
export const TYPED_QUERY_PAGE_LIMIT_OPTIONS = [25, 50, 100, 250, 500, 1000] as const;
export type TypedQueryPageLimit = (typeof TYPED_QUERY_PAGE_LIMIT_OPTIONS)[number];

const refreshStateRevision = (state: {
  version?: number | string;
  checksum?: string;
  etag?: string;
}): string => [state.version ?? '', state.checksum ?? state.etag ?? ''].join(':');

const liveDataRevision = (value?: string | null): string => {
  if (!value) {
    return '';
  }
  const [version = '', checksum = ''] = value.split(':');
  if (!version && !checksum) {
    return '';
  }
  return [version, checksum].join(':');
};

const cachedQueryMatchesLiveRevision = (
  cachedRevision: string,
  hasCachedData: boolean,
  liveDataVersion?: string | null
): boolean => {
  if (!hasCachedData) {
    return false;
  }
  const liveRevision = liveDataRevision(liveDataVersion);
  return Boolean(liveRevision) && cachedRevision === liveRevision;
};

export function useTypedResourceQuery<TPayload extends TypedQueryPayload, TRow>({
  enabled,
  clusterId,
  domain,
  label,
  baseScope,
  filters,
  sortConfig,
  pageLimit = DEFAULT_PAGE_LIMIT,
  predicates,
  liveDataVersion,
  selectRows,
}: UseTypedResourceQueryParams<TPayload, TRow>): UseTypedResourceQueryResult<TRow> {
  const [rows, setRows] = useState<TRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [continueToken, setContinueToken] = useState<string | null>(null);
  const [requestToken, setRequestToken] = useState<string | null>(null);
  const [previousTokens, setPreviousTokens] = useState<Array<string | null>>([]);
  const [pageIndex, setPageIndex] = useState(1);
  const [totalCount, setTotalCount] = useState(0);
  const [totalIsExact, setTotalIsExact] = useState(true);
  const [isRequestingMore, setIsRequestingMore] = useState(false);
  const [filterOptions, setFilterOptions] = useState<Partial<GridTableFilterOptions>>({});
  const [dynamic, setDynamic] = useState<ResourceQueryDynamicRef | null>(null);
  const pendingNavigationRef = useRef<{
    direction: 'next' | 'previous';
    previousPageToken?: string | null;
  } | null>(null);
  const queryIdentity = useMemo(
    () =>
      typedResourceQueryLifecycleIdentity({
        enabled,
        clusterId,
        domain,
        baseScope,
        filters,
        sortConfig,
        pageLimit,
        predicates,
        liveDataVersion,
      }),
    [
      baseScope,
      clusterId,
      domain,
      enabled,
      filters,
      liveDataVersion,
      pageLimit,
      predicates,
      sortConfig,
    ]
  );
  const queryResetIdentity = useMemo(
    () =>
      typedResourceQueryLifecycleIdentity({
        enabled,
        clusterId,
        domain,
        baseScope,
        filters,
        sortConfig,
        pageLimit,
        predicates,
      }),
    [baseScope, clusterId, domain, enabled, filters, pageLimit, predicates, sortConfig]
  );
  const queryHardResetIdentity = useMemo(
    () =>
      typedResourceQueryLifecycleIdentity({
        enabled,
        clusterId,
        domain,
        baseScope,
        filters: {
          search: '',
          kinds: [],
          namespaces: [],
          caseSensitive: false,
          includeMetadata: false,
        },
        sortConfig: null,
        pageLimit: DEFAULT_PAGE_LIMIT,
        predicates,
      }),
    [baseScope, clusterId, domain, enabled, predicates]
  );
  const queryIdentityRef = useRef(queryIdentity);
  const queryResetIdentityRef = useRef(queryResetIdentity);
  const queryHardResetIdentityRef = useRef(queryHardResetIdentity);
  queryIdentityRef.current = queryIdentity;

  const requestTokenForScope =
    queryResetIdentityRef.current === queryResetIdentity ? requestToken : null;

  useEffect(() => {
    queryResetIdentityRef.current = queryResetIdentity;
    const hardReset = queryHardResetIdentityRef.current !== queryHardResetIdentity;
    queryHardResetIdentityRef.current = queryHardResetIdentity;
    setRequestToken(null);
    setContinueToken(null);
    setPreviousTokens([]);
    setPageIndex(1);
    if (hardReset) {
      setTotalCount(0);
      setTotalIsExact(true);
      setRows([]);
      setLoaded(false);
      setFilterOptions({});
      setDynamic(null);
    }
    pendingNavigationRef.current = null;
  }, [queryHardResetIdentity, queryResetIdentity]);

  const scope = useMemo(() => {
    if (!enabled) {
      return null;
    }
    return buildTypedResourceQueryScope(clusterId, {
      baseScope,
      filters,
      sortConfig,
      pageLimit,
      predicates,
      continueToken: requestTokenForScope,
    });
  }, [
    baseScope,
    clusterId,
    enabled,
    filters,
    pageLimit,
    predicates,
    requestTokenForScope,
    sortConfig,
  ]);
  const cachedQueryState = useRefreshScopedDomain(domain, scope ?? `__typed-query:${domain}`);
  const cachedPayload = cachedQueryState.data as TPayload | null | undefined;
  const cachedRevision = refreshStateRevision(cachedQueryState);
  const matchedCachedPayload = useMemo(() => {
    if (requestTokenForScope || !cachedPayload) {
      return null;
    }
    return cachedQueryMatchesLiveRevision(cachedRevision, true, liveDataVersion)
      ? cachedPayload
      : null;
  }, [cachedPayload, cachedRevision, liveDataVersion, requestTokenForScope]);
  const matchedCachedResult = useMemo(() => {
    if (!matchedCachedPayload) {
      return null;
    }
    return {
      rows: selectRows(matchedCachedPayload),
      continueToken: matchedCachedPayload.continue ?? null,
      totalCount: matchedCachedPayload.total ?? 0,
      totalIsExact: matchedCachedPayload.totalIsExact !== false,
      filterOptions: filterOptionsFromTypedPayload(matchedCachedPayload),
      dynamic: matchedCachedPayload.dynamic ?? null,
    };
  }, [matchedCachedPayload, selectRows]);

  const applyPayload = useCallback(
    (payload: TPayload) => {
      setRows(selectRows(payload));
      setContinueToken(payload.continue ?? null);
      setTotalCount(payload.total ?? 0);
      setTotalIsExact(payload.totalIsExact !== false);
      setFilterOptions(filterOptionsFromTypedPayload(payload));
      setDynamic(payload.dynamic ?? null);
      const pendingNavigation = pendingNavigationRef.current;
      if (pendingNavigation) {
        if (pendingNavigation.direction === 'next') {
          setPreviousTokens((current) => [...current, pendingNavigation.previousPageToken ?? null]);
          setPageIndex((current) => current + 1);
        } else {
          setPreviousTokens((current) => current.slice(0, -1));
          setPageIndex((current) => Math.max(1, current - 1));
        }
        pendingNavigationRef.current = null;
      }
      setLoaded(true);
    },
    [selectRows]
  );

  useEffect(() => {
    if (!enabled || !scope) {
      return;
    }
    let cancelled = false;
    const identityAtRequest = queryIdentityRef.current;
    if (matchedCachedPayload) {
      setError(null);
      setLoading(false);
      applyPayload(matchedCachedPayload);
      return;
    }

    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const result = await requestRefreshDomainState({
          domain,
          scope,
          reason: 'user',
          label,
          preserveState: true,
        });
        if (cancelled || queryIdentityRef.current !== identityAtRequest) {
          return;
        }
        if (result.status !== 'executed') {
          pendingNavigationRef.current = null;
          setError(
            result.blockedReason === 'auto-refresh-disabled'
              ? `${label} could not load because auto-refresh is disabled`
              : `${label} request was blocked`
          );
          setLoaded(true);
          return;
        }
        const payload = result.data?.data as TPayload | null | undefined;
        if (!payload) {
          pendingNavigationRef.current = null;
          setError(`${label} returned no data`);
          setLoaded(true);
          return;
        }
        if (payload.cursorInvalid) {
          setRequestToken(null);
          setContinueToken(null);
          setPreviousTokens([]);
          setPageIndex(1);
          pendingNavigationRef.current = null;
          return;
        }
        applyPayload(payload);
      } catch (caught) {
        if (!cancelled) {
          pendingNavigationRef.current = null;
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
  }, [
    applyPayload,
    domain,
    enabled,
    label,
    matchedCachedPayload,
    queryIdentity,
    requestTokenForScope,
    scope,
  ]);

  const loadMore = useCallback(() => {
    if (!continueToken || isRequestingMore) {
      return;
    }
    setIsRequestingMore(true);
    pendingNavigationRef.current = {
      direction: 'next',
      previousPageToken: requestToken,
    };
    setRequestToken(continueToken);
  }, [continueToken, isRequestingMore, requestToken]);

  const loadPrevious = useCallback(() => {
    if (previousTokens.length === 0 || isRequestingMore) {
      return;
    }
    const previousToken = previousTokens[previousTokens.length - 1] ?? null;
    setIsRequestingMore(true);
    pendingNavigationRef.current = { direction: 'previous' };
    setRequestToken(previousToken);
  }, [isRequestingMore, previousTokens]);

  return {
    rows: matchedCachedResult?.rows ?? rows,
    loading: matchedCachedResult ? false : loading,
    loaded: matchedCachedResult ? true : loaded,
    error,
    continueToken: matchedCachedResult?.continueToken ?? continueToken,
    hasPrevious: previousTokens.length > 0,
    isRequestingMore,
    loadMore,
    loadPrevious,
    pageIndex,
    pageSize: pageLimit,
    totalCount: matchedCachedResult?.totalCount ?? totalCount,
    totalIsExact: matchedCachedResult?.totalIsExact ?? totalIsExact,
    filterOptions: matchedCachedResult?.filterOptions ?? filterOptions,
    dynamic: matchedCachedResult?.dynamic ?? dynamic,
  };
}
