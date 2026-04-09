/**
 * frontend/src/shared/components/tabs/Tabs.stories.tsx
 *
 * Storybook stories for the shared <Tabs> base component. Each story manages
 * activeId in local state via a small wrapper so the fully-controlled <Tabs>
 * can be clicked around interactively. Drag-related stories live in a
 * separate TabsWithDrag.stories.tsx file.
 */

import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { Tabs, type TabsProps } from './';
import { ThemeProviderDecorator } from '../../../../.storybook/decorators/ThemeProviderDecorator';

// Lightweight action logger. The project doesn't install @storybook/addon-actions,
// so we log to the browser console instead — Storybook's controls panel still
// captures console output, and it keeps the story file dependency-free.
const logAction =
  (name: string) =>
  (...args: unknown[]): void => {
    console.log(`[Tabs story] ${name}`, ...args);
  };

/**
 * Small wrapper that owns `activeId` state so every story can render the
 * fully-controlled <Tabs> without boilerplate. Accepts a caller-provided
 * initial id plus any <Tabs> prop overrides. No wrapper chrome — these
 * stories exercise the shared base component in isolation; preview
 * stories that need a fixed viewport width live in their own files and
 * use the `tabs-story-viewport` class from `stories.css`.
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
  return <Tabs {...rest} tabs={tabs} activeId={activeId} onActivate={handleActivate} />;
}

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

/** 5 tabs with the middle two disabled — arrow nav skips them, clicks ignored. */
export const DisabledTabs: Story = {
  args: {
    'aria-label': 'Tabs with disabled entries',
    initialActiveId: 'first',
    tabs: [
      { id: 'first', label: 'First' },
      { id: 'second', label: 'Second', disabled: true },
      { id: 'third', label: 'Third', disabled: true },
      { id: 'fourth', label: 'Fourth' },
      { id: 'fifth', label: 'Fifth' },
    ],
  },
};
