import { describe, expect, it, vi } from 'vitest';

const platformMocks = vi.hoisted(() => ({
  isMacPlatform: vi.fn(() => false),
}));

vi.mock('@/utils/platform', () => ({
  isMacPlatform: platformMocks.isMacPlatform,
}));

import {
  applyPassiveLoadingPolicy,
  getAutoRefreshShortcutLabel,
  getClusterDataAutoRefreshDisabledMessage,
} from './loadingPolicy';

describe('applyPassiveLoadingPolicy', () => {
  it('covers applyPassiveLoadingPolicy scenarios', async () => {
    // Scenario: suppresses passive loading when auto-refresh is paused
    expect(
      applyPassiveLoadingPolicy({
        loading: true,
        hasLoaded: false,
        hasData: false,
        isPaused: true,
        isManualRefreshActive: false,
      })
    ).toEqual({
      loading: false,
      hasLoaded: false,
      suppressPassiveLoading: true,
      showPausedEmptyState: true,
    });
    // Scenario: preserves loading when a manual refresh is active
    expect(
      applyPassiveLoadingPolicy({
        loading: true,
        hasLoaded: false,
        hasData: false,
        isPaused: true,
        isManualRefreshActive: true,
      })
    ).toEqual({
      loading: true,
      hasLoaded: false,
      suppressPassiveLoading: false,
      showPausedEmptyState: false,
    });
  });
});

describe('paused empty-state messaging', () => {
  it('covers paused empty-state messaging scenarios', async () => {
    // Scenario: uses cmd+R on macOS
    platformMocks.isMacPlatform.mockReturnValue(true);

    expect(getAutoRefreshShortcutLabel()).toBe('cmd+R');
    expect(getClusterDataAutoRefreshDisabledMessage()).toContain('press cmd+R');
    // Scenario: uses ctrl+R on non-mac platforms
    platformMocks.isMacPlatform.mockReturnValue(false);

    expect(getAutoRefreshShortcutLabel()).toBe('ctrl+R');
    expect(getClusterDataAutoRefreshDisabledMessage()).toContain('press ctrl+R');
  });
});
