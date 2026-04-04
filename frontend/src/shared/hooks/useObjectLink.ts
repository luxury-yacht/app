/**
 * frontend/src/shared/hooks/useObjectLink.ts
 *
 * Hook that creates paired click / alt+click handlers for object links.
 *
 * - Click → opens the object in the Object Panel
 * - Alt+click → navigates to the object's view and focuses it in the grid table
 *
 * This is the canonical way to wire object links in grid table columns.
 * Define the object reference once; both behaviours come for free.
 *
 * Usage:
 *   const objectLink = useObjectLink();
 *
 *   createTextColumn('name', 'Name', {
 *     ...objectLink((pod) => ({ kind: 'Pod', name: pod.name, ... })),
 *     getClassName: () => 'object-panel-link',
 *   })
 */

import { useCallback } from 'react';
import { useObjectPanel } from '@modules/object-panel/hooks/useObjectPanel';
import { useNavigateToView } from '@shared/hooks/useNavigateToView';
import type { KubernetesObjectReference } from '@/types/view-state';

export function useObjectLink() {
  const { openWithObject } = useObjectPanel();
  const { navigateToView } = useNavigateToView();

  return useCallback(
    <T>(getRef: (item: T) => KubernetesObjectReference | undefined) => ({
      onClick: (item: T) => {
        const ref = getRef(item);
        if (ref) openWithObject(ref);
      },
      onAltClick: (item: T) => {
        const ref = getRef(item);
        if (ref) navigateToView(ref);
      },
    }),
    [openWithObject, navigateToView]
  );
}
