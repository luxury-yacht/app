/**
 * frontend/src/ui/favorites/FavSaveModal.stories.tsx
 *
 * Storybook stories for the FavSaveModal component.
 * Uses SidebarProvidersDecorator to supply KubeconfigProvider and
 * NamespaceProvider needed by the modal's dropdown population.
 */

import type { Meta, StoryObj } from '@storybook/react';
import type { Favorite, FavoriteFilters, FavoriteTableState } from '@/core/persistence/favorites';
import { SidebarProvidersDecorator } from '../../../.storybook/decorators/SidebarProvidersDecorator';
import FavSaveModal from './FavSaveModal';

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const mockFilters: FavoriteFilters = {
  search: '',
  kinds: [],
  namespaces: [],
  caseSensitive: false,
  includeMetadata: false,
};

const mockTableState: FavoriteTableState = {
  sortColumn: 'name',
  sortDirection: 'asc',
  columnVisibility: {},
};

const mockExistingFavorite: Favorite = {
  id: 'fav-1',
  name: 'Production Pods',
  clusterSelection: '/Users/john/.kube/config:prod-cluster',
  viewType: 'namespace',
  view: 'pods',
  namespace: 'default',
  filters: {
    search: 'nginx',
    kinds: [],
    namespaces: [],
    caseSensitive: true,
    includeMetadata: false,
  },
  tableState: mockTableState,
  order: 0,
};

// Populate the Storybook Go backend mock with realistic kubeconfigs.
const installMockKubeconfigs = () => {
  const overrides = window.__storybookGoOverrides || {};
  overrides.GetKubeconfigs = () =>
    Promise.resolve([
      {
        name: 'config',
        path: '/Users/john/.kube/config',
        context: 'prod-cluster',
        isDefault: true,
        isCurrentContext: true,
      },
      {
        name: 'config',
        path: '/Users/john/.kube/config',
        context: 'staging-cluster',
        isDefault: true,
        isCurrentContext: false,
      },
      {
        name: 'dev-kubeconfig',
        path: '/Users/john/.kube/dev-kubeconfig',
        context: 'dev-cluster',
        isDefault: false,
        isCurrentContext: false,
      },
    ]);
  overrides.GetSelectedKubeconfigs = () =>
    Promise.resolve(['/Users/john/.kube/config:prod-cluster']);
  window.__storybookGoOverrides = overrides;
};

// ---------------------------------------------------------------------------
// Meta
// ---------------------------------------------------------------------------

const meta: Meta<typeof FavSaveModal> = {
  title: 'Favorites/FavSaveModal',
  component: FavSaveModal,
  decorators: [SidebarProvidersDecorator],
  args: {
    isOpen: true,
    onClose: () => undefined,
    existingFavorite: null,
    defaultName: 'prod-cluster / default / Pods',
    kubeconfigSelection: '/Users/john/.kube/config:prod-cluster',
    viewType: 'namespace',
    viewLabel: 'Pods',
    namespace: 'default',
    filters: mockFilters,
    tableState: mockTableState,
    includeMetadata: false,
    onSave: (fav: Favorite) => console.info('onSave', fav),
    onDelete: (id: string) => console.info('onDelete', id),
  },
};

export default meta;
type Story = StoryObj<typeof FavSaveModal>;

/** New favorite — namespace-scoped view. */
export const NewNamespaceFavorite: Story = {
  decorators: [
    (Story) => {
      installMockKubeconfigs();
      return <Story />;
    },
  ],
};

/** New favorite — cluster-scoped view. */
export const NewClusterFavorite: Story = {
  args: {
    viewType: 'cluster',
    viewLabel: 'Nodes',
    namespace: '',
    defaultName: 'prod-cluster / Nodes',
  },
  decorators: [
    (Story) => {
      installMockKubeconfigs();
      return <Story />;
    },
  ],
};

/** Editing an existing favorite with filter state. */
export const EditExisting: Story = {
  args: {
    existingFavorite: mockExistingFavorite,
    defaultName: mockExistingFavorite.name,
    filters: mockExistingFavorite.filters ?? undefined,
  },
  decorators: [
    (Story) => {
      installMockKubeconfigs();
      return <Story />;
    },
  ],
};

/** Editing a generic (any-cluster) favorite. */
export const EditGenericFavorite: Story = {
  args: {
    existingFavorite: {
      ...mockExistingFavorite,
      id: 'fav-2',
      name: 'Any Cluster Pods',
      clusterSelection: '',
    },
    defaultName: 'Any Cluster Pods',
  },
  decorators: [
    (Story) => {
      installMockKubeconfigs();
      return <Story />;
    },
  ],
};

/** Modal in closed state — should render nothing. */
export const Closed: Story = {
  args: {
    isOpen: false,
  },
};
