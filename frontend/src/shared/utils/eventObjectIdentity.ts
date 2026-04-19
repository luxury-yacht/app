import {
  parseApiVersion,
  resolveBuiltinGroupVersion,
} from '@shared/constants/builtinGroupVersions';
import { buildObjectReference, type ResolvedObjectReference } from '@shared/utils/objectIdentity';
import { FindCatalogObjectByUID } from '@wailsjs/go/backend/App';

export interface ParsedEventObjectTarget {
  objectType: string;
  objectName: string;
  isLinkable: boolean;
}

export interface EventObjectReferenceInput {
  object: string | null | undefined;
  objectUid?: string | null;
  objectApiVersion?: string | null;
  objectNamespace?: string | null;
  eventNamespace?: string | null;
  defaultNamespace?: string | null;
  clusterId?: string | null;
  clusterName?: string | null;
  fallbackKind?: string | null;
  fallbackGroup?: string | null;
  fallbackVersion?: string | null;
}

const normalizeOptional = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim() ?? '';
  return trimmed || undefined;
};

export function splitEventObjectTarget(value?: string | null): ParsedEventObjectTarget {
  const raw = (value ?? '').trim();
  if (!raw || raw === '-') {
    return { objectType: '-', objectName: '-', isLinkable: false };
  }

  const [objectType, objectName] = raw.split('/', 2);
  if (!objectName) {
    return { objectType: raw, objectName: '-', isLinkable: false };
  }

  return {
    objectType: objectType || '-',
    objectName: objectName || '-',
    isLinkable: Boolean(objectType && objectName),
  };
}

export function buildEventObjectReference(
  input: EventObjectReferenceInput
): ResolvedObjectReference | undefined {
  const parsed = splitEventObjectTarget(input.object);
  if (!parsed.isLinkable) {
    return undefined;
  }

  const sameKindAsFallback = normalizeOptional(input.fallbackKind) === parsed.objectType;
  const apiVersionParts = input.objectApiVersion
    ? parseApiVersion(input.objectApiVersion)
    : resolveBuiltinGroupVersion(parsed.objectType);
  const version =
    apiVersionParts.version ?? (sameKindAsFallback ? input.fallbackVersion : undefined);

  if (!version) {
    return undefined;
  }

  return buildObjectReference({
    kind: parsed.objectType,
    name: parsed.objectName,
    namespace:
      normalizeOptional(input.objectNamespace) ??
      normalizeOptional(input.eventNamespace) ??
      normalizeOptional(input.defaultNamespace),
    group: apiVersionParts.group ?? (sameKindAsFallback ? input.fallbackGroup : undefined),
    version,
    clusterId: input.clusterId,
    clusterName: input.clusterName,
    uid: input.objectUid,
  });
}

export function canResolveEventObjectReference(input: EventObjectReferenceInput): boolean {
  return Boolean(
    buildEventObjectReference(input) ||
    (normalizeOptional(input.clusterId) && normalizeOptional(input.objectUid))
  );
}

export async function resolveEventObjectReference(
  input: EventObjectReferenceInput
): Promise<ResolvedObjectReference | undefined> {
  const direct = buildEventObjectReference(input);
  if (direct) {
    return direct;
  }

  const clusterId = normalizeOptional(input.clusterId);
  const objectUid = normalizeOptional(input.objectUid);
  if (!clusterId || !objectUid) {
    return undefined;
  }

  const match = await FindCatalogObjectByUID(clusterId, objectUid);
  if (!match) {
    return undefined;
  }

  return buildObjectReference(match);
}
