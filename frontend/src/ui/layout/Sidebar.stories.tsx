/**
 * frontend/src/ui/layout/Sidebar.stories.tsx
 *
 * Storybook stories for the Sidebar component.
 */

import type { Meta, StoryObj } from '@storybook/react';
import { SidebarProvidersDecorator } from '../../../.storybook/decorators/SidebarProvidersDecorator';
import Sidebar from './Sidebar';

const meta: Meta<typeof Sidebar> = {
  title: 'Layout/Sidebar',
  component: Sidebar,
  decorators: [SidebarProvidersDecorator],
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<typeof Sidebar>;

/** Default state — Overview selected, no namespaces loaded. */
export const Default: Story = {};
