/**
 * frontend/src/shared/events/eventGridModel.ts
 *
 * Owns shared Event grid row semantics: search text, related-object identity,
 * stable keys, and action references used by cluster, namespace, and object
 * panel Event surfaces.
 */

import type { CanonicalResourceRef, ResourceLink, ResourceRef } from '@core/refresh/types';
import { buildClusterScopedKey } from '@shared/components/tables/GridTable.utils';
import {
  canResolveEventObjectReference,
  type EventObjectReferenceInput,
  resolveEventObjectReference,
} from '@shared/utils/eventObjectIdentity';
import {
  buildRequiredCanonicalObjectRowKey,
  buildRequiredObjectReference,
  type ResolvedObjectReference,
} from '@shared/utils/objectIdentity';

export interface EventGridRowIdentity {
  ref: CanonicalResourceRef;
  kind?: string;
  clusterName?: string | null;
  object?: string | null;
  objectNamespace?: string | null;
  objectUid?: string | null;
  objectApiVersion?: string | null;
  involvedObject?: ResourceLink | null;
  type?: string | null;
  source?: string | null;
  reason?: string | null;
  message?: string | null;
  age?: string | null;
  ageTimestamp?: number | null;
}

type EventRelatedObjectRow = Omit<EventGridRowIdentity, 'ref'> & {
  ref?: ResourceRef;
  clusterId?: string | null;
  namespace?: string | null;
};

export interface ObjectPanelEventGridRow {
  objectKind?: string | null;
  objectName?: string | null;
  objectNamespace?: string | null;
  objectUid?: string | null;
  objectApiVersion?: string | null;
  involvedObject?: ResourceLink | null;
  clusterId?: string | null;
  clusterName?: string | null;
}

export interface EventRelatedObjectOptions {
  selectedClusterId?: string | null;
  selectedClusterName?: string | null;
  defaultNamespace?: string | null;
  fallbackKind?: string | null;
  fallbackGroup?: string | null;
  fallbackVersion?: string | null;
}

export const eventGridSearchText = (event: EventGridRowIdentity): string[] =>
  [
    event.ref.kind,
    event.ref.name,
    event.kind,
    event.ref.namespace,
    event.type,
    event.source,
    event.reason,
    event.object,
    event.message,
  ].filter((value): value is string => Boolean(value));

export const eventGridObjectNamespace = (
  event: EventRelatedObjectRow,
  defaultNamespace?: string | null
): string | undefined => {
  if (event.objectNamespace && event.objectNamespace.length > 0) {
    return event.objectNamespace;
  }
  const eventNamespace = event.ref?.namespace ?? event.namespace;
  if (eventNamespace && eventNamespace.length > 0) {
    return eventNamespace;
  }
  return defaultNamespace && defaultNamespace.length > 0 ? defaultNamespace : undefined;
};

export const eventGridRelatedObjectInput = (
  event: EventRelatedObjectRow,
  options: EventRelatedObjectOptions = {}
): EventObjectReferenceInput => ({
  object: event.object ?? undefined,
  involvedObject: event.involvedObject ?? undefined,
  objectUid: event.objectUid ?? undefined,
  objectApiVersion: event.objectApiVersion ?? undefined,
  objectNamespace: event.objectNamespace ?? undefined,
  eventNamespace: event.ref?.namespace ?? event.namespace ?? undefined,
  defaultNamespace: options.defaultNamespace ?? undefined,
  clusterId: event.ref?.clusterId ?? event.clusterId ?? options.selectedClusterId ?? undefined,
  clusterName: event.clusterName ?? options.selectedClusterName ?? undefined,
  fallbackKind: options.fallbackKind ?? undefined,
  fallbackGroup: options.fallbackGroup ?? undefined,
  fallbackVersion: options.fallbackVersion ?? undefined,
});

export const eventGridCanOpenRelatedObject = (
  event: EventRelatedObjectRow,
  options?: EventRelatedObjectOptions
): boolean => canResolveEventObjectReference(eventGridRelatedObjectInput(event, options));

export const resolveEventGridRelatedObject = (
  event: EventRelatedObjectRow,
  options?: EventRelatedObjectOptions
): Promise<ResolvedObjectReference | undefined> =>
  resolveEventObjectReference(eventGridRelatedObjectInput(event, options));

export const eventGridStableKey = (
  event: EventGridRowIdentity,
  index: number,
  defaultNamespace?: string | null
): string => {
  const namespace = eventGridObjectNamespace(event, defaultNamespace) ?? '';
  const baseKey = `${namespace}-${event.reason ?? ''}-${event.source ?? ''}-${event.object ?? ''}-${event.ageTimestamp ?? event.age ?? '0'}-${index}`;
  return buildClusterScopedKey(event.ref, baseKey);
};

export const clusterEventRowIdentity = (
  event: EventGridRowIdentity,
  fallbackClusterId?: string | null
): string =>
  buildRequiredCanonicalObjectRowKey(eventGridObjectIdentity(event), { fallbackClusterId });

export const namespaceEventRowIdentity = (
  event: EventGridRowIdentity,
  defaultNamespace: string,
  fallbackClusterId?: string | null
): string =>
  buildRequiredCanonicalObjectRowKey(eventGridObjectIdentity(event, defaultNamespace), {
    fallbackClusterId,
  });

export const objectPanelEventGridRow = (
  event: ObjectPanelEventGridRow,
  clusterScope: string
): EventRelatedObjectRow => ({
  object: `${event.objectKind ?? ''}/${event.objectName ?? ''}`,
  involvedObject: event.involvedObject ?? undefined,
  objectUid: event.objectUid ?? undefined,
  objectApiVersion: event.objectApiVersion ?? undefined,
  objectNamespace:
    event.objectNamespace && event.objectNamespace !== clusterScope
      ? event.objectNamespace
      : undefined,
  clusterId: event.clusterId ?? undefined,
  clusterName: event.clusterName ?? undefined,
});

const eventGridObjectIdentity = (
  event: EventGridRowIdentity,
  defaultNamespace?: string | null
) => ({
  ...event.ref,
  namespace: event.ref.namespace ?? eventGridObjectNamespace(event, defaultNamespace),
  clusterName: event.clusterName ?? undefined,
});

export const eventGridActionReference = <TExtras extends object>(
  event: EventGridRowIdentity,
  fallbackClusterId: string | null | undefined,
  fallbackClusterName: string | null | undefined,
  extras: TExtras
) =>
  buildRequiredObjectReference(
    { ...eventGridObjectIdentity(event), clusterName: fallbackClusterName ?? undefined },
    { fallbackClusterId },
    extras
  );

export const eventGridObjectReference = (
  event: EventGridRowIdentity,
  fallbackClusterId?: string | null,
  fallbackClusterName?: string | null
) =>
  buildRequiredObjectReference(
    { ...eventGridObjectIdentity(event), clusterName: fallbackClusterName ?? undefined },
    { fallbackClusterId }
  );
