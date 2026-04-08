/**
 * frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanelTabs.tsx
 *
 * Object Panel tab strip. Thin wrapper around the shared <Tabs>
 * component that adapts the panel's (tabs, activeTab, onSelect) props
 * to TabDescriptor form, opts out of the shared roving tabindex so
 * the panel's custom focus walker stays in control, and attaches the
 * `data-object-panel-focusable="true"` marker the walker needs.
 */
import { useMemo, type HTMLAttributes } from 'react';

import { Tabs, type TabDescriptor } from '@shared/components/tabs';
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
  const descriptors = useMemo<TabDescriptor[]>(
    () =>
      tabs.map((tab) => ({
        id: tab.id,
        label: tab.label,
        // The object panel's custom focus walker locates focusable
        // scope elements via this data attribute. Pass it through via
        // extraProps so the shared component spreads it onto the
        // underlying <div role="tab">.
        extraProps: { 'data-object-panel-focusable': 'true' } as HTMLAttributes<HTMLElement>,
      })),
    [tabs]
  );

  return (
    <Tabs
      aria-label="Object Panel Tabs"
      tabs={descriptors}
      activeId={activeTab}
      onActivate={(id) => onSelect(id as ViewType)}
      textTransform="uppercase"
      disableRovingTabIndex
    />
  );
}
