/**
 * frontend/src/modules/object-panel/hooks/useShowPodsToggle.tsx
 *
 * The "Show Pods" icon-bar toggle shared by the Workloads and Nodes tables.
 * While it is on, opening a row whose kind has a Pods tab opens the object
 * panel on that tab. The state is a per-view app preference, read only when
 * a row is opened, so turning it on leaves an open panel's tab alone.
 */

import { objectKindHasPodsTab } from '@modules/object-panel/components/ObjectPanel/Pods/objectPanelPodsScope';
import type { OpenWithObjectOptions } from '@modules/object-panel/hooks/useObjectPanel';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { CategoryIcon } from '@shared/components/icons/SharedIcons';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { eventBus } from '@/core/events';
import { getShowPods, type ShowPodsView, setShowPods } from '@/core/settings/appPreferences';

export interface ShowPodsToggle {
  /** The icon-bar item for the table's view actions. */
  toggle: IconBarItem;
  /** Panel open options for a row of this kind: the Pods tab while the toggle is on. */
  openOptions: (kind: string) => OpenWithObjectOptions | undefined;
}

const subscribe = (onChange: () => void) => eventBus.on('settings:show-pods', onChange);

export function useShowPodsToggle(view: ShowPodsView): ShowPodsToggle {
  const enabled = useSyncExternalStore(subscribe, () => getShowPods(view));

  const toggle = useMemo<IconBarItem>(
    () => ({
      type: 'toggle',
      id: 'show-pods',
      icon: <CategoryIcon width={18} height={18} />,
      active: enabled,
      onClick: () => setShowPods(view, !getShowPods(view)),
      title: 'Show Pods',
    }),
    [enabled, view]
  );

  const openOptions = useCallback(
    (kind: string): OpenWithObjectOptions | undefined =>
      enabled && objectKindHasPodsTab(kind) ? { initialTab: 'pods' } : undefined,
    [enabled]
  );

  return useMemo(() => ({ toggle, openOptions }), [toggle, openOptions]);
}
