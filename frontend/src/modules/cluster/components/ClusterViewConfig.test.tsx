/**
 * frontend/src/modules/cluster/components/ClusterViewConfig.test.tsx
 *
 * Test suite for ClusterViewConfig.
 * Covers key behaviors and edge cases for ClusterViewConfig.
 */

import ClusterViewConfig from '@modules/cluster/components/ClusterViewConfig';
import { OBJECT_ACTION_IDS } from '@shared/actions/objectActionContract';
import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const requestRefreshDomainStateMock = vi.hoisted(() => vi.fn());

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
    onClick: () => {},
    title: 'Save as favorite',
  }),
}));

const gridTablePropsRef: { current: any } = { current: null };
const loadingBoundaryPropsRef: { current: any } = { current: null };
const openWithObjectMock = vi.fn();

vi.mock('@shared/components/tables/GridTable', async () => {
  const actual = await vi.importActual<typeof import('@shared/components/tables/GridTable')>(
    '@shared/components/tables/GridTable'
  );
  return {
    ...actual,
    default: (props: any) => {
      gridTablePropsRef.current = props;
      return <div data-testid="grid-table" />;
    },
  };
});

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: openWithObjectMock }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedKubeconfig: 'path:context', selectedClusterId: 'cluster-a' }),
}));

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  __esModule: true,
  default: (props: { children: React.ReactNode }) => {
    loadingBoundaryPropsRef.current = props;
    return <>{props.children}</>;
  },
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (data: unknown[]) => ({
    sortedData: data,
    sortConfig: { key: 'name', direction: 'asc' },
    handleSort: vi.fn(),
  }),
}));

vi.mock('@shared/components/tables/persistence/useGridTablePersistence', () => ({
  useGridTablePersistence: () => ({
    sortConfig: { key: 'name', direction: 'asc' },
    setSortConfig: vi.fn(),
    columnWidths: null,
    setColumnWidths: vi.fn(),
    columnVisibility: null,
    setColumnVisibility: vi.fn(),
    filters: { search: '', kinds: [], namespaces: [], caseSensitive: false },
    setFilters: vi.fn(),
    resetState: vi.fn(),
    hydrated: true,
    storageKey: 'gridtable:v1:test',
  }),
}));

vi.mock('@/hooks/useShortNames', () => ({
  useShortNames: () => false,
}));

vi.mock('@/core/data-access', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    requestRefreshDomainState: (request: unknown) => requestRefreshDomainStateMock(request),
  };
});

vi.mock('@wailsjs/go/backend/App', () => ({
  RunObjectAction: vi.fn(),
}));

vi.mock('@/core/capabilities', () => ({
  getPermissionKey: (kind: string, verb: string, ns?: string) => `${kind}:${verb}:${ns || ''}`,
  useUserPermissions: () => new Map(),
}));

const baseConfig = {
  kind: 'StorageClass',
  name: 'standard',
  clusterId: 'cluster-a',
  age: '1d',
};

describe('ClusterViewConfig', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    gridTablePropsRef.current = null;
    loadingBoundaryPropsRef.current = null;
    openWithObjectMock.mockReset();
    requestRefreshDomainStateMock.mockReset();
    requestRefreshDomainStateMock.mockResolvedValue({
      status: 'executed',
      data: {
        status: 'ready',
        data: {
          resources: [],
          total: 0,
          totalIsExact: true,
          kinds: [],
          facetsExact: true,
        },
      },
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  it('passes persisted state to GridTable', async () => {
    await act(async () => {
      root.render(<ClusterViewConfig />);
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    expect(props).toBeTruthy();
    expect(props.sortConfig).toEqual({ key: 'name', direction: 'asc' });
    expect(props.filters?.value).toEqual({
      search: '',
      kinds: [],
      namespaces: [],
      caseSensitive: false,
    });
    expect(props.columnVisibility).toBe(null);
    expect(props.columnWidths).toBe(null);
  });

  it('keeps initial empty query-backed cluster config behind the loading boundary', async () => {
    requestRefreshDomainStateMock.mockImplementation(() => new Promise(() => {}));

    await act(async () => {
      root.render(<ClusterViewConfig />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(loadingBoundaryPropsRef.current).toEqual(
      expect.objectContaining({
        loading: true,
        hasLoaded: false,
        dataLength: 0,
        spinnerMessage: 'Loading configuration resources...',
      })
    );
  });

  it('does not expose local partial copy for query-backed cluster config', async () => {
    await act(async () => {
      root.render(<ClusterViewConfig />);
      await Promise.resolve();
    });

    expect(gridTablePropsRef.current?.filters?.options?.partialDataLabel).toBeUndefined();
  });

  it('opens a StorageClass directly to the map tab from the context menu', async () => {
    await act(async () => {
      root.render(<ClusterViewConfig />);
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    expect(props).toBeTruthy();
    const contextItems = props.getCustomContextMenuItems(baseConfig, 'kind');
    const mapItem = contextItems.find(
      (item: { actionId?: string; onClick?: () => void }) =>
        item.actionId === OBJECT_ACTION_IDS.viewMap
    );

    expect(mapItem).toBeTruthy();
    mapItem?.onClick?.();

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'StorageClass',
        name: 'standard',
        group: 'storage.k8s.io',
        version: 'v1',
        clusterId: 'cluster-a',
      }),
      { initialTab: 'map' }
    );
  });

  it('opens an IngressClass directly to the map tab from the context menu', async () => {
    const ingressClass = { ...baseConfig, kind: 'IngressClass', name: 'public' };

    await act(async () => {
      root.render(<ClusterViewConfig />);
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    expect(props).toBeTruthy();
    const contextItems = props.getCustomContextMenuItems(ingressClass, 'kind');
    const mapItem = contextItems.find(
      (item: { actionId?: string; onClick?: () => void }) =>
        item.actionId === OBJECT_ACTION_IDS.viewMap
    );

    expect(mapItem).toBeTruthy();
    mapItem?.onClick?.();

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'IngressClass',
        name: 'public',
        group: 'networking.k8s.io',
        version: 'v1',
        clusterId: 'cluster-a',
      }),
      { initialTab: 'map' }
    );
  });

  it('does not offer object map for unsupported cluster config rows', async () => {
    await act(async () => {
      root.render(<ClusterViewConfig />);
      await Promise.resolve();
    });

    const props = gridTablePropsRef.current;
    expect(props).toBeTruthy();
    const contextItems = props.getCustomContextMenuItems(
      { ...baseConfig, kind: 'ValidatingWebhookConfiguration' },
      'kind'
    );

    expect(
      contextItems.some(
        (item: { actionId?: string }) => item.actionId === OBJECT_ACTION_IDS.viewMap
      )
    ).toBe(false);
  });
});
