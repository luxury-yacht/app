/**
 * frontend/src/components/dockable/DockablePanelHeader.tsx
 *
 * UI component for DockablePanelHeader.
 * When the group has multiple tabs and tab callbacks are provided,
 * renders a DockableTabBar instead of a plain title.
 * Otherwise renders the title as a simple span.
 */

import React from 'react';
import { DockableTabBar } from './DockableTabBar';
import type { TabInfo } from './DockableTabBar';
import type { TabDragState } from './tabGroupTypes';

interface DockablePanelHeaderProps {
  title: string;
  /** Tabs to display in the header. When provided, renders a tab bar. */
  tabs?: TabInfo[];
  /** The panelId of the currently active tab, or null. */
  activeTab?: string | null;
  /** Called when the user clicks a tab to switch to it. */
  onTabClick?: (panelId: string) => void;
  /** Identifier for the tab group (e.g. "bottom", "right"). */
  groupKey?: string;
  onMouseDown: (event: React.MouseEvent) => void;
  controls: React.ReactNode;
  // Drag support (forwarded to DockableTabBar)
  /** Current drag state from the provider. */
  dragState?: TabDragState | null;
  /** Update the drag state in the provider. */
  onDragStateChange?: (state: TabDragState | null) => void;
  /** Reorder a tab within its group. */
  onReorderTab?: (panelId: string, newIndex: number) => void;
  /** Move a tab to a different group. */
  onMoveToGroup?: (panelId: string, targetGroupKey: string, insertIndex?: number) => void;
  /** Undock a tab to a floating panel. */
  onUndockTab?: (panelId: string, cursorX: number, cursorY: number) => void;
}

/**
 * Panel header with title/tab-bar and the controls region.
 * Shows a tab bar whenever tab data is available; otherwise shows the title
 * as a plain label.
 * Drag props are forwarded to DockableTabBar when present.
 */
export const DockablePanelHeader: React.FC<DockablePanelHeaderProps> = ({
  title,
  tabs,
  activeTab,
  onTabClick,
  groupKey,
  onMouseDown,
  controls,
  dragState,
  onDragStateChange,
  onReorderTab,
  onMoveToGroup,
  onUndockTab,
}) => {
  // Render the tab bar whenever tabs are provided so single-tab and multi-tab
  // groups share the same header structure.
  const showTabBar = tabs && tabs.length > 0 && groupKey;

  return (
    <div className="dockable-panel__header" onMouseDown={onMouseDown} role="banner">
      <div className="dockable-panel__header-content">
        {showTabBar ? (
          <DockableTabBar
            tabs={tabs}
            activeTab={activeTab ?? null}
            onTabClick={onTabClick ?? (() => {})}
            groupKey={groupKey}
            dragState={dragState}
            onDragStateChange={onDragStateChange}
            onReorderTab={onReorderTab}
            onMoveToGroup={onMoveToGroup}
            onUndockTab={onUndockTab}
          />
        ) : (
          <span className="dockable-panel__title">{title}</span>
        )}
      </div>
      {controls}
    </div>
  );
};
