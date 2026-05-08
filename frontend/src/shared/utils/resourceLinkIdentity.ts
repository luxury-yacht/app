import { readCatalogObjectByUID, readCatalogObjectMatch, requestData } from '@/core/data-access';
import type { DisplayRef, ResourceLink, ResourceRef } from '@core/refresh/types';
import {
  buildRequiredObjectReference,
  type ResolvedObjectReference,
} from '@shared/utils/objectIdentity';

const normalizeOptional = (value: string | null | undefined): string | undefined => {
  const trimmed = value?.trim() ?? '';
  return trimmed || undefined;
};

const validateResourceRef = (ref?: ResourceRef | null): boolean =>
  Boolean(
    normalizeOptional(ref?.clusterId) &&
    normalizeOptional(ref?.version) &&
    normalizeOptional(ref?.kind) &&
    normalizeOptional(ref?.name)
  );

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
    read: () =>
      readCatalogObjectMatch(
        ref.clusterId,
        ref.namespace ?? '',
        ref.group,
        ref.version,
        ref.kind,
        ref.name ?? ''
      ),
  });
  const match = result.status === 'executed' ? result.data : null;
  return match ? buildRequiredObjectReference(match) : undefined;
};
