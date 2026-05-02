/**
 * frontend/src/modules/namespace/components/NsViewCustom.test.tsx
 *
 * Test suite for NsViewCustom.
 * Covers key behaviors and edge cases for NsViewCustom.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ALL_NAMESPACES_SCOPE } from '@modules/namespace/constants';

vi.mock('@modules/namespace/components/useNamespaceColumnLink', () => ({
  useNamespaceColumnLink: () => ({
    onClick: vi.fn(),
    getClassName: () => 'object-panel-link',
    isInteractive: () => true,
  }),
}));

import NsViewCustom, { type CustomResourceData } from '@modules/namespace/components/NsViewCustom';

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const errorHandlerMock = vi.hoisted(() => ({ handle: vi.fn() }));

const gridTableMock = vi.fn();
const modalProps: { current: any } = { current: null };
const openWithObjectMock = vi.fn();
const sortHandlerMock = vi.fn();
const useTableSortMock = vi.fn();
const useShortNamesMock = vi.fn();
const deleteResourceByGVKMock = vi.fn();

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

vi.mock('@shared/components/tables/GridTable', () => ({
  __esModule: true,
  default: (props: any) => {
    gridTableMock(props);
    return <div data-testid="grid-table" />;
  },
  GRIDTABLE_VIRTUALIZATION_DEFAULT: { enabled: true },
}));

vi.mock('@shared/components/ResourceLoadingBoundary', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@shared/components/modals/ConfirmationModal', () => ({
  __esModule: true,
  default: (props: any) => {
    modalProps.current = props;
    return <div data-testid="confirmation-modal" />;
  },
}));

vi.mock('@modules/object-panel/hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: openWithObjectMock }),
}));

vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ navigateToView: vi.fn() }),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: () => ({ selectedKubeconfig: 'path:context', selectedClusterId: 'cluster-a' }),
}));

vi.mock('@/hooks/useTableSort', () => ({
  useTableSort: (...args: unknown[]) => useTableSortMock(...args),
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
  useShortNames: () => useShortNamesMock(),
}));

vi.mock('@wailsjs/go/backend/App', () => ({
  DeleteResourceByGVK: (...args: unknown[]) => deleteResourceByGVKMock(...args),
}));

vi.mock('@utils/errorHandler', () => ({
  errorHandler: errorHandlerMock,
}));

vi.mock('@/core/capabilities', () => ({
  useUserPermissions: () =>
    new Map([
      ['CronJob:delete', { allowed: true, pending: false }],
      ['CustomResource:delete', { allowed: true, pending: false }],
      ['DBInstance:delete', { allowed: true, pending: false }],
    ]),
  getPermissionKey: (kind: string, action: string) => `${kind}:${action}`,
  // Stubbed for CRDs not covered by the static permission map; the real
  // function lazy-loads delete permissions on first context-menu open.
  queryKindPermissions: vi.fn(),
}));

const baseResource: CustomResourceData = {
  kind: 'CronJob',
  name: 'nightly-cleanup',
  namespace: 'ops',
  clusterId: 'alpha:ctx',
  clusterName: 'alpha',
  apiGroup: 'batch',
  apiVersion: 'v1',
  age: '10m',
  labels: { team: 'platform' },
  annotations: { owner: 'ops' },
};

const getLastGridProps = () => gridTableMock.mock.calls[gridTableMock.mock.calls.length - 1]?.[0];

describe('NsViewCustom', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    gridTableMock.mockReset();
    openWithObjectMock.mockReset();
    sortHandlerMock.mockReset();
    deleteResourceByGVKMock.mockReset();
    modalProps.current = null;
    useTableSortMock.mockImplementation((data: CustomResourceData[]) => ({
      sortedData: data,
      sortConfig: { key: 'name', direction: 'asc' },
      handleSort: sortHandlerMock,
    }));
    useShortNamesMock.mockReturnValue(false);
    errorHandlerMock.handle.mockClear();

    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  type NsViewCustomProps = React.ComponentProps<typeof NsViewCustom>;

  const renderComponent = async (props: Partial<NsViewCustomProps> = {}) => {
    const mergedProps: NsViewCustomProps = {
      namespace: 'team-a',
      data: [],
      loading: false,
      loaded: false,
      showNamespaceColumn: false,
      ...props,
    };

    await act(async () => {
      root.render(<NsViewCustom {...mergedProps} />);
      await Promise.resolve();
    });
  };

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  it('renders GridTable with context menu actions and opens the object panel', async () => {
    await renderComponent({ data: [baseResource], loaded: true, showNamespaceColumn: true });

    expect(gridTableMock).toHaveBeenCalled();

    const gridProps = gridTableMock.mock.calls[0][0];
    expect(gridProps.data).toEqual([baseResource]);
    expect(gridProps.keyExtractor(baseResource)).toBe(
      'alpha:ctx|batch/v1/CronJob/ops/nightly-cleanup'
    );
    gridProps.onSort?.('name');
    expect(sortHandlerMock).toHaveBeenCalledWith('name');

    const contextItems = gridProps.getCustomContextMenuItems(baseResource, 'kind');
    expect(contextItems[0].label).toBe('Open');
    contextItems[0].onClick();
    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'CronJob',
        name: 'nightly-cleanup',
        namespace: 'ops',
        age: '10m',
        labels: { team: 'platform' },
        annotations: { owner: 'ops' },
        clusterId: 'alpha:ctx',
      })
    );
  });

  it('enables searchable kind dropdown bulk actions in all-namespaces custom view', async () => {
    await renderComponent({
      namespace: ALL_NAMESPACES_SCOPE,
      data: [baseResource],
      availableKinds: ['DBCluster', 'Widget'],
      loaded: true,
      showNamespaceColumn: true,
    });

    const gridProps = gridTableMock.mock.calls[0][0];
    expect(gridProps.filters.options.showKindDropdown).toBe(true);
    expect(gridProps.filters.options.kindDropdownSearchable).toBe(true);
    expect(gridProps.filters.options.kindDropdownBulkActions).toBe(true);
  });

  it('uses the provided kind metadata instead of deriving kinds from loaded rows', async () => {
    await renderComponent({
      data: [baseResource],
      availableKinds: ['DBCluster', 'Widget'],
      loaded: true,
    });

    const gridProps = getLastGridProps();
    expect(gridProps?.filters?.options?.kinds).toEqual(['DBCluster', 'Widget']);
  });

  it('preserves the column definitions across rerenders with unchanged inputs', async () => {
    const data = [baseResource];

    await renderComponent({
      namespace: 'team-a',
      data,
      loaded: true,
      showNamespaceColumn: true,
    });

    const firstColumnsRef = getLastGridProps()?.columns;

    await renderComponent({
      namespace: 'team-a',
      data,
      loaded: true,
      showNamespaceColumn: true,
    });

    expect(getLastGridProps()?.columns).toBe(firstColumnsRef);
  });

  it('preserves the filters config across rerenders with unchanged inputs', async () => {
    const data = [baseResource];

    await renderComponent({
      namespace: 'team-a',
      data,
      loaded: true,
      showNamespaceColumn: true,
    });

    const firstFiltersRef = getLastGridProps()?.filters;

    await renderComponent({
      namespace: 'team-a',
      data,
      loaded: true,
      showNamespaceColumn: true,
    });

    expect(getLastGridProps()?.filters).toBe(firstFiltersRef);
  });

  // Regression test for the kind-only-objects bug. When the user clicks a custom
  // resource whose Kind collides with another CRD from a different API
  // group (e.g. DBInstance from rds.services.k8s.aws vs DBInstance from
  // documentdb.services.k8s.aws), handleResourceClick MUST forward both
  // apiGroup and apiVersion into openWithObject. Without them, the panel
  // state has no group/version to emit in the refresh-domain scope, the
  // backend falls back to first-match-wins kind-only GVR resolution, and
  // the user sees the wrong DBInstance's YAML.
  //
  // Before the fix at NsViewCustom.tsx handleResourceClick, this test
  // would have failed with:
  //   Expected: objectContaining({ group: 'documentdb.services.k8s.aws', version: 'v1alpha1' })
  //   Received: { kind: 'DBInstance', name: 'db-dc-test-1-v4', ... } // no group/version
  //
  // Keeping this as a permanent regression guardrail so we don't
  // silently drop these fields again in a future refactor.
  it('forwards apiGroup and apiVersion into openWithObject for colliding CRDs', async () => {
    const dbInstance: CustomResourceData = {
      kind: 'DBInstance',
      name: 'db-dc-test-1-v4',
      namespace: 'team-a',
      clusterId: 'alpha:ctx',
      clusterName: 'alpha',
      apiGroup: 'documentdb.services.k8s.aws',
      apiVersion: 'v1alpha1',
      age: '2h',
      labels: {},
      annotations: {},
    };

    await renderComponent({ data: [dbInstance], loaded: true, showNamespaceColumn: true });

    const gridProps = gridTableMock.mock.calls[0][0];
    const contextItems = gridProps.getCustomContextMenuItems(dbInstance, 'kind');
    expect(contextItems[0].label).toBe('Open');
    contextItems[0].onClick();

    expect(openWithObjectMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'DBInstance',
        name: 'db-dc-test-1-v4',
        namespace: 'team-a',
        clusterId: 'alpha:ctx',
        group: 'documentdb.services.k8s.aws',
        version: 'v1alpha1',
      })
    );

    // Also assert the openWithObject payload that downstream code receives
    // has group/version as actual OWN properties of the object (not lost
    // through a spread), since any spread-loss would defeat the purpose.
    const callArg = openWithObjectMock.mock.calls.find(
      ([arg]) => (arg as { name?: string }).name === 'db-dc-test-1-v4'
    )?.[0] as Record<string, unknown>;
    expect(callArg).toBeDefined();
    expect(callArg.group).toBe('documentdb.services.k8s.aws');
    expect(callArg.version).toBe('v1alpha1');
  });

  it('confirms deletion and calls DeleteResourceByGVK with resolved data', async () => {
    deleteResourceByGVKMock.mockResolvedValue(undefined);

    // Every custom resource row the backend catalog produces carries
    // apiGroup/apiVersion — the delete path is GVK-only after the
    // kind-only-objects fix.
    const resourceWithGVK: CustomResourceData = {
      ...baseResource,
      apiGroup: 'batch',
      apiVersion: 'v1',
    };

    await renderComponent({
      data: [resourceWithGVK],
      loaded: true,
      showNamespaceColumn: true,
    });

    const gridProps = gridTableMock.mock.calls[0][0];
    const contextItems = gridProps.getCustomContextMenuItems(resourceWithGVK, 'kind');
    const deleteItem = contextItems.find(
      (item: { label?: string; onClick?: () => void }) => item.label === 'Delete'
    );
    await act(async () => {
      deleteItem?.onClick?.();
      await Promise.resolve();
    });
    expect(modalProps.current?.isOpen).toBe(true);

    await act(async () => {
      await modalProps.current.onConfirm();
    });

    expect(deleteResourceByGVKMock).toHaveBeenCalledWith(
      'alpha:ctx',
      'batch/v1',
      'CronJob',
      'ops',
      'nightly-cleanup'
    );
    await flush();
    expect(modalProps.current?.isOpen).toBe(false);
  });

  // Regression test for the delete-path leg of the kind-only-objects bug.
  // When the user confirms deletion of a custom
  // resource whose Kind collides with another CRD from a different API
  // group (e.g. two DBInstance CRDs), handleDeleteConfirm MUST route
  // through DeleteResourceByGVK so the strict GVR is targeted. The legacy
  // DeleteResource path uses first-match-wins discovery and could
  // silently delete the wrong object.
  it('routes delete through DeleteResourceByGVK when apiGroup/apiVersion are present', async () => {
    deleteResourceByGVKMock.mockResolvedValue(undefined);

    const dbInstance: CustomResourceData = {
      kind: 'DBInstance',
      name: 'db-dc-test-1-v4',
      namespace: 'team-a',
      clusterId: 'alpha:ctx',
      clusterName: 'alpha',
      apiGroup: 'documentdb.services.k8s.aws',
      apiVersion: 'v1alpha1',
      age: '2h',
      labels: {},
      annotations: {},
    };

    await renderComponent({ data: [dbInstance], loaded: true, showNamespaceColumn: true });

    const gridProps = gridTableMock.mock.calls[0][0];
    const contextItems = gridProps.getCustomContextMenuItems(dbInstance, 'kind');
    const deleteItem = contextItems.find(
      (item: { label?: string; onClick?: () => void }) => item.label === 'Delete'
    );
    await act(async () => {
      deleteItem?.onClick?.();
      await Promise.resolve();
    });
    expect(modalProps.current?.isOpen).toBe(true);

    await act(async () => {
      await modalProps.current.onConfirm();
    });

    // The strict GVK delete must be invoked, with apiVersion built as
    // "group/version" so the backend's schema.FromAPIVersionAndKind parses
    // it correctly.
    expect(deleteResourceByGVKMock).toHaveBeenCalledWith(
      'alpha:ctx',
      'documentdb.services.k8s.aws/v1alpha1',
      'DBInstance',
      'team-a',
      'db-dc-test-1-v4'
    );
    // The legacy kind-only path has been retired entirely. This assertion
    // used to check that it wasn't hit; now it's gone from the app surface.

    await flush();
    expect(modalProps.current?.isOpen).toBe(false);
  });

  // Characterization of the post-fix contract: after the kind-only-objects
  // cleanup, CustomResourceData is required to carry apiGroup/apiVersion.
  // A row that's missing apiVersion is a programming bug, and handleDelete
  // must fail loud rather than silently fall back to first-match-wins
  // discovery. The errorHandler should see the thrown error.
  it('throws instead of falling back when apiGroup/apiVersion are missing', async () => {
    const missingGVK: CustomResourceData = {
      ...baseResource,
      apiGroup: undefined,
      apiVersion: undefined,
    };

    await renderComponent({ data: [missingGVK], loaded: true, showNamespaceColumn: true });

    const gridProps = gridTableMock.mock.calls[0][0];
    const contextItems = gridProps.getCustomContextMenuItems(missingGVK, 'kind');
    const deleteItem = contextItems.find(
      (item: { label?: string; onClick?: () => void }) => item.label === 'Delete'
    );
    await act(async () => {
      deleteItem?.onClick?.();
      await Promise.resolve();
    });

    await act(async () => {
      await modalProps.current.onConfirm();
    });

    expect(deleteResourceByGVKMock).not.toHaveBeenCalled();
    expect(errorHandlerMock.handle).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('apiVersion missing') }),
      { action: 'delete', kind: 'CronJob', name: 'nightly-cleanup' }
    );

    await flush();
    expect(modalProps.current?.isOpen).toBe(false);
  });

  it('handles delete failure with errorHandler and reverts modal state', async () => {
    deleteResourceByGVKMock.mockRejectedValue(new Error('failure'));

    const resourceWithGVK: CustomResourceData = {
      ...baseResource,
      apiGroup: 'batch',
      apiVersion: 'v1',
    };

    await renderComponent({
      data: [resourceWithGVK],
      loaded: true,
      showNamespaceColumn: true,
    });

    const gridProps = gridTableMock.mock.calls[0][0];
    const deleteItem = gridProps
      .getCustomContextMenuItems(resourceWithGVK, 'kind')
      .find((item: { label?: string; onClick?: () => void }) => item.label === 'Delete');
    await act(async () => {
      deleteItem?.onClick?.();
      await Promise.resolve();
    });

    await act(async () => {
      await modalProps.current.onConfirm();
    });

    expect(deleteResourceByGVKMock).toHaveBeenCalled();
    expect(errorHandlerMock.handle).toHaveBeenCalledWith(expect.any(Error), {
      action: 'delete',
      kind: 'CronJob',
      name: 'nightly-cleanup',
    });

    await flush();
    expect(modalProps.current?.isOpen).toBe(false);
  });

  it('adjusts column sizing when short names are enabled', async () => {
    useShortNamesMock.mockReturnValue(true);

    await renderComponent({
      data: [
        {
          ...baseResource,
          kind: undefined,
          kindAlias: 'CR',
        },
      ],
      loaded: true,
      showNamespaceColumn: true,
    });

    const gridProps = gridTableMock.mock.calls[0][0];

    const generatedKey = gridProps.keyExtractor({
      kind: 'CronJob',
      name: 'svc',
      namespace: 'tools',
      kindAlias: 'CR',
      clusterId: 'alpha:ctx',
      apiGroup: 'batch',
      apiVersion: 'v1',
    } as CustomResourceData);
    expect(generatedKey).toBe('alpha:ctx|batch/v1/CronJob/tools/svc');
  });

  // CRD column: each row gets a clickable cell that opens the owning
  // CustomResourceDefinition in the object panel. The CRD itself is a
  // built-in (apiextensions.k8s.io/v1) so its GVK comes from the
  // built-in lookup table, not from the row data.
  //
  // The column factory bakes the click handler into the rendered React
  // element rather than exposing it on the column object, so these
  // tests drive the behavior by inspecting / calling the rendered
  // element's `onClick` prop directly.
  describe('CRD column', () => {
    const findColumn = (props: any, key: string) =>
      props.columns.find((col: any) => col.key === key);

    it('adds a CRD column that renders the row crdName', async () => {
      const resource: CustomResourceData = {
        ...baseResource,
        apiGroup: 'rds.services.k8s.aws',
        apiVersion: 'v1alpha1',
        kind: 'DBInstance',
        crdName: 'dbinstances.rds.services.k8s.aws',
      };

      await renderComponent({ data: [resource], loaded: true });

      const gridProps = gridTableMock.mock.calls[0][0];
      const crdCol = findColumn(gridProps, 'crd');
      expect(crdCol).toBeTruthy();
      expect(crdCol.header).toBe('CRD');

      // Interactive cells render as a `<span role="button">` with the
      // CRD name as their child text.
      const rendered = crdCol.render(resource) as React.ReactElement<any>;
      expect(rendered).toBeTruthy();
      expect((rendered as any).type).toBe('span');
      expect((rendered as any).props.role).toBe('button');
      expect((rendered as any).props.children).toBe('dbinstances.rds.services.k8s.aws');
      expect((rendered as any).props.title).toBe('Open dbinstances.rds.services.k8s.aws');
    });

    it('opens the CRD in the object panel when the CRD cell is clicked', async () => {
      const resource: CustomResourceData = {
        ...baseResource,
        apiGroup: 'rds.services.k8s.aws',
        apiVersion: 'v1alpha1',
        kind: 'DBInstance',
        crdName: 'dbinstances.rds.services.k8s.aws',
      };

      await renderComponent({ data: [resource], loaded: true });

      const gridProps = gridTableMock.mock.calls[0][0];
      const crdCol = findColumn(gridProps, 'crd');
      const rendered = crdCol.render(resource) as React.ReactElement<any>;

      // The rendered span carries the click handler. Drive it directly
      // with a synthetic event that doesn't have altKey set (so the
      // primary onClick fires, not onAltClick).
      openWithObjectMock.mockClear();
      const onClick = (rendered as any).props.onClick as (e: any) => void;
      expect(onClick).toBeTypeOf('function');
      onClick({ altKey: false, preventDefault: () => {}, stopPropagation: () => {} });

      expect(openWithObjectMock).toHaveBeenCalledTimes(1);
      const callArg = openWithObjectMock.mock.calls[0][0] as Record<string, unknown>;
      expect(callArg.kind).toBe('CustomResourceDefinition');
      expect(callArg.name).toBe('dbinstances.rds.services.k8s.aws');
      // The CRD is a built-in — its GVK comes from resolveBuiltinGroupVersion,
      // which returns apiextensions.k8s.io/v1.
      expect(callArg.group).toBe('apiextensions.k8s.io');
      expect(callArg.version).toBe('v1');
      // CRDs are cluster-scoped — namespace must NOT be set on the ref.
      expect(callArg.namespace).toBeUndefined();
      // ClusterId/clusterName threaded through for multi-cluster routing.
      expect(callArg.clusterId).toBe('alpha:ctx');
      expect(callArg.clusterName).toBe('alpha');
    });

    it('exposes a sortValue extractor so the column sorts by crdName', async () => {
      // Regression guard: the column key is "crd" but the data field is
      // "crdName", so without an explicit sortValue the default sort
      // (row[column.key]) reads undefined for every row and the column
      // silently doesn't sort. The column factory only wires sortValue
      // if we set it on the returned column object — verify that happened.
      const resource: CustomResourceData = {
        ...baseResource,
        crdName: 'dbinstances.rds.services.k8s.aws',
      };

      await renderComponent({ data: [resource], loaded: true });

      const gridProps = gridTableMock.mock.calls[0][0];
      const crdCol = findColumn(gridProps, 'crd');
      expect(crdCol.sortValue).toBeTypeOf('function');

      // The extractor should return a comparable string that useTableSort
      // can feed into localeCompare. We lowercase for case-insensitive sort.
      expect(crdCol.sortValue(resource)).toBe('dbinstances.rds.services.k8s.aws');

      // Rows without a crdName sort as empty string (they cluster at the
      // top or bottom depending on direction, not scattered randomly).
      const noCRD: CustomResourceData = { ...baseResource };
      expect(crdCol.sortValue(noCRD)).toBe('');
    });

    it('renders the CRD cell as inert text when crdName is missing', async () => {
      // Defensive: a row from a legacy snapshot or a synthetic source
      // might not carry crdName. The cell should not be clickable, must
      // not throw, and must not call openWithObject. The column factory
      // returns the placeholder string '-' for accessor === undefined
      // when the cell is non-interactive.
      const resource: CustomResourceData = {
        ...baseResource,
        apiGroup: 'batch',
        apiVersion: 'v1',
        kind: 'CronJob',
        // crdName intentionally omitted
      };

      await renderComponent({ data: [resource], loaded: true });

      const gridProps = gridTableMock.mock.calls[0][0];
      const crdCol = findColumn(gridProps, 'crd');
      const rendered = crdCol.render(resource);

      // Non-interactive accessor-undefined path returns the string '-'
      // directly (no wrapping span, no role="button", no onClick).
      expect(rendered).toBe('-');
    });
  });
});
