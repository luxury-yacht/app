/**
 * frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelFeatureSupport.ts
 *
 * The panel features the object's kind supports (logs source, shell, debug
 * containers), from its kind facets matched by complete identity. A custom
 * resource that shares a built-in kind name gets none of them.
 */
import { lookupKindFacets } from '@shared/kinds/kindFacets';
import { useMemo } from 'react';

import type { FeatureSupport, PanelObjectData } from '../types';

export const useObjectPanelFeatureSupport = (
  objectData: PanelObjectData | null
): FeatureSupport => {
  const group = objectData?.group;
  const version = objectData?.version;
  const kind = objectData?.kind;
  return useMemo<FeatureSupport>(() => {
    const facets = lookupKindFacets({ group, version, kind });
    return {
      logs: facets?.panel.logs ?? 'none',
      shell: facets?.panel.shell ?? 'none',
      debug: facets?.panel.debugContainer ?? false,
      edit: Boolean(kind),
    };
  }, [group, kind, version]);
};
