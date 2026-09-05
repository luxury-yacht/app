import type { ReactNode } from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { panelwindow } from '@/core/backend-api/models';

const mocks = vi.hoisted(() => ({
  acknowledgeReady: vi.fn(() => Promise.resolve()),
  beginDock: vi.fn(() => Promise.resolve()),
  dockProviderProps: null as Record<string, unknown> | null,
  failTransfer: vi.fn(() => Promise.resolve()),
  fixedClusterProps: null as Record<string, unknown> | null,
  firstBlocker: vi.fn(() => null as { focus: () => void } | null),
  onRowClick: vi.fn(() => 'panel-pod'),
  objectPanelProps: null as Record<string, unknown> | null,
  shortcutsProps: null as Record<string, unknown> | null,
  onObjectOpenAuthorized: vi.fn(() => vi.fn()),
  authorizedHandler: null as ((event: Record<string, unknown>) => void) | null,
  reportOperationalError: vi.fn(),
  requestTabClose: vi.fn(() => Promise.resolve()),
  requestTabTransfer: vi.fn(() => Promise.resolve()),
  setObjectPanelActiveTab: vi.fn(),
  openPanels: new Map<string, Record<string, string>>(),
}));

function PassThrough({ children }: Readonly<{ children: ReactNode }>) {
  return <>{children}</>;
}

vi.mock('@core/contexts/AppearanceModeContext', () => ({
  AppearanceModeProvider: PassThrough,
}));
vi.mock('@core/contexts/AuthErrorContext', () => ({ AuthErrorProvider: PassThrough }));
vi.mock('@core/contexts/ClusterLifecycleContext', () => ({
  ClusterLifecycleProvider: PassThrough,
}));
vi.mock('@core/contexts/ZoomContext', () => ({ ZoomProvider: PassThrough }));
vi.mock('@core/refresh', () => ({ RefreshManagerProvider: PassThrough }));
vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  FixedClusterProvider: ({ children, ...props }: { children: ReactNode }) => {
    mocks.fixedClusterProps = props;
    return <>{children}</>;
  },
}));
vi.mock('@modules/namespace/contexts/NamespaceContext', () => ({
  NamespaceProvider: PassThrough,
}));
vi.mock('@modules/object-panel/components/ObjectPanel/ObjectPanel', () => ({
  default: (props: Record<string, unknown>) => {
    mocks.objectPanelProps = props;
    return <div data-testid="object-panel" />;
  },
}));
vi.mock('@modules/object-panel/contexts/ObjectPanelStateContext', () => ({
  ObjectPanelStateProvider: PassThrough,
  useObjectPanelActiveTabs: () => new Map([['panel-pod', 'events']]),
  useObjectPanelState: () => ({
    openPanels: mocks.openPanels,
    onRowClick: mocks.onRowClick,
    setObjectPanelActiveTab: mocks.setObjectPanelActiveTab,
  }),
}));
vi.mock('@shared/components/tabs/dragCoordinator', () => ({ TabDragProvider: PassThrough }));
vi.mock('@ui/dockable', () => ({
  DockablePanelProvider: ({ children, ...props }: { children: ReactNode }) => {
    mocks.dockProviderProps = props;
    return <>{children}</>;
  },
}));
vi.mock('@ui/errors', () => ({
  AppErrorBoundary: PassThrough,
  PanelErrorBoundary: PassThrough,
}));
vi.mock('@ui/layout/AppHeader', () => ({
  default: ({ mode }: { mode: string }) => <div data-testid="app-header" data-mode={mode} />,
}));
vi.mock('@ui/shortcuts', () => ({ KeyboardProvider: PassThrough }));
vi.mock('@ui/shortcuts/components/TextContextMenu', () => ({ default: () => null }));
vi.mock('@/core/cluster-workspace/useClusterWorkspace', () => ({
  useClusterWorkspaceSnapshot: () => ({ clusters: [] }),
}));
vi.mock('@/core/panel-windows/panelWindowClusterName', () => ({
  resolvePanelWindowClusterName: () => 'Cluster A',
}));
vi.mock('@/core/panel-windows', () => ({
  acknowledgePanelWindowReady: (...args: unknown[]) =>
    (mocks.acknowledgeReady as (...values: unknown[]) => Promise<void>)(...args),
  beginPanelWindowDock: (...args: unknown[]) =>
    (mocks.beginDock as (...values: unknown[]) => Promise<void>)(...args),
  failPanelWindowTransfer: (...args: unknown[]) =>
    (mocks.failTransfer as (...values: unknown[]) => Promise<void>)(...args),
  onPanelObjectOpenAuthorized: (handler: (event: Record<string, unknown>) => void) => {
    mocks.authorizedHandler = handler;
    return (mocks.onObjectOpenAuthorized as (value: unknown) => () => void)(handler);
  },
  requestPanelTabClose: (...args: unknown[]) =>
    (mocks.requestTabClose as (...values: unknown[]) => Promise<void>)(...args),
  requestPanelTabTransfer: (...args: unknown[]) =>
    (mocks.requestTabTransfer as (...values: unknown[]) => Promise<void>)(...args),
}));
vi.mock('@/core/panel-windows/PanelWindowRoleContext', () => ({
  PanelWindowRoleProvider: PassThrough,
}));
vi.mock('@/core/panel-windows/panelLifecycleGuards', () => ({
  PanelLifecycleGuardProvider: PassThrough,
  usePanelLifecycleGuardRegistry: () => ({ firstBlocker: mocks.firstBlocker }),
}));
vi.mock('@/ui/shortcuts/components/PanelWindowShortcuts', () => ({
  PanelWindowShortcuts: (props: Record<string, unknown>) => {
    mocks.shortcutsProps = props;
    return null;
  },
}));
vi.mock('@/utils/errorHandler', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/errorHandler')>()),
  reportOperationalError: (...args: unknown[]) => mocks.reportOperationalError(...args),
}));

import { errorHandler } from '@/utils/errorHandler';
import PanelWindowApp from './PanelWindowApp';

const descriptor = {
  windowName: 'panel-1',
  ownerWindowName: 'workspace-1',
  clusterId: 'cluster-a',
  groupId: 'group-1',
  state: 'opening',
  snapshot: {
    schemaVersion: 1,
    transferId: 'transfer-panel-window-test',
    ownerWindowName: 'workspace-1',
    clusterId: 'cluster-a',
    groupId: 'group-1',
    tabs: [
      {
        kind: 'object',
        panelId: 'panel-pod',
        objectRef: {
          clusterId: 'cluster-a',
          group: '',
          version: 'v1',
          kind: 'Pod',
          namespace: 'default',
          name: 'api',
        },
        activeView: 'events',
      },
    ],
    activePanelId: 'panel-pod',
  },
} as panelwindow.WindowDescriptor;

const descriptorWithTransfer = (transferId: string): panelwindow.WindowDescriptor => ({
  ...descriptor,
  snapshot: { ...descriptor.snapshot, transferId },
});

describe('PanelWindowApp', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    errorHandler.clearHistory();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    mocks.acknowledgeReady.mockReset();
    mocks.acknowledgeReady.mockResolvedValue(undefined);
    mocks.beginDock.mockClear();
    mocks.failTransfer.mockClear();
    mocks.firstBlocker.mockReset();
    mocks.firstBlocker.mockReturnValue(null);
    mocks.onRowClick.mockClear();
    mocks.onRowClick.mockReturnValue('panel-pod');
    mocks.setObjectPanelActiveTab.mockClear();
    mocks.requestTabClose.mockClear();
    mocks.requestTabTransfer.mockClear();
    mocks.reportOperationalError.mockClear();
    mocks.authorizedHandler = null;
    mocks.dockProviderProps = null;
    mocks.fixedClusterProps = null;
    mocks.objectPanelProps = null;
    mocks.shortcutsProps = null;
    mocks.openPanels.clear();
    mocks.openPanels.set('panel-pod', {
      clusterId: 'cluster-a',
      group: '',
      version: 'v1',
      kind: 'Pod',
      namespace: 'default',
      name: 'api',
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('wires the child-window shell from its immutable descriptor', async () => {
    await act(async () => {
      root.render(<PanelWindowApp descriptor={descriptor} />);
      await Promise.resolve();
    });

    expect(
      container.querySelector('.panel-window-app')?.getAttribute('data-native-panel-window')
    ).toBe('panel-1');
    expect(mocks.fixedClusterProps).toEqual({ clusterId: 'cluster-a', clusterName: 'Cluster A' });
    expect(mocks.dockProviderProps).toMatchObject({
      nativeWindowMode: true,
      initialTabGroups: {
        right: { tabs: ['panel-pod'], activeTab: 'panel-pod' },
        bottom: { tabs: [], activeTab: null },
        floating: [],
      },
    });
    expect(container.querySelector('[data-testid="app-header"]')?.getAttribute('data-mode')).toBe(
      'panel'
    );
    expect(mocks.objectPanelProps).toMatchObject({
      panelId: 'panel-pod',
      defaultPosition: 'right',
      defaultGroupKey: 'right',
    });
    expect(mocks.acknowledgeReady).toHaveBeenCalledWith('panel-1', 'transfer-panel-window-test');
    expect(mocks.shortcutsProps).toMatchObject({ ready: true });
  });

  it('shows the close-blocker explanation inside the floating window', async () => {
    await act(async () =>
      root.render(<PanelWindowApp descriptor={descriptorWithTransfer('warning-surface')} />)
    );
    await act(async () => {
      errorHandler.warn('Save or discard your YAML changes before closing or moving this panel.', {
        title: 'Unsaved YAML changes',
      });
    });
    expect(container.textContent).toContain('Unsaved YAML changes');
    expect(container.textContent).toContain('Save or discard your YAML changes');
  });

  it('reports and rolls back a failed ready acknowledgement', async () => {
    const readyError = new Error('window disappeared');
    mocks.acknowledgeReady.mockRejectedValueOnce(readyError);
    const failedDescriptor = descriptorWithTransfer('transfer-ready-failure');

    await act(async () => {
      root.render(<PanelWindowApp descriptor={failedDescriptor} />);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.failTransfer).toHaveBeenCalledWith('panel-1', 'panel-1', 'transfer-ready-failure');
    expect(mocks.reportOperationalError).toHaveBeenCalledWith(readyError, {
      source: 'PanelWindowApp',
      action: 'acknowledge-ready',
    });
  });

  it('reports when ready-failure cleanup was already completed by the registry', async () => {
    const readyError = new Error('owner unavailable');
    const cleanupError = new Error('panel window is not live');
    mocks.acknowledgeReady.mockRejectedValueOnce(readyError);
    mocks.failTransfer.mockRejectedValueOnce(cleanupError);
    const failedDescriptor = descriptorWithTransfer('transfer-cleanup-complete');

    await act(async () => {
      root.render(<PanelWindowApp descriptor={failedDescriptor} />);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mocks.reportOperationalError).toHaveBeenCalledWith(cleanupError, {
      source: 'PanelWindowApp',
      action: 'fail-ready-transfer',
    });
  });

  it('routes tab close, authorized object opens, blockers, and dock-back through the protocol', async () => {
    const routedDescriptor = descriptorWithTransfer('transfer-protocol-routes');
    await act(async () => {
      root.render(<PanelWindowApp descriptor={routedDescriptor} />);
      await Promise.resolve();
    });
    if (!mocks.dockProviderProps || !mocks.authorizedHandler) {
      throw new Error('expected panel-window protocol handlers');
    }
    const dockProviderProps = mocks.dockProviderProps as {
      onGroupMoveRequest: (
        group: { tabs: string[]; activeTab: string | null },
        target: 'right' | 'bottom' | 'floating'
      ) => void;
      onTabCloseRequest: (panelId: string) => void;
    };

    act(() => dockProviderProps.onTabCloseRequest('panel-pod'));
    expect(mocks.requestTabClose).toHaveBeenCalledWith('panel-1', 'panel-pod');

    const objectRef = descriptor.snapshot.tabs?.[0]?.objectRef;
    if (!objectRef) {
      throw new Error('expected descriptor object reference');
    }
    act(() => mocks.authorizedHandler?.({ panelId: 'panel-pod', objectRef, activeView: 'yaml' }));
    expect(mocks.onRowClick).toHaveBeenCalledWith(objectRef);
    expect(mocks.setObjectPanelActiveTab).toHaveBeenCalledWith('cluster-a', 'panel-pod', 'yaml');

    dockProviderProps.onGroupMoveRequest(
      { tabs: ['panel-pod'], activeTab: 'panel-pod' },
      'floating'
    );
    expect(mocks.beginDock).not.toHaveBeenCalled();

    const focus = vi.fn();
    mocks.firstBlocker.mockReturnValueOnce({ focus });
    dockProviderProps.onGroupMoveRequest({ tabs: ['panel-pod'], activeTab: 'panel-pod' }, 'bottom');
    expect(focus).toHaveBeenCalledOnce();

    dockProviderProps.onGroupMoveRequest({ tabs: ['panel-pod'], activeTab: 'panel-pod' }, 'bottom');
    expect(mocks.beginDock).toHaveBeenCalledWith(
      'panel-1',
      'bottom',
      expect.objectContaining({
        ownerWindowName: 'workspace-1',
        clusterId: 'cluster-a',
        groupId: 'group-1',
        activePanelId: 'panel-pod',
        tabs: [
          expect.objectContaining({
            panelId: 'panel-pod',
            objectRef,
            activeView: 'events',
          }),
        ],
      })
    );
  });

  it('routes native-window drops but leaves a one-tab native source unchanged on tear-off', async () => {
    await act(async () => {
      root.render(<PanelWindowApp descriptor={descriptorWithTransfer('transfer-tab-drag')} />);
      await Promise.resolve();
    });
    const props = mocks.dockProviderProps as {
      tabDragIdentity: { getTabSnapshot: (panelId: string) => unknown };
      onExternalTabDrop: (payload: unknown, targetGroup: string, index: number) => void;
      onTabTearOff: (payload: unknown, cursor: { x: number; y: number }) => void;
    };
    const tab = props.tabDragIdentity.getTabSnapshot('panel-pod');
    const payload = {
      kind: 'dockable-tab',
      panelId: 'panel-pod',
      sourceGroupId: 'right',
      sourceWindowGroupId: 'group-2',
      sourceWindowName: 'panel-2',
      ownerWindowName: 'workspace-1',
      clusterId: 'cluster-a',
      tab,
    };

    act(() => props.onExternalTabDrop(payload, 'right', 1));
    expect(mocks.requestTabTransfer).toHaveBeenLastCalledWith(
      'panel-1',
      expect.objectContaining({
        sourceWindowName: 'panel-2',
        targetWindowName: 'panel-1',
        targetGroupId: 'group-1',
        targetIndex: 1,
        targetKind: 'panel-window',
      })
    );

    const sourcePayload = {
      ...payload,
      sourceWindowName: 'panel-1',
      sourceWindowGroupId: 'group-1',
    };
    mocks.requestTabTransfer.mockClear();
    act(() => props.onTabTearOff(sourcePayload, { x: 2100, y: 400 }));
    expect(mocks.requestTabTransfer).not.toHaveBeenCalled();
  });

  it('tears a tab out of a multi-tab native source into a new window', async () => {
    mocks.openPanels.set('panel-service', {
      clusterId: 'cluster-a',
      group: '',
      version: 'v1',
      kind: 'Service',
      namespace: 'default',
      name: 'api',
    });
    await act(async () => {
      root.render(<PanelWindowApp descriptor={descriptorWithTransfer('transfer-tab-tear-off')} />);
      await Promise.resolve();
    });
    const props = mocks.dockProviderProps as {
      tabDragIdentity: { getTabSnapshot: (panelId: string) => unknown };
      onTabTearOff: (payload: unknown, cursor: { x: number; y: number }) => void;
    };
    const tab = props.tabDragIdentity.getTabSnapshot('panel-pod');

    act(() =>
      props.onTabTearOff(
        {
          kind: 'dockable-tab',
          panelId: 'panel-pod',
          sourceGroupId: 'right',
          sourceWindowGroupId: 'group-1',
          sourceWindowName: 'panel-1',
          ownerWindowName: 'workspace-1',
          clusterId: 'cluster-a',
          tab,
        },
        { x: 2100, y: 400 }
      )
    );
    expect(mocks.requestTabTransfer).toHaveBeenCalledWith(
      'panel-1',
      expect.objectContaining({
        sourceWindowName: 'panel-1',
        targetWindowName: '',
        targetKind: 'new-window',
        cursorX: 2100,
        cursorY: 400,
      })
    );
  });
});
