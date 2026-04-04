/**
 * frontend/src/ui/layout/AppHeader.stories.tsx
 *
 * Storybook stories for the AppHeader component.
 * Note: The FavMenuDropdown is now embedded directly in AppHeader and uses the
 * FavoritesContext. Full Storybook integration is tracked in Tasks 7 & 8.
 */

import type { Meta, StoryObj } from '@storybook/react';
import AppHeader from './AppHeader';
import { SidebarProvidersDecorator } from '../../../.storybook/decorators/SidebarProvidersDecorator';

const meta: Meta<typeof AppHeader> = {
  title: 'Layout/AppHeader',
  component: AppHeader,
  decorators: [SidebarProvidersDecorator],
  parameters: {
    layout: 'fullscreen',
  },
  args: {
    contentTitle: 'cluster: production • namespace: default • view: Pods',
  },
};

export default meta;
type Story = StoryObj<typeof AppHeader>;

/** Default header — now includes the real FavMenuDropdown. */
export const Default: Story = {};
