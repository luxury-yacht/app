import type { KubernetesObjectReference } from '@/types/view-state';
import { buildRequiredCanonicalObjectRowKey } from '@shared/utils/objectIdentity';
import { resolveBuiltinGroupVersion } from '@shared/constants/builtinGroupVersions';

export interface GridTableFocusRequest {
  kind: string;
  name: string;
  namespace?: string;
  clusterId: string;
  rowKey?: string;
  /**
   * The navigation destination this request is aimed at (`${viewType}-${tab}`,
   * matching a table's `viewId`). Set by useNavigateToView so ONLY the
   * destination table turns an unmatched request into an anchor jump — a
   * same-cluster non-target table (e.g. an object-panel pods list) must not
   * consume it and fire a false not-found.
   */
  destinationViewId?: string;
  /**
   * Full-reference fields: kept so a query-backed table can turn an
   * unmatched request into a backend anchor jump (which requires a full
   * object reference — version at minimum). Absent when the entry point's
   * ref lacked them and no builtin backfill applied; anchoring then degrades
   * to the current-page-only match.
   */
  group?: string;
  version?: string;
  uid?: string;
}

const normalizeString = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed || undefined;
};

export const buildGridTableFocusRequest = (
  objectRef: KubernetesObjectReference
): GridTableFocusRequest | null => {
  const kind = normalizeString(objectRef.kind ?? objectRef.metadata?.kind);
  const name = normalizeString(objectRef.name ?? objectRef.metadata?.name);
  const namespace = normalizeString(objectRef.namespace ?? objectRef.metadata?.namespace);
  const clusterId = normalizeString(objectRef.clusterId);

  if (!kind || !name || !clusterId) {
    return null;
  }

  let rowKey: string | undefined;
  try {
    rowKey = buildRequiredCanonicalObjectRowKey({
      kind,
      name,
      namespace,
      clusterId,
      clusterName: normalizeString(objectRef.clusterName),
      group: normalizeString(objectRef.group),
      version: normalizeString(objectRef.version),
      resource: normalizeString(objectRef.resource),
      uid: normalizeString(objectRef.uid),
    });
  } catch {
    rowKey = undefined;
  }

  // Retain the full-reference fields (backfilling builtin group/version the
  // same way the canonical row key does) so an unmatched request can become a
  // backend anchor jump.
  const builtinGVK = resolveBuiltinGroupVersion(kind);
  const group = normalizeString(objectRef.group) ?? builtinGVK.group ?? undefined;
  const version = normalizeString(objectRef.version) ?? builtinGVK.version ?? undefined;

  return {
    kind,
    name,
    namespace,
    clusterId,
    rowKey,
    group,
    version,
    uid: normalizeString(objectRef.uid),
  };
};

export function matchesGridTableFocusRequest<T>(
  item: T,
  index: number,
  keyExtractor: (item: T, index: number) => string,
  request: GridTableFocusRequest
): boolean {
  if (request.rowKey) {
    return keyExtractor(item, index) === request.rowKey;
  }

  const row = item as Record<string, unknown>;
  const rowName = normalizeString(row.name);
  if (rowName !== request.name) {
    return false;
  }

  const rowClusterId = normalizeString(row.clusterId);
  if (rowClusterId !== request.clusterId) {
    return false;
  }

  const rowKind = normalizeString(row.kind);
  if (rowKind && rowKind.toLowerCase() !== request.kind.toLowerCase()) {
    return false;
  }

  if (request.namespace !== undefined) {
    const rowNamespace = normalizeString(row.namespace);
    if (rowNamespace && rowNamespace !== request.namespace) {
      return false;
    }
  }

  return true;
}
