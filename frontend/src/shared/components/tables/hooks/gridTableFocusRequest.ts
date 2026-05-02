import type { KubernetesObjectReference } from '@/types/view-state';
import { buildRequiredCanonicalObjectRowKey } from '@shared/utils/objectIdentity';

export interface GridTableFocusRequest {
  kind: string;
  name: string;
  namespace?: string;
  clusterId: string;
  rowKey?: string;
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

  return {
    kind,
    name,
    namespace,
    clusterId,
    rowKey,
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
