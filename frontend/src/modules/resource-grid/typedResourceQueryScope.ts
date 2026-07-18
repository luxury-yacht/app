import type { SortConfig } from '@hooks/useTableSort';
import type { MultiSelectFilterSelection } from '@shared/components/dropdowns/multiSelectFilterSelection';
import { migrateLegacyMultiSelectFilterSelection } from '@shared/components/dropdowns/multiSelectFilterSelection';
import type {
  GridTableFilterOptions,
  GridTableFilterState,
} from '@shared/components/tables/GridTable';
import { buildClusterScope } from '@/core/refresh/clusterScope';
import type {
  ResourceQueryAnchor,
  ResourceQueryAnchorResult,
  ResourceQueryCapabilities,
  ResourceQueryDynamicRef,
  ResourceQueryFacetValues,
  ResourceQueryIssue,
} from '@/core/refresh/types';

export const RESOURCE_STATUS_QUERY_FACET_KEYS = ['statuses'] as const;

export interface TypedQueryPayload {
  continue?: string;
  /** Backend prev-page cursor — populated on every engine-served response. */
  previous?: string;
  /** Token addressing THIS page (counted serves) — page-stable live refetch after a jump. */
  self?: string;
  /** Present iff the request carried an anchor. */
  anchor?: ResourceQueryAnchorResult;
  /** Serve-time rank of the page's first row; absent = not computed, 0 = page 1. */
  pageStartRank?: number;
  cursorInvalid?: boolean;
  total?: number;
  // Items in scope before the request's filters — the "of M" in "Showing N of M items".
  unfilteredTotal?: number;
  totalIsExact?: boolean;
  namespaces?: string[];
  kinds?: string[];
  facetValues?: ResourceQueryFacetValues[];
  facetsExact?: boolean;
  issues?: ResourceQueryIssue[];
  dynamic?: ResourceQueryDynamicRef;
  capabilities?: ResourceQueryCapabilities;
}

export interface TypedResourceQueryDescriptor {
  filters: GridTableFilterState;
  sortConfig: SortConfig | null;
  pageLimit: number;
  baseScope?: string;
  predicates?: Record<string, string | null | undefined>;
  continueToken?: string | null;
  /**
   * Anchor jump target — mutually exclusive with continueToken (the backend
   * validates; the builder drops the continue token when an anchor is set).
   */
  anchor?: ResourceQueryAnchor | null;
  /**
   * Numbered page jump: serve the page starting at this 0-based rank.
   * Mutually exclusive with continueToken and anchor.
   */
  startRank?: number | null;
}

export interface TypedResourceQueryLifecycleDescriptor extends TypedResourceQueryDescriptor {
  enabled: boolean;
  clusterId?: string | null;
  domain: string;
  liveDataVersion?: string | null;
}

const stableTypedQueryList = (values: string[]) =>
  values
    .map((value) => value.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

const stableTypedQuerySelection = (selection: unknown) => {
  const normalized = migrateLegacyMultiSelectFilterSelection(selection);
  return normalized.mode === 'some' ? stableTypedQueryList(normalized.values) : [];
};

const stableTypedQueryFacets = (facets: Record<string, MultiSelectFilterSelection> | undefined) =>
  Object.fromEntries(
    Object.entries(facets ?? {})
      .map(([key, selection]) => [key, stableTypedQuerySelection(selection)] as const)
      .filter(([, values]) => values.length > 0)
      .sort(([left], [right]) => left.localeCompare(right))
  );

export const hasExplicitNoneResourceQueryFilter = (filters: GridTableFilterState): boolean =>
  [filters.kinds, filters.namespaces, filters.clusters, ...Object.values(filters.queryFacets ?? {})]
    .map(migrateLegacyMultiSelectFilterSelection)
    .some((selection) => selection.mode === 'none');

export const typedResourceQueryIdentity = ({
  filters,
  sortConfig,
  predicates,
}: Pick<TypedResourceQueryDescriptor, 'filters' | 'sortConfig' | 'predicates'>) =>
  JSON.stringify({
    search: filters.search,
    caseSensitive: filters.caseSensitive,
    includeMetadata: filters.includeMetadata,
    matchNone: hasExplicitNoneResourceQueryFilter(filters),
    kinds: stableTypedQuerySelection(filters.kinds),
    namespaces: stableTypedQuerySelection(filters.namespaces),
    queryFacets: stableTypedQueryFacets(filters.queryFacets),
    sort: sortConfig,
    predicates: Object.fromEntries(
      Object.entries(predicates ?? {})
        .filter(([, value]) => Boolean(value))
        .sort(([left], [right]) => left.localeCompare(right))
    ),
  });

export const typedResourceQueryLifecycleIdentity = ({
  enabled,
  clusterId,
  domain,
  pageLimit,
  baseScope,
  filters,
  sortConfig,
  predicates,
  liveDataVersion,
}: TypedResourceQueryLifecycleDescriptor) =>
  JSON.stringify({
    enabled,
    clusterId: clusterId?.trim() ?? '',
    domain,
    liveDataVersion: liveDataVersion ?? '',
    pageLimit,
    baseScope: baseScope ?? 'namespace:all',
    query: typedResourceQueryIdentity({ filters, sortConfig, predicates }),
  });

export function buildTypedResourceQueryScope(
  clusterId: string | null | undefined,
  descriptor: TypedResourceQueryDescriptor
): string | null {
  if (!clusterId) {
    return null;
  }
  const params = new URLSearchParams();
  params.set('limit', String(descriptor.pageLimit));
  if (descriptor.filters.search.trim()) {
    params.set('search', descriptor.filters.search.trim());
  }
  // Tell the backend to also match labels/annotations. The server only applies this
  // while searching; sending it without a search is a harmless no-op.
  if (descriptor.filters.includeMetadata) {
    params.set('includeMetadata', 'true');
  }
  if (hasExplicitNoneResourceQueryFilter(descriptor.filters)) {
    params.set('matchNone', 'true');
  }
  const namespaces = stableTypedQuerySelection(descriptor.filters.namespaces);
  if (namespaces.length > 0) {
    params.set('namespaces', namespaces.join(','));
  }
  const kinds = stableTypedQuerySelection(descriptor.filters.kinds);
  if (kinds.length > 0) {
    params.set('kinds', kinds.join(','));
  }
  for (const [key, values] of Object.entries(
    stableTypedQueryFacets(descriptor.filters.queryFacets)
  )) {
    for (const value of values) {
      params.append(`facet.${key}`, value);
    }
  }
  if (descriptor.sortConfig?.key && descriptor.sortConfig.direction) {
    params.set('sort', descriptor.sortConfig.key);
    params.set('sortDirection', descriptor.sortConfig.direction);
  }
  for (const [key, value] of Object.entries(descriptor.predicates ?? {})) {
    if (value) {
      params.set(`predicate.${key}`, value);
    }
  }
  if (descriptor.anchor) {
    // The three page addresses (anchor, startRank, continue) are mutually
    // exclusive on the wire; the most intentful one present wins.
    const anchor = descriptor.anchor;
    params.set('anchor.clusterId', anchor.clusterId);
    if (anchor.group) {
      params.set('anchor.group', anchor.group);
    }
    params.set('anchor.version', anchor.version);
    params.set('anchor.kind', anchor.kind);
    if (anchor.namespace) {
      params.set('anchor.namespace', anchor.namespace);
    }
    params.set('anchor.name', anchor.name);
    if (anchor.uid) {
      params.set('anchor.uid', anchor.uid);
    }
  } else if (typeof descriptor.startRank === 'number' && descriptor.startRank >= 0) {
    params.set('startRank', String(descriptor.startRank));
  } else if (descriptor.continueToken) {
    params.set('continue', descriptor.continueToken);
  }
  const baseScope = descriptor.baseScope ?? 'namespace:all';
  return buildClusterScope(clusterId, `${baseScope}?${params.toString()}`);
}

/**
 * The standard page selector for typed payloads that carry their page as
 * `rows` — shared by every view so the mapping exists once (module-level, so
 * its identity is stable across renders).
 */
export const selectPayloadRows = <TRow>(payload: { rows?: TRow[] | null }): TRow[] =>
  payload.rows ?? [];

export function filterOptionsFromTypedPayload(
  payload: TypedQueryPayload
): Partial<GridTableFilterOptions> {
  const issueLabel = payload.issues?.length
    ? payload.issues.map((issue) => `${issue.kind}: ${issue.message}`).join('\n')
    : undefined;
  const facetsLabel =
    payload.facetsExact === false || payload.facetValues?.some((facet) => !facet.exact)
      ? 'Facet options are approximate because one or more backend data sources were unavailable.'
      : undefined;
  const valuesByKey = new Map((payload.facetValues ?? []).map((facet) => [facet.key, facet]));
  const queryFacets: NonNullable<GridTableFilterOptions['queryFacets']> = (
    payload.capabilities?.queryFacets ?? []
  ).map((descriptor) => ({
    key: descriptor.key,
    label: descriptor.label,
    placeholder: descriptor.placeholder,
    options: valuesByKey.get(descriptor.key)?.options ?? [],
    searchable: descriptor.searchable,
    bulkActions: descriptor.bulkActions,
  }));
  return {
    kinds: payload.kinds,
    namespaces: payload.namespaces,
    totalCount: payload.total,
    unfilteredTotal: payload.unfilteredTotal,
    totalIsExact: payload.totalIsExact,
    queryFacets: queryFacets.length > 0 ? queryFacets : undefined,
    partialDataLabel: [issueLabel, facetsLabel].filter(Boolean).join('\n') || undefined,
  };
}
