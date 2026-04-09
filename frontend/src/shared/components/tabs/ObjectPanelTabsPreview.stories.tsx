/**
 * frontend/src/shared/components/tabs/ObjectPanelTabsPreview.stories.tsx
 *
 * Preview of the Object Panel tab strip after Phase 2 migrates it to the
 * shared <Tabs> component. Renders a typical Deployment view (Details, Pods,
 * Logs, Events, YAML) using the exact configuration the Object Panel will
 * use post-migration.
 *
 * This file PARALLELS the existing Object Panel — it does not replace it.
 * The real migration (ObjectPanelTabs.tsx + useObjectPanelTabs.ts) is
 * Phase 2 and is intentionally untouched here.
 *
 * Tab labels are sourced 1:1 from
 * `frontend/src/modules/object-panel/components/ObjectPanel/constants.ts`'s
 * `TABS` constant. If the constants change, update this file to match.
 */

import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Tabs, type TabDescriptor, type TabsProps } from './';
import { ThemeProviderDecorator } from '../../../../.storybook/decorators/ThemeProviderDecorator';
import './stories.css';

// Lightweight action logger. The project doesn't install @storybook/addon-actions,
// so we log to the browser console instead — same pattern as Tabs.stories.tsx.
const logAction =
  (name: string) =>
  (...args: unknown[]): void => {
    console.log(`[ObjectPanelTabsPreview story] ${name}`, ...args);
  };

/**
 * Small wrapper that owns `activeId` state so the story can render the
 * fully-controlled <Tabs> without boilerplate. Wraps the strip in a
 * fixed-width viewport via the `tabs-story-viewport` class (see
 * `stories.css`) so the styling path mirrors how a real container would
 * constrain the strip rather than an inline style.
 */
interface TabsHarnessProps extends Omit<TabsProps, 'activeId' | 'onActivate'> {
  initialActiveId: string | null;
}

function TabsHarness({ initialActiveId, tabs, ...rest }: TabsHarnessProps) {
  const [activeId, setActiveId] = useState<string | null>(initialActiveId);
  const handleActivate = (id: string) => {
    logAction('onActivate')(id);
    setActiveId(id);
  };
  return (
    <div className="tabs-story-viewport">
      <Tabs {...rest} tabs={tabs} activeId={activeId} onActivate={handleActivate} />
    </div>
  );
}

// Tab descriptors sourced from
// `frontend/src/modules/object-panel/components/ObjectPanel/constants.ts`.
// Keep these label strings in sync with the `TABS` constant there.
const DETAILS_TAB: TabDescriptor = { id: 'details', label: 'Details' };
const PODS_TAB: TabDescriptor = { id: 'pods', label: 'Pods' };
const LOGS_TAB: TabDescriptor = { id: 'logs', label: 'Logs' };
const EVENTS_TAB: TabDescriptor = { id: 'events', label: 'Events' };
const YAML_TAB: TabDescriptor = { id: 'yaml', label: 'YAML' };

const meta: Meta<typeof TabsHarness> = {
  title: 'Shared/Tabs',
  component: TabsHarness,
  decorators: [ThemeProviderDecorator],
  parameters: {
    layout: 'padded',
  },
};

export default meta;
type Story = StoryObj<typeof TabsHarness>;

/**
 * Object Panel — preview of the tab strip after Phase 2 migration to the
 * shared <Tabs> component. Renders a typical Deployment view: Details, Pods,
 * Logs, Events, YAML. Configuration matches the Object Panel design doc:
 * `aria-label="Object Panel Tabs"`, `textTransform="uppercase"`, default
 * `'fit'` sizing, no close buttons, no leading slot.
 */
export const ObjectPanelTabs: Story = {
  args: {
    'aria-label': 'Object Panel Tabs',
    textTransform: 'uppercase',
    initialActiveId: 'details',
    tabs: [DETAILS_TAB, PODS_TAB, LOGS_TAB, EVENTS_TAB, YAML_TAB],
  },
};
