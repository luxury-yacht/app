import React, { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus } from '@/core/events';
import { useAutoRefresh } from './useAutoRefresh';

const mocks = vi.hoisted(() => ({
  enabled: true,
  setEnabled: vi.fn(),
}));

vi.mock('@/core/settings/appPreferences', () => ({
  getAutoRefreshEnabled: () => mocks.enabled,
  setAutoRefreshEnabled: (...args: unknown[]) => mocks.setEnabled(...args),
}));

describe('useAutoRefresh', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let hookResult!: ReturnType<typeof useAutoRefresh>;

  function Harness() {
    hookResult = useAutoRefresh();
    return null;
  }

  beforeEach(() => {
    mocks.enabled = true;
    mocks.setEnabled.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('follows the preference and persists explicit and toggled changes', () => {
    act(() => root.render(React.createElement(Harness)));
    expect(hookResult.enabled).toBe(true);

    act(() => {
      mocks.enabled = false;
      eventBus.emit('settings:auto-refresh', false);
    });
    expect(hookResult.enabled).toBe(false);

    act(() => hookResult.toggle());
    expect(mocks.setEnabled).toHaveBeenLastCalledWith(true);

    act(() => hookResult.setAutoRefresh(false));
    expect(mocks.setEnabled).toHaveBeenLastCalledWith(false);
  });
});
