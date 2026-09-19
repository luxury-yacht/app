/**
 * frontend/src/modules/object-map/objectMapNavigation.ts
 *
 * Converts object-map references into view navigation targets.
 */

import {
  assertObjectRefHasRequiredIdentity,
  buildRequiredObjectReference,
  type ResolvedObjectReference,
} from '@shared/utils/objectIdentity';
import { useMemo } from 'react';
import type { ObjectMapReference } from '@/core/refresh/types';
import { errorHandler } from '@/utils/errorHandler';

const buildResolvedFromMapRef = (ref: ObjectMapReference): ResolvedObjectReference | null => {
  try {
    assertObjectRefHasRequiredIdentity({ ...ref });
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

export const useObjectMapNavigation = (
  openWithObject: (ref: ResolvedObjectReference, options?: { initialTab: 'map' }) => void,
  navigateToView: (ref: ResolvedObjectReference) => void
) =>
  useMemo(
    () => ({
      handleOpenPanel: (ref: ObjectMapReference) => {
        const resolved = buildResolvedFromMapRef(ref);
        if (resolved) {
          openWithObject(resolved);
        }
      },
      handleNavigateView: (ref: ObjectMapReference) => {
        const resolved = buildResolvedFromMapRef(ref);
        if (resolved) {
          navigateToView(resolved);
        }
      },
      handleOpenObjectMap: (ref: ObjectMapReference) => {
        const resolved = buildResolvedFromMapRef(ref);
        if (resolved) {
          openWithObject(resolved, { initialTab: 'map' });
        }
      },
    }),
    [openWithObject, navigateToView]
  );
