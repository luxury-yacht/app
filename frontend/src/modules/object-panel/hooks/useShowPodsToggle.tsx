/**
 * frontend/src/modules/object-panel/hooks/useShowPodsToggle.tsx
 *
 * The "Show Pods" icon-bar toggle shared by the Workloads and Nodes tables.
 * While it is on, activating a row whose kind has pods shows them in the
 * cluster's Pods dock tab. The state is a per-view app preference; turning it
 * off closes any Pods tab this table opened.
 */

import { objectKindHasPodsTab } from '@modules/object-panel/components/ObjectPanel/Pods/objectPanelPodsScope';
import { useOptionalPodsPanelState } from '@modules/object-panel/contexts/PodsPanelStateContext';
import type { ObjectPanelRef } from '@modules/object-panel/objectPanelRef';
import type { IconBarItem } from '@shared/components/IconBar/IconBar';
import { CategoryIcon } from '@shared/components/icons/SharedIcons';
import { buildRequiredCanonicalObjectRowKey } from '@shared/utils/objectIdentity';
import { useMemo, useSyncExternalStore } from 'react';
import { eventBus } from '@/core/events';
import { getShowPods, type ShowPodsView, setShowPods } from '@/core/settings/appPreferences';

export interface ShowPodsToggle {
  /** The icon-bar item for the table's view actions. */
  toggle: IconBarItem;
  /** Row activation while the toggle is on: shows the object's pods. Undefined while off. */
  showPods?: (object: ObjectPanelRef) => void;
  /** Row key of the object whose pods this table's Pods tab shows, for the row highlight. */
  shownRowKey: string | null;
}

const subscribe = (onChange: () => void) => eventBus.on('settings:show-pods', onChange);

export function useShowPodsToggle(view: ShowPodsView): ShowPodsToggle {
  const enabled = useSyncExternalStore(subscribe, () => getShowPods(view));
  const podsPanel = useOptionalPodsPanelState();
  const target = podsPanel?.target ?? null;
  const show = podsPanel?.show;
  const closeSource = podsPanel?.closeSource;

  const toggle = useMemo<IconBarItem>(
    () => ({
      type: 'toggle',
      id: 'show-pods',
      icon: <CategoryIcon width={18} height={18} />,
      active: enabled,
      onClick: () => {
        const next = !getShowPods(view);
        setShowPods(view, next);
        if (!next) {
          closeSource?.(view);
        }
      },
      title: 'Show Pods',
    }),
    [closeSource, enabled, view]
  );

  const showPods = useMemo(
    () =>
      enabled && show
        ? (object: ObjectPanelRef) => {
            if (objectKindHasPodsTab(object.kind)) {
              show(object, view);
            }
          }
        : undefined,
    [enabled, show, view]
  );

  const shownRowKey = useMemo(
    () => (target?.source === view ? buildRequiredCanonicalObjectRowKey(target.object) : null),
    [target, view]
  );

  return useMemo(() => ({ toggle, showPods, shownRowKey }), [showPods, shownRowKey, toggle]);
}
