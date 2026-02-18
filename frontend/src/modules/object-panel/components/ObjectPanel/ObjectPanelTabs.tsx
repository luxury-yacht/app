/**
 * frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelTabs.tsx
 *
 * UI component for ObjectPanelTabs.
 * Handles rendering and interactions for the object panel feature.
 */

import type { ViewType } from '@modules/object-panel/components/ObjectPanel/types';

type ObjectPanelTabDefinition = {
  id: string;
  label: string;
};

interface ObjectPanelTabsProps {
  tabs: ObjectPanelTabDefinition[];
  activeTab: ViewType;
  onSelect: (tab: ViewType) => void;
}

export function ObjectPanelTabs({ tabs, activeTab, onSelect }: ObjectPanelTabsProps) {
  return (
    <div className="tab-strip">
      {tabs.map((tab) => {
        const isActive = activeTab === (tab.id as ViewType);
        return (
          <button
            key={tab.id}
            className={`tab-item${isActive ? ' tab-item--active' : ''}`}
            onClick={() => onSelect(tab.id as ViewType)}
            type="button"
            data-object-panel-focusable="true"
            tabIndex={-1}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
