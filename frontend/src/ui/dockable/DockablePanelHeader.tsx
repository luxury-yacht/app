/**
 * frontend/src/components/dockable/DockablePanelHeader.tsx
 *
 * UI component for DockablePanelHeader.
 * When the group has multiple tabs and tab callbacks are provided,
 * renders a DockableTabBar instead of a plain title.
 * Otherwise renders the title as a simple span.
 */

import type React from 'react';
import type { TabInfo } from './DockableTabBar';
import { DockableTabBar } from './DockableTabBar';

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
  controls,
}) => {
  // Render the tab bar whenever tabs are provided so single-tab and multi-tab
  // groups share the same header structure.
  const showTabBar = tabs && tabs.length > 0 && groupKey;

  return (
    <header className="dockable-panel__header">
      <div className="dockable-panel__header-content">
        {showTabBar ? (
          <DockableTabBar
            tabs={tabs}
            activeTab={activeTab ?? null}
            onTabClick={onTabClick ?? (() => undefined)}
            groupKey={groupKey}
          />
        ) : (
          <span className="dockable-panel__title">{title}</span>
        )}
      </div>
      {controls}
    </header>
  );
};
