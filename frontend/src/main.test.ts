/**
 * frontend/src/main.test.ts
 *
 * The application entry (main.ts) prepares each native window before its root
 * module loads: error reporting is configured from the persisted preferences
 * before the root's module graph is evaluated, and a window that cannot open
 * shows its error, fails the panel transfer that opened it, and releases the
 * subscriptions its preparation took. Persisted preferences, window identity,
 * the native descriptor, and the panel-window client run for real over the
 * faked backend (test-utils/appState). The root components are stubs that
 * record when their module is evaluated, and the error-reporting integration
 * records when it is configured; harness.bootstrap.test.tsx covers what the
 * prepared windows do after they render.
 */

import { Events } from '@wailsio/runtime';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { panelwindow } from '@/core/backend-api/models';
import { installAppStateHarness } from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';

const { order, reporting } = vi.hoisted(() => ({
  order: [] as string[],
  reporting: {
    subscribe: null as null | ((listener: (enabled: boolean) => void) => () => void),
    captured: [] as Array<Record<string, unknown> | undefined>,
  },
}));

// The reporting integration records when the bootstrap configured it, the
// preference subscription it was given, and the failures sent to it; the real
// preferences load behind it.
vi.mock('@/core/telemetry/sentry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/telemetry/sentry')>()),
  captureUserVisibleError: (_error: unknown, details: { context?: Record<string, unknown> }) => {
    reporting.captured.push(details.context);
  },
  configureErrorReportingFromPreferences: async (
    _config: unknown,
    loadPreferences: () => Promise<{ errorReportingEnabled: boolean }>,
    subscribe: (listener: (enabled: boolean) => void) => () => void
  ) => {
    const preferences = await loadPreferences();
    reporting.subscribe = subscribe;
    order.push('error-reporting-configured');
    return { available: false, preferences };
  },
}));

// Each factory runs when its root module is first imported, so the recorded
// position is the moment that window's module graph is evaluated.
const workspaceModule = () => {
  order.push('workspace-module-evaluated');
  return { default: () => null };
};
const panelModule = () => {
  order.push('panel-module-evaluated');
  return { default: () => null };
};

const PREFERENCES_CHANGED = 'settings:preferences-changed';

const app = installAppStateHarness();

beforeEach(() => {
  order.length = 0;
  reporting.subscribe = null;
  reporting.captured.length = 0;
  // main.ts bootstraps when imported, so every test imports a fresh copy. The
  // harness has already loaded the real roots; the stubs replace them only for
  // the copy main.ts imports from now on.
  vi.resetModules();
  vi.doMock('./WorkspaceApp.tsx', workspaceModule);
  vi.doMock('./PanelWindowApp.tsx', panelModule);
  document.body.innerHTML = '<div id="app"></div>';
  app.backend.answer('FailPanelWindowTransfer', () => undefined);
});

afterEach(() => {
  document.body.innerHTML = '';
});

const startWindow = async () => {
  await import('@/main');
  await app.settle();
};

/** A panel window whose opening transfer is still in flight. */
const openingPanelWindow = () => {
  const dev = app.cluster({ name: 'dev', context: 'alpha' });
  const panel = app.panelWindow(dev, { name: 'panel-1', transferId: 'transfer-1' });
  app.backend.answer('GetNativeWindowDescriptor', () => ({
    schemaVersion: 1,
    role: panelwindow.NativeRole.NativeRolePanel,
    panel: { ...panel, state: panelwindow.WindowState.WindowStateOpening },
  }));
};

const alertText = () => document.querySelector('#app [role="alert"]')?.textContent ?? '';

/** The window bootstrap failures sent to error reporting. */
const bootstrapReports = () =>
  reporting.captured.filter((context) => context?.action === 'bootstrap-window');

describe('application bootstrap', () => {
  // A module-level failure anywhere in a window's graph is the most valuable
  // crash to report and the easiest to miss: evaluated before reporting is
  // configured, it reaches an uninstrumented page and is lost.
  it.each([
    ['workspace', 'workspace-module-evaluated', () => undefined],
    ['panel', 'panel-module-evaluated', openingPanelWindow],
  ])(
    'configures error reporting before evaluating a %s window’s root module',
    async (_role, evaluated, arrange) => {
      arrange();

      await startWindow();

      expect(order).toEqual(['error-reporting-configured', evaluated]);
      expect(app.events.listenerCount(PREFERENCES_CHANGED)).toBe(1);
    }
  );

  it('follows an error-reporting preference another window changes', async () => {
    app.preferences({ errorReportingEnabled: true });
    await startWindow();
    const reportingEnabled: boolean[] = [];
    requireValue(
      reporting.subscribe,
      'expected the reporting preference subscription'
    )((enabled) => {
      reportingEnabled.push(enabled);
    });

    app.backend.answer('GetAppSettings', () => ({ errorReportingEnabled: false }) as never);
    await act(async () => {
      app.events.emit(PREFERENCES_CHANGED);
    });
    await app.settle();

    expect(reportingEnabled).toEqual([false]);
  });

  it('shows the panel error, fails its opening transfer, and releases its subscription when the root module fails to load', async () => {
    openingPanelWindow();
    vi.doMock('./PanelWindowApp.tsx', () => {
      throw new Error('forced panel module failure');
    });

    await startWindow();

    expect(alertText()).toContain('Could not open this panel');
    expect(app.backend.calls('FailPanelWindowTransfer')).toEqual([
      ['panel-1', 'panel-1', 'transfer-1'],
    ]);
    expect(app.events.listenerCount(PREFERENCES_CHANGED)).toBe(0);
    expect(bootstrapReports()).toHaveLength(1);
  });

  it('fails the opening transfer when preparation fails after the descriptor resolves', async () => {
    openingPanelWindow();
    // The runtime refuses the window's preference subscription.
    const subscribe = requireValue(vi.mocked(Events.On).getMockImplementation(), 'Events.On');
    vi.mocked(Events.On).mockImplementation(((name: string, callback: never) => {
      if (name === PREFERENCES_CHANGED) {
        throw new Error('forced subscription failure');
      }
      return subscribe(name as never, callback);
    }) as typeof Events.On);

    await startWindow();

    expect(alertText()).toContain('Could not open this panel');
    expect(app.backend.calls('FailPanelWindowTransfer')).toEqual([
      ['panel-1', 'panel-1', 'transfer-1'],
    ]);
    expect(order).not.toContain('panel-module-evaluated');
  });

  it('shows the window error without failing a transfer when the descriptor cannot be resolved', async () => {
    app.backend.answer('GetNativeWindowDescriptor', () => {
      throw new Error('forced descriptor failure');
    });

    await startWindow();

    expect(alertText()).toContain('Could not open this application window');
    expect(app.backend.calls('FailPanelWindowTransfer')).toEqual([]);
    expect(bootstrapReports()).toHaveLength(1);
  });
});
