import { describe, expect, it } from 'vitest';
import { applyPassiveLoadingPolicy } from './loadingPolicy';

describe('applyPassiveLoadingPolicy', () => {
  it('suppresses passive loading when auto-refresh is paused', () => {
    expect(
      applyPassiveLoadingPolicy({
        loading: true,
        hasLoaded: false,
        isPaused: true,
        isManualRefreshActive: false,
      })
    ).toEqual({
      loading: false,
      hasLoaded: false,
      suppressPassiveLoading: true,
    });
  });

  it('preserves loading when a manual refresh is active', () => {
    expect(
      applyPassiveLoadingPolicy({
        loading: true,
        hasLoaded: false,
        isPaused: true,
        isManualRefreshActive: true,
      })
    ).toEqual({
      loading: true,
      hasLoaded: false,
      suppressPassiveLoading: false,
    });
  });
});
