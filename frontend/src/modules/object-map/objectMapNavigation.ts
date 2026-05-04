import { errorHandler } from '@/utils/errorHandler';
import type { ObjectMapReference } from '@/core/refresh/types';
import {
  buildRequiredObjectReference,
  type ResolvedObjectReference,
} from '@shared/utils/objectIdentity';

export const buildResolvedFromMapRef = (
  ref: ObjectMapReference
): ResolvedObjectReference | null => {
  try {
    return buildRequiredObjectReference({
      kind: ref.kind,
      name: ref.name,
      namespace: ref.namespace ?? undefined,
      clusterId: ref.clusterId,
      clusterName: ref.clusterName ?? undefined,
      group: ref.group,
      version: ref.version,
      resource: ref.resource ?? undefined,
      uid: ref.uid ?? undefined,
    });
  } catch (error) {
    errorHandler.handle(error instanceof Error ? error : new Error(String(error)), {
      source: 'object-map-build-ref',
    });
    return null;
  }
};
