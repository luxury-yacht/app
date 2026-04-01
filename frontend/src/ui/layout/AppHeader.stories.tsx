/**
 * frontend/src/ui/layout/AppHeader.stories.tsx
 *
 * Storybook stories for the AppHeader component.
 */

import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import AppHeader from './AppHeader';
import { StarMenuDropdown, type FavoriteItem } from './FavoritesPrototypes';
import { SidebarProvidersDecorator } from '../../../.storybook/decorators/SidebarProvidersDecorator';

const FAVORITES: FavoriteItem[] = [
  { id: 'g1', name: 'default / Workloads', clusterName: null, viewType: 'namespace', view: 'workloads', namespace: 'default' },
  { id: 'g2', name: 'kube-system / Pods', clusterName: null, viewType: 'namespace', view: 'pods', namespace: 'kube-system', hasFilters: true },
  { id: 'g3', name: 'Nodes', clusterName: null, viewType: 'cluster', view: 'nodes' },
  { id: 'c1', name: 'prod / CronJobs', clusterName: 'prod', viewType: 'namespace', view: 'workloads', namespace: 'default', hasFilters: true },
  { id: 'c2', name: 'prod / monitoring / Network', clusterName: 'prod', viewType: 'namespace', view: 'network', namespace: 'monitoring' },
  { id: 'c3', name: 'staging / default / Pods', clusterName: 'staging', viewType: 'namespace', view: 'pods', namespace: 'default' },
  { id: 'c4', name: 'dev / Nodes', clusterName: 'dev', viewType: 'cluster', view: 'nodes' },
];

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

/** Default header without favorites. */
export const Default: Story = {};

/** Star menu dropdown open with favorites. */
export const FavoritesMenuOpen: Story = {
  args: {
    extraControls: (
      <StarMenuDropdown favorites={FAVORITES} activeFavoriteId="g1" isOpen={true} />
    ),
  },
};

/** Star menu dropdown open with no favorites. */
export const FavoritesMenuEmpty: Story = {
  args: {
    extraControls: <StarMenuDropdown favorites={[]} isOpen={true} />,
  },
};

/** Star button closed. */
export const FavoritesButtonClosed: Story = {
  args: {
    extraControls: <StarMenuDropdown favorites={FAVORITES} />,
  },
};
