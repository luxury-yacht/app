/**
 * frontend/src/ui/layout/Sidebar.stories.tsx
 *
 * Storybook stories for the Sidebar component.
 * Includes prototype Favorites section for design validation.
 */

import React from 'react';
import type { Meta, StoryObj } from '@storybook/react';
import Sidebar from './Sidebar';
import {
  SidebarFavoritesPrototype,
  type FavoriteItem,
} from './SidebarFavoritesPrototype';
import { SidebarProvidersDecorator } from '../../../.storybook/decorators/SidebarProvidersDecorator';
import { KeyboardProviderDecorator } from '../../../.storybook/decorators/KeyboardProviderDecorator';

// ---------------------------------------------------------------------------
// Mock favorite data
// ---------------------------------------------------------------------------

const SINGLE_CLUSTER_FAVORITES: FavoriteItem[] = [
  {
    id: '1',
    name: 'default / Workloads',
    clusterName: 'production',
    viewType: 'namespace',
    view: 'workloads',
    namespace: 'default',
  },
  {
    id: '2',
    name: 'Nodes',
    clusterName: 'production',
    viewType: 'cluster',
    view: 'nodes',
  },
  {
    id: '3',
    name: 'kube-system / Pods',
    clusterName: 'production',
    viewType: 'namespace',
    view: 'pods',
    namespace: 'kube-system',
    hasFilters: true,
  },
];

const MULTI_CLUSTER_FAVORITES: FavoriteItem[] = [
  {
    id: '1',
    name: 'Prod CronJobs',
    clusterName: 'prod',
    viewType: 'namespace',
    view: 'workloads',
    namespace: 'default',
    hasFilters: true,
  },
  {
    id: '2',
    name: 'Staging / default / Pods',
    clusterName: 'staging',
    viewType: 'namespace',
    view: 'pods',
    namespace: 'default',
  },
  {
    id: '3',
    name: 'Dev Nodes',
    clusterName: 'dev',
    viewType: 'cluster',
    view: 'nodes',
  },
  {
    id: '4',
    name: 'Prod / monitoring / Network',
    clusterName: 'prod',
    viewType: 'namespace',
    view: 'network',
    namespace: 'monitoring',
  },
];

const MANY_FAVORITES: FavoriteItem[] = [
  ...MULTI_CLUSTER_FAVORITES,
  {
    id: '5',
    name: 'Dev / ingress-nginx / Helm',
    clusterName: 'dev',
    viewType: 'namespace',
    view: 'helm',
    namespace: 'ingress-nginx',
  },
  {
    id: '6',
    name: 'Staging RBAC',
    clusterName: 'staging',
    viewType: 'cluster',
    view: 'rbac',
  },
  {
    id: '7',
    name: 'Prod / cert-manager / Events',
    clusterName: 'prod',
    viewType: 'namespace',
    view: 'events',
    namespace: 'cert-manager',
  },
];

// ---------------------------------------------------------------------------
// Wrapper that injects the favorites prototype above the real Sidebar.
// The Sidebar renders its own <div class="sidebar"> container, so we
// intercept via CSS to inject the favorites section at the top.
// ---------------------------------------------------------------------------

function SidebarWithFavorites({
  favorites,
  showClusterBadges,
  activeFavoriteId,
  defaultCollapsed,
}: {
  favorites: FavoriteItem[];
  showClusterBadges?: boolean;
  activeFavoriteId?: string | null;
  defaultCollapsed?: boolean;
}) {
  return (
    <Sidebar
      favoritesSlot={
        <SidebarFavoritesPrototype
          favorites={favorites}
          showClusterBadges={showClusterBadges}
          activeFavoriteId={activeFavoriteId}
          defaultCollapsed={defaultCollapsed}
        />
      }
    />
  );
}

// ---------------------------------------------------------------------------
// Stories
// ---------------------------------------------------------------------------

const meta: Meta<typeof Sidebar> = {
  title: 'Layout/Sidebar',
  component: Sidebar,
  decorators: [KeyboardProviderDecorator, SidebarProvidersDecorator],
  parameters: {
    layout: 'fullscreen',
  },
};

export default meta;
type Story = StoryObj<typeof Sidebar>;

/** Default state — Overview selected, no namespaces loaded. */
export const Default: Story = {};

/** Sidebar with a few favorites from a single cluster (no cluster badges). */
export const WithFavorites: Story = {
  render: () => (
    <SidebarWithFavorites
      favorites={SINGLE_CLUSTER_FAVORITES}
      showClusterBadges={false}
    />
  ),
};

/** One favorite is currently active/selected. */
export const WithActiveFavorite: Story = {
  render: () => (
    <SidebarWithFavorites
      favorites={SINGLE_CLUSTER_FAVORITES}
      showClusterBadges={false}
      activeFavoriteId="1"
    />
  ),
};

/** Favorites spanning multiple clusters — shows cluster badge on each item. */
export const MultiClusterFavorites: Story = {
  render: () => (
    <SidebarWithFavorites
      favorites={MULTI_CLUSTER_FAVORITES}
      showClusterBadges={true}
    />
  ),
};

/** Many favorites with cluster badges and one active. */
export const ManyFavorites: Story = {
  render: () => (
    <SidebarWithFavorites
      favorites={MANY_FAVORITES}
      showClusterBadges={true}
      activeFavoriteId="4"
    />
  ),
};

/** Favorites section collapsed. */
export const FavoritesCollapsed: Story = {
  render: () => (
    <SidebarWithFavorites
      favorites={MULTI_CLUSTER_FAVORITES}
      showClusterBadges={true}
      defaultCollapsed={true}
    />
  ),
};

/** No favorites — section is hidden entirely. */
export const NoFavorites: Story = {
  render: () => (
    <SidebarWithFavorites favorites={[]} />
  ),
};
