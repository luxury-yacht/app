/**
 * frontend/src/modules/namespace/components/NsViewAutoscaling.test.tsx
 *
 * Focused coverage for autoscaling context-menu actions.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import NsViewAutoscaling, {
  type AutoscalingData,
} from '@modules/namespace/components/NsViewAutoscaling';

vi.mock('@modules/namespace/components/useNamespaceColumnLink', () => ({
  useNamespaceColumnLink: () => ({
    onClick: vi.fn(),
    getClassName: () => 'object-panel-link',
    isInteractive: () => true,
  }),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedKubeconfig: 'path:context', selectedClusterId: 'cluster-a' }),
}));

const { gridTablePropsRef, openWithObjectMock } = vi.hoisted(() => ({
  gridTablePropsRef: { current: null as any },
  openWithObjectMock: vi.fn(),
}));

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

vi.mock('@shared/components/modals/ConfirmationModal', () => ({
  default: () => null,
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  DeleteResourceByGVK: vi.fn(),
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (data: unknown[]) => ({
    sortedData: data,
    sortConfig: { key: 'name', direction: 'asc' },
    handleSort: vi.fn(),
  }),
}));

vi.mock('@modules/namespace/hooks/useNamespaceGridTablePersistence', () => ({
  useNamespaceGridTablePersistence: () => ({
    sortConfig: { key: 'name', direction: 'asc' },
    onSortChange: vi.fn(),
    columnWidths: null,
    setColumnWidths: vi.fn(),
    columnVisibility: null,
    setColumnVisibility: vi.fn(),
    filters: { search: '', kinds: [], namespaces: [], caseSensitive: false },
    setFilters: vi.fn(),
    isNamespaceScoped: true,
    resetState: vi.fn(),
  }),
}));

vi.mock('@/hooks/useShortNames', () => ({
  useShortNames: () => false,
}));

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  default: ({ children }: any) => children,
}));

vi.mock('@shared/components/icons/MenuIcons', () => ({
  DiffIcon: () => <span>diff</span>,
  OpenIcon: () => <span>open</span>,
  ObjectMapIcon: () => <span>map</span>,
  DeleteIcon: () => <span>delete</span>,
}));

vi.mock('@/core/capabilities', () => ({
  useUserPermissions: () => new Map(),
  getPermissionKey: (kind: string, action: string) => `${kind}:${action}`,
}));

describe('NsViewAutoscaling', () => {
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
    openWithObjectMock.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const baseHpa = (overrides: Partial<AutoscalingData> = {}): AutoscalingData => ({
    kind: 'HorizontalPodAutoscaler',
    name: 'web',
    namespace: 'team-a',
    clusterId: 'alpha:ctx',
    target: 'Deployment/web',
    minReplicas: 1,
    maxReplicas: 5,
    currentReplicas: 2,
    age: '10m',
    ...overrides,
  });

  it('opens the Map for HorizontalPodAutoscaler rows', async () => {
    const entry = baseHpa();

    await act(async () => {
      root.render(
        <NsViewAutoscaling
          namespace="team-a"
          data={[entry]}
          loading={false}
          loaded={true}
          showNamespaceColumn={true}
        />
      );
      await Promise.resolve();
    });

    const objectMapItem = gridTablePropsRef.current
      .getCustomContextMenuItems(entry, 'name')
      .find((item: any) => item.label === 'Map');
    expect(objectMapItem).toBeTruthy();

    act(() => {
      objectMapItem?.onClick?.();
    });

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'HorizontalPodAutoscaler',
        name: 'web',
        namespace: 'team-a',
        clusterId: 'alpha:ctx',
        group: 'autoscaling',
        version: 'v2',
      }),
      { initialTab: 'map' }
    );
  });
});
