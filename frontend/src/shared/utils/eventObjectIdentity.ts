import type { ResourceLink } from '@core/refresh/types';
import {
  parseApiVersion,
  resolveBuiltinGroupVersion,
} from '@shared/constants/builtinGroupVersions';
import {
  buildRequiredObjectReference,
  type ResolvedObjectReference,
} from '@shared/utils/objectIdentity';
import {
  resolveCatalogObjectByUID,
  resourceLinkToObjectReference,
  validateResourceLink,
} from '@shared/utils/resourceLinkIdentity';

export interface EventObjectReferenceInput {
  involvedObject?: ResourceLink | null;
  objectKind?: string | null;
  objectName?: string | null;
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

// A display-only link is the backend saying it could not identify the object.
// It is never opened from a guessed group or version; only the catalog can
// resolve it, by UID.
const isDisplayOnlyLink = (input: EventObjectReferenceInput): boolean =>
  Boolean(input.involvedObject && !input.involvedObject.ref);

const objectUid = (input: EventObjectReferenceInput): string | undefined =>
  normalizeOptional(input.objectUid) ?? normalizeOptional(input.involvedObject?.display?.uid);

export function buildEventObjectReference(
  input: EventObjectReferenceInput
): ResolvedObjectReference | undefined {
  if (input.involvedObject?.ref) {
    return openableLinkReference(input);
  }
  return isDisplayOnlyLink(input) ? undefined : flatObjectReference(input);
}

const openableLinkReference = (
  input: EventObjectReferenceInput
): ResolvedObjectReference | undefined => {
  try {
    return input.involvedObject
      ? resourceLinkToObjectReference(input.involvedObject, input.clusterName)
      : undefined;
  } catch {
    return undefined;
  }
};

// Builds the reference from the Event row's own involved-object fields when the
// backend sent no link (the Overview's Recent Events).
const flatObjectReference = (
  input: EventObjectReferenceInput
): ResolvedObjectReference | undefined => {
  const kind = normalizeOptional(input.objectKind);
  const name = normalizeOptional(input.objectName);
  if (!kind || !name) {
    return undefined;
  }

  const sameKindAsFallback = normalizeOptional(input.fallbackKind) === kind;
  const apiVersionParts = input.objectApiVersion
    ? parseApiVersion(input.objectApiVersion)
    : resolveBuiltinGroupVersion(kind);
  const version =
    apiVersionParts.version ?? (sameKindAsFallback ? input.fallbackVersion : undefined);
  if (!version) {
    return undefined;
  }

  try {
    return buildRequiredObjectReference({
      kind,
      name,
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
  } catch {
    return undefined;
  }
};

export function canResolveEventObjectReference(input: EventObjectReferenceInput): boolean {
  if (input.involvedObject?.ref) {
    return validateResourceLink(input.involvedObject);
  }

  return Boolean(
    buildEventObjectReference(input) || (normalizeOptional(input.clusterId) && objectUid(input))
  );
}

export async function resolveEventObjectReference(
  input: EventObjectReferenceInput
): Promise<ResolvedObjectReference | undefined> {
  if (input.involvedObject?.ref) {
    return buildEventObjectReference(input);
  }

  const direct = buildEventObjectReference(input);
  if (direct) {
    return direct;
  }

  const clusterId = normalizeOptional(input.clusterId);
  const uid = objectUid(input);
  if (!clusterId || !uid) {
    return undefined;
  }

  try {
    return await resolveCatalogObjectByUID(clusterId, uid);
  } catch {
    return undefined;
  }
}
