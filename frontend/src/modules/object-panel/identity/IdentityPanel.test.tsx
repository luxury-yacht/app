import type { GridColumnDefinition } from '@shared/components/tables/GridTable';
import { KeyboardProvider } from '@ui/shortcuts';
import type { ReactNode } from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClusterIdentitiesSnapshot, ClusterIdentityBinding } from '@/core/refresh/types';
import PanelContent from '../components/PanelContent';
import { type IdentityPanelRef, panelTargetId } from '../panelTarget';

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  demand: vi.fn(),
  close: vi.fn(),
  open: vi.fn(),
  resourcePanel: vi.fn(),
  live: { status: 'ready', queryReconcileVersion: 1 } as {
    status: string;
    queryReconcileVersion?: number;
  },
}));
vi.mock('@/core/data-access', () => ({
  requestRefreshDomainState: (...args: unknown[]) => mocks.request(...args),
  useRefreshDomainHandle: (options: unknown) => {
    mocks.demand(options);
    return { state: mocks.live };
  },
}));
vi.mock('../components/ObjectPanel/ObjectPanel', () => ({
  default: (props: unknown) => {
    mocks.resourcePanel(props);
    return null;
  },
}));
vi.mock('../contexts/ObjectPanelStateContext', () => ({
  useObjectPanelState: () => ({ closePanel: mocks.close }),
}));
vi.mock('../hooks/useObjectPanel', () => ({
  useObjectPanel: () => ({ openWithObject: mocks.open }),
}));
vi.mock('@shared/hooks/useNavigateToView', () => ({
  useNavigateToView: () => ({ available: false }),
}));
vi.mock('@/core/cluster-workspace/useClusterWorkspace', () => ({
  useClusterNameResolver: () => () => 'Production',
}));
vi.mock('@/core/panel-windows/panelLifecycleGuards', () => ({
  PanelLifecycleClusterSurface: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@core/contexts/ZoomContext', () => ({ useZoom: () => ({ zoomLevel: 100 }) }));
vi.mock('@ui/shortcuts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ui/shortcuts')>()),
  useKeyboardContext: () => null,
}));
vi.mock('@ui/dockable', () => ({
  useDockablePanelContext: () => ({
    tabGroups: {
      right: { tabs: [], activeTab: null },
      bottom: { tabs: [], activeTab: null },
      floating: [],
    },
    getPreferredOpenGroupKey: () => 'right',
  }),
  DockablePanel: ({ children, onClose }: { children: ReactNode; onClose: () => void }) => (
    <div>
      <button type="button" onClick={onClose}>
        Close panel
      </button>
      {children}
    </div>
  ),
}));
// Keep the real query, panel contents, table, and links; substitute persistence
// and native layout providers to observe data and dispatch without a window.
vi.mock('@modules/resource-grid/useResourceGridTable', () => ({
  useObjectPanelResourceGridTable: (params: {
    data: ClusterIdentityBinding[];
    columns: GridColumnDefinition<ClusterIdentityBinding>[];
    keyExtractor: (row: ClusterIdentityBinding) => string;
  }) => ({
    gridTableProps: {
      data: params.data,
      columns: params.columns,
      keyExtractor: params.keyExtractor,
      virtualization: { enabled: false },
    },
  }),
}));

const identity: IdentityPanelRef = {
  targetType: 'identity',
  clusterId: 'cluster-a',
  kind: 'User',
  name: ' alice ',
};
const role = {
  clusterId: 'cluster-a',
  group: 'rbac.authorization.k8s.io',
  version: 'v1',
  kind: 'ClusterRole',
  resource: 'clusterroles',
  namespace: '',
  name: 'reader',
};
const binding: ClusterIdentityBinding = {
  ...role,
  kind: 'RoleBinding',
  resource: 'rolebindings',
  namespace: 'payments',
  name: 'team-readers',
  role,
};
const payload = (bindings: ClusterIdentityBinding[] = [binding]): ClusterIdentitiesSnapshot => ({
  clusterId: 'cluster-a',
  clusterName: 'Production',
  provider: 'typed-resource',
  table: 'cluster-identities',
  total: 1,
  unfilteredTotal: 1,
  totalIsExact: true,
  facetsExact: true,
  capabilities: {},
  rows: [
    {
      clusterId: 'cluster-a',
      kind: 'User',
      name: identity.name,
      namespace: '',
      bindings,
      grantScopes: ['payments'],
    },
  ],
  completeness: 'complete',
});

describe('IdentityPanel', () => {
  let host: HTMLDivElement;
  let root: ReactDOM.Root;
  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = ReactDOM.createRoot(host);
    vi.clearAllMocks();
    mocks.live = { status: 'ready', queryReconcileVersion: 1 };
    mocks.request.mockResolvedValue({
      status: 'executed',
      data: { status: 'ready', data: payload() },
    });
  });
  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });
  const render = async (ref = identity, suppressed = false) => {
    await act(async () =>
      root.render(
        <KeyboardProvider>
          <PanelContent
            panelId={panelTargetId(ref)}
            objectRef={ref}
            suppressWorkspaceSurface={suppressed}
          />
        </KeyboardProvider>
      )
    );
  };
  const button = (name: string) =>
    [...host.querySelectorAll('button')].find((el) => el.textContent === name);
  it('keeps service accounts on the resource panel path', async () => {
    const serviceAccount = {
      clusterId: 'cluster-a',
      group: '',
      version: 'v1',
      kind: 'ServiceAccount',
      namespace: 'ci',
      name: 'builder',
    };
    await act(async () =>
      root.render(<PanelContent panelId="service-account" objectRef={serviceAccount} />)
    );
    expect(mocks.resourcePanel).toHaveBeenCalledWith(
      expect.objectContaining({ objectRef: serviceAccount })
    );
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('queries the exact subject and opens binding and role objects with their complete identity', async () => {
    await render();
    const scope = mocks.request.mock.calls[0][0].scope as string;
    expect(decodeURIComponent(scope.replace(/\+/g, ' '))).toContain(
      'predicate.identity=["cluster-a","User",""," alice "]'
    );
    expect(mocks.demand).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, demand: 'query' })
    );
    expect(host.querySelector('.object-name')?.textContent).toBe(identity.name);
    expect([...host.querySelectorAll('[role="tab"]')].map((el) => el.textContent)).toEqual([
      'Details',
    ]);
    expect(mocks.resourcePanel).not.toHaveBeenCalled();
    act(() => button('team-readers')?.click());
    const { role: _role, ...bindingRef } = binding;
    expect(mocks.open).toHaveBeenLastCalledWith(bindingRef);
    act(() => button('ClusterRole/reader')?.click());
    expect(mocks.open).toHaveBeenLastCalledWith({ ...role, namespace: undefined });
    act(() => button('Close panel')?.click());
    expect(mocks.close).toHaveBeenCalledWith(identity.clusterId, panelTargetId(identity));
  });
  it('holds queries during warm-up while retaining demand, then responds to binding deletion', async () => {
    mocks.live = { status: 'initialising' };
    await render();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.demand).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: true }));
    mocks.live = { status: 'ready', queryReconcileVersion: 1 };
    await render();
    expect(button('team-readers')).toBeDefined();
    mocks.request.mockResolvedValue({
      status: 'executed',
      data: { status: 'ready', data: { ...payload(), rows: [] } },
    });
    mocks.live = { status: 'ready', queryReconcileVersion: 2 };
    await render();
    expect(button('team-readers')).toBeUndefined();
    expect(host.querySelector('.overview-value')?.textContent).toBe('Production');
    expect(host.textContent).toContain('No direct bindings');
    await render(identity, true);
    expect(mocks.demand).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false }));
  });
  it('exposes partial visibility and replaces prior rows when switching subjects or encountering an error', async () => {
    const partial = {
      ...payload([{ ...binding, role: undefined }]),
      completeness: 'partial',
      partialReason: 'rolebindings-unavailable',
    };
    mocks.request.mockResolvedValue({
      status: 'executed',
      data: { status: 'ready', data: partial },
    });
    await render();
    expect(host.querySelector('[role="status"]')).not.toBeNull();
    expect(button('ClusterRole/reader')).toBeUndefined();
    mocks.request.mockResolvedValue({
      status: 'executed',
      data: { status: 'error', error: 'Permission denied' },
    });
    await render({ ...identity, clusterId: 'cluster-b', kind: 'Group' });
    expect(button('team-readers')).toBeUndefined();
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    const lastScope = mocks.request.mock.calls[mocks.request.mock.calls.length - 1][0]
      .scope as string;
    expect(decodeURIComponent(lastScope.replace(/\+/g, ' '))).toContain(
      '["cluster-b","Group",""," alice "]'
    );
  });
});
