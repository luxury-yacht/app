/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelFeatureSupport.ts
 *
 * Determines feature support for the object panel based on object kind and resource capabilities.
 * Returns a structured feature support object indicating available features.
 */
import { useMemo } from 'react';

import type { FeatureSupport, ResourceCapability } from '../types';

export const useObjectPanelFeatureSupport = (
  objectKind: string | null,
  resourceCapabilities: Record<string, ResourceCapability>,
  isHelmRelease = false
): FeatureSupport => {
  return useMemo<FeatureSupport>(() => {
    const definition = objectKind ? resourceCapabilities[objectKind] : undefined;
    const hasKind = Boolean(objectKind);
    return {
      objPanelLogs: Boolean(definition?.objPanelLogs),
      nodeLogs: Boolean(definition?.nodeLogs),
      manifest: hasKind && isHelmRelease,
      values: hasKind && isHelmRelease,
      delete: hasKind && (definition ? Boolean(definition.delete) : true),
      restart: Boolean(definition?.restart),
      scale: Boolean(definition?.scale),
      edit: hasKind && (definition?.edit === undefined || Boolean(definition.edit)),
      shell: Boolean(definition?.shell),
      debug: Boolean(definition?.debug),
      trigger: Boolean(definition?.trigger),
      suspend: Boolean(definition?.suspend),
    };
  }, [isHelmRelease, objectKind, resourceCapabilities]);
};
