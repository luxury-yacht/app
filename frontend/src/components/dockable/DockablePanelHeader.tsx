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
}

/**
 * Panel header with title/tab-bar and the controls region.
 * Shows a tab bar whenever tab data is available; otherwise shows the title
 * as a plain label.
 */
export const DockablePanelHeader: React.FC<DockablePanelHeaderProps> = ({
  title,
  tabs,
  activeTab,
  onTabClick,
  groupKey,
  onMouseDown,
  controls,
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
          />
        ) : (
          <span className="dockable-panel__title">{title}</span>
        )}
      </div>
      {controls}
    </div>
  );
};
