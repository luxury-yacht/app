/**
 * frontend/src/shared/utils/resourceLinkIdentity.ts
 *
 * Validates backend ResourceLink payloads and resolves them into canonical
 * frontend object references, using catalog lookups when only UID or display
 * information is available.
 */

import {
  readCatalogObjectByUID,
  readCatalogObjectMatchForRef,
  requestData,
} from '@/core/data-access';
import type { DisplayRef, ResourceLink, ResourceRef } from '@core/refresh/types';
import { resolveBuiltinGroupVersion } from '@shared/constants/builtinGroupVersions';
import {
  buildRequiredObjectReference,
  type ResolvedObjectReference,
} from '@shared/utils/objectIdentity';

const normalizeOptional = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim() ?? '';
  return trimmed || undefined;
};

const validateResourceRef = (ref?: ResourceRef | null): boolean =>
  Boolean(validateResourceRefReason(ref) === undefined);

const validateResourceRefReason = (ref?: ResourceRef | null): string | undefined => {
  const clusterId = normalizeOptional(ref?.clusterId);
  const version = normalizeOptional(ref?.version);
  const kind = normalizeOptional(ref?.kind);
  const name = normalizeOptional(ref?.name);
  if (!clusterId) {
    return 'clusterId';
  }
  if (!version) {
    return 'version';
  }
  if (!kind) {
    return 'kind';
  }
  if (!name) {
    return 'name';
  }

  const groupWasCarried = ref?.group !== undefined && ref.group !== null;
  const group = normalizeOptional(ref?.group) ?? '';
  const builtinGVK = resolveBuiltinGroupVersion(kind);
  const isKnownBuiltin = Boolean(builtinGVK.version);
  if (!groupWasCarried || (!group && (!isKnownBuiltin || builtinGVK.group))) {
    return 'group';
  }
  return undefined;
};

const validateDisplayRef = (ref?: DisplayRef | null): boolean =>
  Boolean(
    normalizeOptional(ref?.clusterId) &&
      normalizeOptional(ref?.kind) &&
      normalizeOptional(ref?.name)
  );

export const validateResourceLink = (link?: ResourceLink | null): boolean => {
  if (!link) {
    return false;
  }
  if (link.ref && link.display) {
    return false;
  }
  if (link.ref) {
    return validateResourceRef(link.ref);
  }
  if (link.display) {
    return validateDisplayRef(link.display);
  }
  return false;
};

const resourceRefToObjectReference = (
  ref: ResourceRef,
  clusterName?: string | null
): ResolvedObjectReference => {
  return buildRequiredObjectReference({
    clusterId: ref.clusterId,
    clusterName,
    group: ref.group,
    version: ref.version,
    kind: ref.kind,
    resource: ref.resource,
    namespace: ref.namespace,
    name: ref.name,
    uid: ref.uid,
  });
};

export const resourceLinkToObjectReference = (
  link?: ResourceLink | null,
  clusterName?: string | null
): ResolvedObjectReference | undefined => {
  if (!link || link.display || !link.ref || !validateResourceRef(link.ref)) {
    return undefined;
  }
  return resourceRefToObjectReference(link.ref, clusterName);
};

export const resourceLinkDisplayKind = (link?: ResourceLink | null): string | undefined =>
  normalizeOptional(link?.ref?.kind) ?? normalizeOptional(link?.display?.kind);

export const resolveCatalogObjectByUID = async (
  clusterId?: string | null,
  uid?: string | null
): Promise<ResolvedObjectReference | undefined> => {
  const normalizedClusterId = normalizeOptional(clusterId);
  const normalizedUID = normalizeOptional(uid);
  if (!normalizedClusterId || !normalizedUID) {
    return undefined;
  }

  const result = await requestData({
    resource: 'catalog-object-by-uid',
    reason: 'user',
    read: () => readCatalogObjectByUID(normalizedClusterId, normalizedUID),
  });
  const match = result.status === 'executed' ? result.data : null;
  return match ? buildRequiredObjectReference(match) : undefined;
};

export const resolveCatalogObjectMatch = async (
  ref: ResourceRef
): Promise<ResolvedObjectReference | undefined> => {
  if (!validateResourceRef(ref)) {
    return undefined;
  }

  const result = await requestData({
    resource: 'catalog-object-match',
    reason: 'user',
    read: () => readCatalogObjectMatchForRef({ ...ref, name: ref.name ?? '' }),
  });
  const match = result.status === 'executed' ? result.data : null;
  return match ? buildRequiredObjectReference(match) : undefined;
};
