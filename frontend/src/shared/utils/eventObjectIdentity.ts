import type { ResourceLink } from '@core/refresh/types';
import type { ResolvedObjectReference } from '@shared/utils/objectIdentity';
import {
  resolveCatalogObjectByUID,
  resourceLinkToObjectReference,
  validateResourceLink,
} from '@shared/utils/resourceLinkIdentity';

// Only the backend's involved-object link identifies the object an Event is
// about. An openable link opens directly; anything else (a display-only link,
// or no link because the Event named no kind or name) resolves only through
// the catalog by UID. Group and version are never guessed from the kind.
export interface EventObjectReferenceInput {
  involvedObject?: ResourceLink | null;
  objectUid?: string | null;
  clusterId?: string | null;
  clusterName?: string | null;
}

const normalizeOptional = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim() ?? '';
  return trimmed || undefined;
};

const objectUid = (input: EventObjectReferenceInput): string | undefined =>
  normalizeOptional(input.objectUid) ?? normalizeOptional(input.involvedObject?.display?.uid);

export function buildEventObjectReference(
  input: EventObjectReferenceInput
): ResolvedObjectReference | undefined {
  if (!input.involvedObject?.ref) {
    return undefined;
  }
  try {
    return resourceLinkToObjectReference(input.involvedObject, input.clusterName);
  } catch {
    return undefined;
  }
}

export function canResolveEventObjectReference(input: EventObjectReferenceInput): boolean {
  if (input.involvedObject?.ref) {
    return validateResourceLink(input.involvedObject);
  }
  return Boolean(normalizeOptional(input.clusterId) && objectUid(input));
}

export async function resolveEventObjectReference(
  input: EventObjectReferenceInput
): Promise<ResolvedObjectReference | undefined> {
  if (input.involvedObject?.ref) {
    return buildEventObjectReference(input);
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
