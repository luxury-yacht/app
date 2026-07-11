/**
 * frontend/src/modules/cluster/components/ClusterViewCRDs.test.tsx
 *
 * Test suite for ClusterViewCRDs.
 * Covers key behaviors and edge cases for ClusterViewCRDs.
 */

import ClusterViewCRDs from '@modules/cluster/components/ClusterViewCRDs';
import type { GridTableProps } from '@shared/components/tables/GridTable';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';

type CRDRow = Record<string, unknown>;

vi.mock('@core/contexts/FavoritesContext', () => ({
  useFavorites: () => ({
    favorites: [],

    addFavorite: vi.fn(),
    updateFavorite: vi.fn(),
    deleteFavorite: vi.fn(),
    reorderFavorites: vi.fn(),
  }),
  FavoritesProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock('@ui/favorites/FavToggle', () => ({
  useFavToggle: () => ({
    type: 'toggle',
    id: 'favorite',
    icon: null,
    active: false,
    onClick: () => undefined,
    title: 'Save as favorite',
  }),
}));

const gridTablePropsRef: { current: GridTableProps<CRDRow> | null } = { current: null };

vi.mock('@shared/components/tables/GridTable', async () => {
  const actual = await vi.importActual<typeof import('@shared/components/tables/GridTable')>(
    '@shared/components/tables/GridTable'
  );
  return {
    ...actual,
    default: (props: GridTableProps<CRDRow>) => {
      gridTablePropsRef.current = props;
      return <div data-testid="grid-table" />;
    },
  };
});

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: vi.fn() }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedKubeconfig: 'path:context', selectedClusterId: 'cluster-a' }),
}));

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (data: unknown[]) => ({
    sortedData: data,
    sortConfig: { key: 'name', direction: 'asc' },
    handleSort: vi.fn(),
  }),
}));

const setFiltersMock = vi.fn();

vi.mock('@shared/components/tables/persistence/useGridTablePersistence', () => ({
  useGridTablePersistence: () => ({
    sortConfig: { key: 'name', direction: 'asc' },
    setSortConfig: vi.fn(),
    columnWidths: null,
    setColumnWidths: vi.fn(),
    columnVisibility: null,
    setColumnVisibility: vi.fn(),
    filters: { search: '', kinds: [], namespaces: [], caseSensitive: false },
    setFilters: setFiltersMock,
    resetState: vi.fn(),
    hydrated: true,
    storageKey: 'gridtable:v1:test',
  }),
}));

vi.mock('@/hooks/useShortNames', () => ({
  useShortNames: () => false,
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  RunObjectAction: vi.fn(),
}));

vi.mock('@/core/capabilities', () => ({
  getPermissionKey: (kind: string, verb: string, ns?: string) => `${kind}:${verb}:${ns || ''}`,
  useUserPermissions: () => new Map(),
}));

const baseCRD = {
  kind: 'CustomResourceDefinition',
  name: 'foos.example.com',
  group: 'example.com',
  scope: 'Namespaced',
  clusterId: 'cluster-a',
  age: '1d',
};

const getGridTableProps = () =>
  requireValue(gridTablePropsRef.current, 'expected GridTable props in ClusterViewCRDs.test.tsx');

describe('ClusterViewCRDs', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    gridTablePropsRef.current = null;
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('passes persisted state to GridTable', async () => {
    await act(async () => {
      root.render(<ClusterViewCRDs />);
      await Promise.resolve();
    });

    const props = getGridTableProps();
    expect(props).toBeTruthy();
    expect(props.sortConfig).toEqual({ key: 'name', direction: 'asc' });
    expect(props.filters?.value).toEqual({
      search: '',
      kinds: [],
      namespaces: [],
      caseSensitive: false,
    });
    expect(props.columnVisibility).toBeFalsy();
    expect(props.columnWidths).toBeFalsy();
  });

  it('does not offer a kind dropdown (every row is a CustomResourceDefinition)', async () => {
    await act(async () => {
      root.render(<ClusterViewCRDs />);
      await Promise.resolve();
    });

    const props = getGridTableProps();
    expect(props.filters?.options?.showKindDropdown).toBeFalsy();
  });

  // Version column rendering. The Version column shows the storage
  // version (the version etcd persists) with a `(+N)` suffix when the
  // CRD also serves additional versions. See

  describe('Version column', () => {
    const findVersionColumn = (props: GridTableProps<CRDRow>) =>
      requireValue(
        props.columns.find((col) => col.key === 'version'),
        'expected version column in ClusterViewCRDs.test.tsx'
      );

    it('renders bare storage version when there are no extra served versions', async () => {
      const singleVersion = {
        ...baseCRD,
        storageVersion: 'v1',
        extraServedVersionCount: 0,
      };

      await act(async () => {
        root.render(<ClusterViewCRDs />);
        await Promise.resolve();
      });

      const props = getGridTableProps();
      const versionCol = findVersionColumn(props);
      expect(versionCol).toBeTruthy();

      // The render fn returns a React element wrapping the text. Inspect
      // its rendered children rather than calling a stringifier.
      const rendered = versionCol.render(singleVersion);
      const text = JSON.stringify(rendered);
      expect(text).toContain('v1');
      expect(text).not.toContain('+');
    });

    it('renders storage version with (+N) suffix for multi-version CRDs', async () => {
      const multiVersion = {
        ...baseCRD,
        name: 'dbinstances.rds.services.k8s.aws',
        group: 'rds.services.k8s.aws',
        storageVersion: 'v1',
        extraServedVersionCount: 2,
      };

      await act(async () => {
        root.render(<ClusterViewCRDs />);
        await Promise.resolve();
      });

      const props = getGridTableProps();
      const versionCol = findVersionColumn(props);
      const rendered = versionCol.render(multiVersion);
      const text = JSON.stringify(rendered);
      expect(text).toContain('v1 (+2)');
    });

    it('renders dash when storageVersion is missing (defensive)', async () => {
      // CRDs in transient/malformed states might not carry a storage
      // version. The cell should not crash or display "undefined".
      const noVersion = { ...baseCRD };

      await act(async () => {
        root.render(<ClusterViewCRDs />);
        await Promise.resolve();
      });

      const props = getGridTableProps();
      const versionCol = findVersionColumn(props);
      const rendered = versionCol.render(noVersion);
      const text = JSON.stringify(rendered);
      expect(text).toContain('-');
    });

    it('sortValue is the bare storage version (not the rendered cell text)', async () => {
      // Sort comparator should cluster CRDs by storage version regardless
      // of how many extra served versions they have. A `v1 (+2)` row and
      // a `v1` row should sort identically.
      const multiVersion = {
        ...baseCRD,
        storageVersion: 'v1',
        extraServedVersionCount: 2,
      };

      await act(async () => {
        root.render(<ClusterViewCRDs />);
        await Promise.resolve();
      });

      const props = getGridTableProps();
      const versionCol = findVersionColumn(props);
      expect(versionCol.sortValue).toBeDefined();
      expect(
        requireValue(versionCol.sortValue, 'expected version sort accessor')(multiVersion)
      ).toBe('v1');
    });
  });
});
