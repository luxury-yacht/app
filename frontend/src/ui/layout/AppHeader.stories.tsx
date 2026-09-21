import type { Meta, StoryObj } from '@storybook/react';
import { SidebarProvidersDecorator } from '../../../.storybook/decorators/SidebarProvidersDecorator';
import AppHeader from './AppHeader';
import WindowHeader from './WindowHeader';

const meta: Meta<typeof AppHeader> = {
  title: 'Layout/AppHeader',
  component: AppHeader,
  decorators: [SidebarProvidersDecorator],
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<typeof AppHeader>;

/** Default header — now includes the real FavMenuDropdown. */
export const Default: Story = {};

/** Native panel header — shared drag surface without workspace controls. */
export const PanelWindow: Story = {
  render: () => <WindowHeader clusterName="Production" />,
};

export const PanelWindowLongClusterName: Story = {
  render: () => <WindowHeader clusterName="Production · customer-platform-us-east-1:production" />,
};
