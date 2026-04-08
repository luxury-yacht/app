/**
 * frontend/src/ui/dockable/DockableTabBar.tsx
 *
 * Horizontal tab bar for switching between panels that share a dock
 * position (tab group). This is a thin wrapper over the shared `<Tabs>`
 * component from `@shared/components/tabs`. It adds:
 *
 *  • a per-tab drag source via `useTabDragSourceFactory`, emitting
 *    `{ kind: 'dockable-tab', panelId, sourceGroupId }` payloads;
 *  • a bar-level drop target via `useTabDropTarget` that forwards to the
 *    provider's `movePanel` adapter (same-group reorders AND cross-group
 *    moves use a single call);
 *  • a `getDragImage` callback that writes the dragged tab's label and
 *    kind class into the provider-owned `.dockable-tab-drag-preview`
 *    element immediately before `setDragImage` takes a snapshot.
 *
 * Overflow scrolling, keyboard navigation, the drop-position indicator,
 * and close-button rendering are all owned by the shared `<Tabs>`
 * component; no custom DOM measurement or scroll math lives in this file.
 */

import React, { type HTMLAttributes } from 'react';
import { Tabs, type TabDescriptor } from '@shared/components/tabs';
import { useTabDragSourceFactory, useTabDropTarget } from '@shared/components/tabs/dragCoordinator';
import { CloseIcon } from '@shared/components/icons/MenuIcons';
import { useDockablePanelContext } from './DockablePanelProvider';

/** Describes a single tab in the bar. */
export interface TabInfo {
  panelId: string;
  title: string;
  /** Optional normalized kind class for compact tab indicators. */
  kindClass?: string;
}

interface DockableTabBarProps {
  /** Ordered list of tabs to display. */
  tabs: TabInfo[];
  /** The panelId of the currently active (visible) tab, or null. */
  activeTab: string | null;
  /** Called when the user clicks a tab to switch to it. */
  onTabClick: (panelId: string) => void;
  /** Identifier for the tab group (e.g. "bottom", "right", "floating-1"). */
  groupKey: string;
}

export const DockableTabBar: React.FC<DockableTabBarProps> = ({
  tabs,
  activeTab,
  onTabClick,
  groupKey,
}) => {
  // Only `dragPreviewRef` (for getDragImage) and `movePanel` (for onDrop)
  // plus `closeTab` (for per-tab close) are read from the provider.
  const { dragPreviewRef, movePanel, closeTab } = useDockablePanelContext();

  // One useContext call for the whole bar regardless of tab count. The
  // returned factory is a plain closure that's legal to call inside .map().
  const makeDragSource = useTabDragSourceFactory();

  const { ref: dropRef, dropInsertIndex } = useTabDropTarget({
    accepts: ['dockable-tab'],
    onDrop: (payload, _event, insertIndex) => {
      // Forward to the provider's movePanel adapter. The adapter
      // dispatches internally between reorderTabInGroup (same group)
      // and movePanelBetweenGroups (cross group) based on whether
      // source and target groups match.
      movePanel(payload.panelId, payload.sourceGroupId, groupKey, insertIndex);
    },
  });

  const tabDescriptors: TabDescriptor[] = tabs.map((tab) => {
    const dragProps = makeDragSource(
      { kind: 'dockable-tab', panelId: tab.panelId, sourceGroupId: groupKey },
      {
        getDragImage: () => {
          const previewEl = dragPreviewRef.current;
          if (!previewEl) return null;
          const labelEl = previewEl.querySelector<HTMLSpanElement>(
            '.dockable-tab-drag-preview__label'
          );
          if (labelEl) {
            labelEl.textContent = tab.title;
          }
          const kindEl = previewEl.querySelector<HTMLSpanElement>(
            '.dockable-tab-drag-preview__kind'
          );
          if (kindEl) {
            kindEl.className = `dockable-tab-drag-preview__kind kind-badge${
              tab.kindClass ? ` ${tab.kindClass}` : ''
            }`;
          }
          return { element: previewEl, offsetX: 14, offsetY: 16 };
        },
      }
    );
    return {
      id: tab.panelId,
      label: tab.title,
      leading: tab.kindClass ? (
        <span
          className={`dockable-tab__kind-indicator kind-badge ${tab.kindClass}`}
          aria-hidden="true"
        />
      ) : undefined,
      closeIcon: <CloseIcon width={10} height={10} />,
      closeAriaLabel: `Close ${tab.title}`,
      onClose: () => closeTab(tab.panelId),
      extraProps: {
        'data-panel-id': tab.panelId,
        ...dragProps,
      } as HTMLAttributes<HTMLElement>,
    };
  });

  return (
    <div ref={dropRef as (el: HTMLDivElement | null) => void} className="dockable-tab-bar-shell">
      <Tabs
        aria-label="Object Tabs"
        tabs={tabDescriptors}
        activeId={activeTab}
        onActivate={onTabClick}
        dropInsertIndex={dropInsertIndex}
        className="dockable-tab-bar"
      />
    </div>
  );
};
