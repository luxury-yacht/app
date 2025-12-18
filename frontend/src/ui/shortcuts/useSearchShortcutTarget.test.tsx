import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

import { useSearchShortcutTarget } from './useSearchShortcutTarget';

const registryMocks = vi.hoisted(() => ({
  register: vi.fn(),
  unregister: vi.fn(),
}));

vi.mock('./searchShortcutRegistry', () => ({
  registerSearchShortcutTarget: (...args: unknown[]) => registryMocks.register(...args),
  unregisterSearchShortcutTarget: (...args: unknown[]) => registryMocks.unregister(...args),
}));

type HookProps = {
  isActive: boolean;
  focus: () => void;
  priority?: number;
  label?: string;
};

const renderHookHarness = () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  const Harness: React.FC<HookProps> = (props) => {
    useSearchShortcutTarget(props);
    return null;
  };

  const render = async (props: HookProps) => {
    await act(async () => {
      root.render(<Harness {...props} />);
      await Promise.resolve();
    });
  };

  const cleanup = async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  };

  return {
    render,
    cleanup,
    root,
  };
};

describe('useSearchShortcutTarget', () => {
  let harness: ReturnType<typeof renderHookHarness> | null = null;

  beforeEach(() => {
    registryMocks.register.mockReset();
    registryMocks.unregister.mockReset();
  });

  afterEach(async () => {
    if (harness) {
      await harness.cleanup();
      harness = null;
    }
  });

  it('registers search target and updates focus/isActive state', async () => {
    const focusSpy = vi.fn();
    harness = renderHookHarness();

    await harness!.render({
      isActive: true,
      focus: focusSpy,
      priority: 5,
      label: 'Filters search',
    });

    expect(registryMocks.register).toHaveBeenCalledTimes(1);
    const config = registryMocks.register.mock.calls[0][0] as {
      isActive: () => boolean;
      focus: () => void;
      getPriority: () => number;
    };
    expect(config.isActive()).toBe(true);
    expect(config.getPriority()).toBe(5);

    await harness!.render({
      isActive: false,
      focus: focusSpy,
      priority: 10,
    });
    expect(config.isActive()).toBe(false);
    expect(config.getPriority()).toBe(10);

    act(() => {
      config.focus();
    });
    expect(focusSpy).toHaveBeenCalledTimes(1);

    await harness!.cleanup();
    harness = null;
    expect(registryMocks.unregister).toHaveBeenCalled();
  });

  it('does not throw when focus function changes', async () => {
    const focusA = vi.fn();
    const focusB = vi.fn();
    harness = renderHookHarness();

    await harness!.render({ isActive: true, focus: focusA });
    const config = registryMocks.register.mock.calls[0][0] as { focus: () => void };
    act(() => config.focus());
    expect(focusA).toHaveBeenCalledTimes(1);

    await harness!.render({ isActive: true, focus: focusB });
    act(() => config.focus());
    expect(focusB).toHaveBeenCalledTimes(1);
  });
});
