/**
 * frontend/src/main.test.ts
 *
 * Covers the bootstrap ordering of the application entry module.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { order } = vi.hoisted(() => ({ order: [] as string[] }));

vi.mock('@/core/telemetry/sentry', () => ({
  configureErrorReportingFromPreferences: vi.fn(async () => {
    order.push('error-reporting-configured');
    return { available: true, preferences: { errorReportingEnabled: true } };
  }),
  createReactRootErrorHandlers: vi.fn(() => ({})),
}));

// The factory runs when the module is first imported, so the recorded position
// is the moment the application module graph is evaluated.
vi.mock('./App.tsx', () => {
  order.push('app-module-evaluated');
  return { default: () => null };
});

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
    order.length = 0;
    vi.resetModules();
    document.body.innerHTML = '<div id="app"></div>';
  });

  // A module-level failure anywhere in the app graph is the most valuable crash
  // to report and the easiest to miss: if that graph is evaluated before the SDK
  // is initialized, the crash reaches an uninstrumented page and is lost.
  it('configures error reporting before evaluating the app module graph', async () => {
    await import('@/main');
    await vi.waitFor(() => {
      expect(order).toContain('app-module-evaluated');
    });

    expect(order).toEqual(['error-reporting-configured', 'app-module-evaluated']);
  });
});
