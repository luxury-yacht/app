/**
 * frontend/src/main.test.ts
 *
 * Covers the bootstrap ordering of the application entry module.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { order, bootstrap } = vi.hoisted(() => ({
  order: [] as string[],
  bootstrap: {
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

vi.mock('@/core/telemetry/sentry', () => ({
  configureErrorReportingFromPreferences: vi.fn(async () => {
    order.push('error-reporting-configured');
    return { available: true, preferences: { errorReportingEnabled: true } };
  }),
  createReactRootErrorHandlers: vi.fn(() => ({})),
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
}));

vi.mock('@/core/desktop-runtime', () => ({
  initializeWindowIdentity: vi.fn(async () => 'main'),
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
  createRoot: vi.fn(() => ({ render: vi.fn() })),
}));

describe('application bootstrap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    order.length = 0;
    bootstrap.descriptor = {
      schemaVersion: 1,
      role: 'workspace',
      workspace: { windowName: 'main' },
      panel: undefined,
    };
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

  it('loads only the panel root and skips workspace auto-refresh for a panel descriptor', async () => {
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
    expect(initializeAutoRefresh).not.toHaveBeenCalled();
  });
});
