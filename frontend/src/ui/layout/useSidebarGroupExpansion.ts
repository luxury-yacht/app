import { useViewState } from '@core/contexts/ViewStateContext';
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { eventBus } from '@/core/events';
import type { SidebarViewGroupId } from '@/core/navigation/viewRegistry';
import {
  getSidebarGroupExpanded,
  type SidebarGroupScope,
  setSidebarGroupExpanded,
} from '@/core/settings/appPreferences';

const subscribe = (onChange: () => void) => eventBus.on('settings:sidebar-expansion', onChange);

export const useSidebarGroupExpansion = (
  scope: SidebarGroupScope,
  selectedView: { readonly sidebarGroup: 'primary' | SidebarViewGroupId } | undefined
) => {
  const { sidebarSelection } = useViewState();
  const resources = useSyncExternalStore(subscribe, () =>
    getSidebarGroupExpanded(scope, 'resources')
  );
  const extensions = useSyncExternalStore(subscribe, () =>
    getSidebarGroupExpanded(scope, 'extensions')
  );

  const previousSelection = useRef(sidebarSelection);

  // Explicit navigation reveals its destination again after a manual collapse.
  // Preference updates and unrelated renders must preserve the user's disclosure.
  useEffect(() => {
    if (previousSelection.current === sidebarSelection) {
      return;
    }
    // Discovery may arrive after navigation; consume the request only once
    // its destination is available in this scope.
    if (!selectedView) {
      return;
    }
    previousSelection.current = sidebarSelection;
    const group = selectedView.sidebarGroup;
    if (
      sidebarSelection &&
      group &&
      group !== 'primary' &&
      !getSidebarGroupExpanded(scope, group)
    ) {
      setSidebarGroupExpanded(scope, group, true);
    }
  }, [scope, selectedView, sidebarSelection]);

  return {
    isGroupExpanded: (group: SidebarViewGroupId) =>
      group === 'resources' ? resources : extensions,
    toggleGroup: (group: SidebarViewGroupId) =>
      setSidebarGroupExpanded(scope, group, !getSidebarGroupExpanded(scope, group)),
  };
};
