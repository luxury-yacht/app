/**
 * frontend/src/ui/command-palette/CommandPalette.stories.tsx
 *
 * Storybook stories for the CommandPalette with Favorites integration prototype.
 */

import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import { CommandPaletteWithFavorites, type FavoriteItem } from '../layout/FavoritesPrototypes';

const FAVORITES: FavoriteItem[] = [
  { id: 'g1', name: 'default / Workloads', clusterName: null, viewType: 'namespace', view: 'workloads', namespace: 'default' },
  { id: 'g2', name: 'kube-system / Pods', clusterName: null, viewType: 'namespace', view: 'pods', namespace: 'kube-system', hasFilters: true },
  { id: 'g3', name: 'Nodes', clusterName: null, viewType: 'cluster', view: 'nodes' },
  { id: 'c1', name: 'prod / CronJobs', clusterName: 'prod', viewType: 'namespace', view: 'workloads', namespace: 'default', hasFilters: true },
  { id: 'c2', name: 'prod / monitoring / Network', clusterName: 'prod', viewType: 'namespace', view: 'network', namespace: 'monitoring' },
  { id: 'c3', name: 'staging / default / Pods', clusterName: 'staging', viewType: 'namespace', view: 'pods', namespace: 'default' },
  { id: 'c4', name: 'dev / Nodes', clusterName: 'dev', viewType: 'cluster', view: 'nodes' },
];

const meta: Meta = {
  title: 'Overlays/CommandPalette',
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj;

/** Favorites shown as the first group in the command palette. */
export const WithFavorites: Story = {
  render: () => (
    <div style={{ height: '100vh', background: 'var(--color-bg)' }}>
      <CommandPaletteWithFavorites favorites={FAVORITES} selectedIndex={0} />
    </div>
  ),
};

/** Searching filters both favorites and commands. */
export const SearchingFavorites: Story = {
  render: () => (
    <div style={{ height: '100vh', background: 'var(--color-bg)' }}>
      <CommandPaletteWithFavorites favorites={FAVORITES} searchQuery="pods" selectedIndex={0} />
    </div>
  ),
};

/** No favorites — only regular commands shown. */
export const NoFavorites: Story = {
  render: () => (
    <div style={{ height: '100vh', background: 'var(--color-bg)' }}>
      <CommandPaletteWithFavorites favorites={[]} selectedIndex={0} />
    </div>
  ),
};
