import { buildClusterScope } from '@/core/refresh/clusterScope';
import type {
  GridTableFilterOptions,
  GridTableFilterState,
} from '@shared/components/tables/GridTable';
import type { SortConfig } from '@hooks/useTableSort';
import type { ResourceQueryDynamicRef } from '@/core/refresh/types';

export interface TypedQueryPayload {
  continue?: string;
  cursorInvalid?: boolean;
  total?: number;
  totalIsExact?: boolean;
  namespaces?: string[];
  kinds?: string[];
  facetsExact?: boolean;
  dynamic?: ResourceQueryDynamicRef;
}

export interface TypedResourceQueryDescriptor {
  filters: GridTableFilterState;
  sortConfig: SortConfig | null;
  pageLimit: number;
  predicates?: Record<string, string | null | undefined>;
  continueToken?: string | null;
}

export interface TypedResourceQueryLifecycleDescriptor extends TypedResourceQueryDescriptor {
  enabled: boolean;
  clusterId?: string | null;
  domain: string;
}

const stableTypedQueryList = (values: string[]) =>
  values
    .map((value) => value.trim())
    .filter(Boolean)
    .sort((a, b) => a.localeCompare(b));

export const typedResourceQueryIdentity = ({
  filters,
  sortConfig,
  predicates,
}: Pick<TypedResourceQueryDescriptor, 'filters' | 'sortConfig' | 'predicates'>) =>
  JSON.stringify({
    search: filters.search,
    caseSensitive: filters.caseSensitive,
    kinds: stableTypedQueryList(filters.kinds),
    namespaces: stableTypedQueryList(filters.namespaces),
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
  filters,
  sortConfig,
  predicates,
}: TypedResourceQueryLifecycleDescriptor) =>
  JSON.stringify({
    enabled,
    clusterId: clusterId?.trim() ?? '',
    domain,
    pageLimit,
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
  const namespaces = stableTypedQueryList(descriptor.filters.namespaces);
  if (namespaces.length > 0) {
    params.set('namespaces', namespaces.join(','));
  }
  const kinds = stableTypedQueryList(descriptor.filters.kinds);
  if (kinds.length > 0) {
    params.set('kinds', kinds.join(','));
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
  if (descriptor.continueToken) {
    params.set('continue', descriptor.continueToken);
  }
  return buildClusterScope(clusterId, `namespace:all?${params.toString()}`);
}

export function filterOptionsFromTypedPayload(
  payload: TypedQueryPayload
): Partial<GridTableFilterOptions> {
  return {
    kinds: payload.kinds,
    namespaces: payload.namespaces,
    totalCount: payload.total,
    totalIsExact: payload.totalIsExact,
  };
}
