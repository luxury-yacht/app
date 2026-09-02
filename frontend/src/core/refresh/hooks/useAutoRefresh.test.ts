import React, { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events';
import { initializeAutoRefresh, useAutoRefresh } from './useAutoRefresh';

const mocks = vi.hoisted(() => ({
  enabled: true,
  pause: vi.fn(),
  resume: vi.fn(),
  setEnabled: vi.fn(),
}));

vi.mock('@/core/settings/appPreferences', () => ({
  getAutoRefreshEnabled: () => mocks.enabled,
  setAutoRefreshEnabled: (...args: unknown[]) => mocks.setEnabled(...args),
}));

vi.mock('../RefreshManager', () => ({
  refreshManager: {
    pause: (...args: unknown[]) => mocks.pause(...args),
    resume: (...args: unknown[]) => mocks.resume(...args),
  },
}));

describe('initializeAutoRefresh', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

  it('keeps refresh paused in a hidden window even when the preference is enabled', () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);

    initializeAutoRefresh();

    expect(mocks.pause).toHaveBeenCalledOnce();
    expect(mocks.resume).not.toHaveBeenCalled();
  });
});

describe('useAutoRefresh', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let hookResult!: ReturnType<typeof useAutoRefresh>;

  function Harness() {
    hookResult = useAutoRefresh();
    return null;
  }

  beforeEach(() => {
    vi.restoreAllMocks();
    mocks.enabled = true;
    mocks.pause.mockReset();
    mocks.resume.mockReset();
    mocks.setEnabled.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('synchronizes runtime state and persists explicit and toggled changes', () => {
    act(() => root.render(React.createElement(Harness)));
    expect(mocks.resume).toHaveBeenCalledOnce();

    act(() => eventBus.emit('settings:auto-refresh', false));
    expect(hookResult.enabled).toBe(false);
    expect(mocks.pause).toHaveBeenCalledOnce();

    act(() => hookResult.toggle());
    expect(mocks.setEnabled).toHaveBeenLastCalledWith(true);

    act(() => hookResult.setAutoRefresh(false));
    expect(mocks.setEnabled).toHaveBeenLastCalledWith(false);
  });
});
