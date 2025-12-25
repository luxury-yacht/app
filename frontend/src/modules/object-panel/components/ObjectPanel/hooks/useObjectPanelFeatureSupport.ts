/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelFeatureSupport.ts
 *
 * Hook for useObjectPanelFeatureSupport.
 */
import { useMemo } from 'react';

import type { FeatureSupport, ResourceCapability } from '../types';

export const useObjectPanelFeatureSupport = (
  objectKind: string | null,
  resourceCapabilities: Record<string, ResourceCapability>
): FeatureSupport => {
  return useMemo<FeatureSupport>(() => {
    if (!objectKind) {
      return {
        logs: false,
        manifest: false,
        values: false,
        delete: false,
        restart: false,
        scale: false,
        edit: false,
        shell: false,
      };
    }

    const definition = resourceCapabilities[objectKind];
    const isHelmRelease = objectKind === 'helmrelease';

    if (!definition) {
      return {
        logs: false,
        manifest: isHelmRelease,
        values: isHelmRelease,
        delete: true,
        restart: false,
        scale: false,
        edit: true,
        shell: false,
      };
    }

    return {
      logs: Boolean(definition.logs),
      manifest: isHelmRelease,
      values: isHelmRelease,
      delete: Boolean(definition.delete),
      restart: Boolean(definition.restart),
      scale: Boolean(definition.scale),
      edit: definition.edit === undefined ? true : Boolean(definition.edit),
      shell: Boolean(definition.shell),
    };
  }, [objectKind, resourceCapabilities]);
};
