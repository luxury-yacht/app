import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initializeAutoRefresh } from './useAutoRefresh';

const mocks = vi.hoisted(() => ({
  enabled: true,
  pause: vi.fn(),
  resume: vi.fn(),
}));

vi.mock('@/core/settings/appPreferences', () => ({
  getAutoRefreshEnabled: () => mocks.enabled,
  setAutoRefreshEnabled: vi.fn(),
}));

vi.mock('../RefreshManager', () => ({
  refreshManager: {
    pause: (...args: unknown[]) => mocks.pause(...args),
    resume: (...args: unknown[]) => mocks.resume(...args),
  },
}));

describe('initializeAutoRefresh', () => {
  beforeEach(() => {
    mocks.enabled = true;
    mocks.pause.mockReset();
    mocks.resume.mockReset();
  });

  it('resumes refresh when the hydrated preference is enabled', () => {
    initializeAutoRefresh();

    expect(mocks.resume).toHaveBeenCalledOnce();
    expect(mocks.pause).not.toHaveBeenCalled();
  });

  it('pauses refresh when the hydrated preference is disabled', () => {
    mocks.enabled = false;

    initializeAutoRefresh();

    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(mocks.resume).not.toHaveBeenCalled();
  });
});
