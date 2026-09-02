/**
 * frontend/src/main.test.ts
 *
 * Covers the bootstrap ordering of the application entry module.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { order, bootstrap } = vi.hoisted(() => ({
  order: [] as string[],
  bootstrap: {
    failPanelRender: false,
    descriptor: {
      schemaVersion: 1,
      role: 'workspace' as 'workspace' | 'panel',
      workspace: { windowName: 'main' } as { windowName: string } | undefined,
      panel: undefined as
        | {
            windowName: string;
            ownerWindowName: string;
            clusterId: string;
            groupId: string;
            state: string;
            snapshot: Record<string, unknown>;
          }
        | undefined,
    },
  },
}));

const identityMocks = vi.hoisted(() => ({
  setWorkspaceProjectionIdentity: vi.fn(),
}));

const desktopRuntimeMocks = vi.hoisted(() => ({
  onBroadcastEvent: vi.fn(),
}));

const panelTransferMocks = vi.hoisted(() => ({
  failPanelWindowTransfer: vi.fn(),
}));

const reactRootMocks = vi.hoisted(() => ({
  render: vi.fn(),
}));

vi.mock('@/core/telemetry/sentry', () => ({
  configureErrorReportingFromPreferences: vi.fn(async () => {
    order.push('error-reporting-configured');
    return { available: true, preferences: { errorReportingEnabled: true } };
  }),
  createReactRootErrorHandlers: vi.fn(() => ({})),
}));

vi.mock('@/utils/errorHandler', () => ({
  reportOperationalError: vi.fn(),
}));

// The factory runs when the module is first imported, so the recorded position
// is the moment the application module graph is evaluated.
vi.mock('./WorkspaceApp.tsx', () => {
  order.push('workspace-module-evaluated');
  return { default: () => null };
});

vi.mock('./PanelWindowApp.tsx', () => {
  order.push('panel-module-evaluated');
  return { default: () => null };
});

vi.mock('@/core/panel-windows', () => ({
  resolveNativeWindowDescriptor: vi.fn(async () => bootstrap.descriptor),
  failPanelWindowTransfer: (...args: unknown[]) =>
    panelTransferMocks.failPanelWindowTransfer(...args),
}));

vi.mock('@/core/desktop-runtime', () => ({
  initializeWindowIdentity: vi.fn(async () => 'main'),
  onBroadcastEvent: (...args: unknown[]) => desktopRuntimeMocks.onBroadcastEvent(...args),
}));

vi.mock('@/core/window-identity', () => ({
  setWorkspaceProjectionIdentity: identityMocks.setWorkspaceProjectionIdentity,
}));

vi.mock('@shared/scrollbars/scrollbarActivity', () => ({
  initializeScrollbarActivityTracking: vi.fn(),
}));

vi.mock('@/core/refresh', () => ({
  initializeAutoRefresh: vi.fn(),
}));

vi.mock('@/core/settings/appPreferences', () => ({
  hydrateAppPreferences: vi.fn(async () => ({ errorReportingEnabled: true })),
}));

vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(() => ({
    render: (...args: unknown[]) => {
      if (bootstrap.failPanelRender) {
        throw new Error('forced panel bootstrap failure');
      }
      return reactRootMocks.render(...args);
    },
  })),
}));

describe('application bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    order.length = 0;
    desktopRuntimeMocks.onBroadcastEvent.mockReset();
    desktopRuntimeMocks.onBroadcastEvent.mockReturnValue(() => undefined);
    bootstrap.descriptor = {
      schemaVersion: 1,
      role: 'workspace',
      workspace: { windowName: 'main' },
      panel: undefined,
    };
    bootstrap.failPanelRender = false;
    panelTransferMocks.failPanelWindowTransfer.mockReset();
    panelTransferMocks.failPanelWindowTransfer.mockResolvedValue(undefined);
    reactRootMocks.render.mockReset();
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
  });

  // A module-level failure anywhere in the app graph is the most valuable crash
  // to report and the easiest to miss: if that graph is evaluated before the SDK
  // is initialized, the crash reaches an uninstrumented page and is lost.
  it('configures error reporting before evaluating the app module graph', async () => {
    await import('@/main');
    await vi.waitFor(() => {
      expect(order).toContain('workspace-module-evaluated');
    });

    expect(order).toEqual(['error-reporting-configured', 'workspace-module-evaluated']);
  });

  it('loads the panel root under its owner workspace projection and initializes auto-refresh', async () => {
    bootstrap.descriptor = {
      schemaVersion: 1,
      role: 'panel',
      workspace: undefined,
      panel: {
        windowName: 'panel-1',
        ownerWindowName: 'main',
        clusterId: 'cluster-1',
        groupId: 'group-1',
        state: 'opening',
        snapshot: {
          schemaVersion: 1,
          transferId: 'transfer-1',
          ownerWindowName: 'main',
          clusterId: 'cluster-1',
          groupId: 'group-1',
          activePanelId: 'panel-a',
          tabs: [],
        },
      },
    };

    const { initializeAutoRefresh } = await import('@/core/refresh');
    await import('@/main');
    await vi.waitFor(() => {
      expect(order).toContain('panel-module-evaluated');
    });

    expect(order).toEqual(['error-reporting-configured', 'panel-module-evaluated']);
    expect(identityMocks.setWorkspaceProjectionIdentity).toHaveBeenCalledWith('main');
    expect(initializeAutoRefresh).toHaveBeenCalledOnce();
    expect(desktopRuntimeMocks.onBroadcastEvent).toHaveBeenCalledWith(
      'settings:preferences-changed',
      expect.any(Function)
    );
  });

  it('shows a visible error and fails an opening panel transfer when bootstrap crashes', async () => {
    bootstrap.failPanelRender = true;
    bootstrap.descriptor = {
      schemaVersion: 1,
      role: 'panel',
      workspace: undefined,
      panel: {
        windowName: 'panel-1',
        ownerWindowName: 'main',
        clusterId: 'cluster-1',
        groupId: 'group-1',
        state: 'opening',
        snapshot: {
          schemaVersion: 1,
          transferId: 'transfer-1',
          ownerWindowName: 'main',
          clusterId: 'cluster-1',
          groupId: 'group-1',
          activePanelId: 'panel-a',
          tabs: [],
        },
      },
    };

    await import('@/main');

    await vi.waitFor(() => {
      expect(document.getElementById('app')?.textContent).toContain('Could not open this panel');
    });
    expect(panelTransferMocks.failPanelWindowTransfer).toHaveBeenCalledWith(
      'panel-1',
      'panel-1',
      'transfer-1'
    );
  });
});
