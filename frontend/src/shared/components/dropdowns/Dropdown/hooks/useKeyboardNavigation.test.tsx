import React, { useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useKeyboardNavigation } from './useKeyboardNavigation';
import type { DropdownOption } from '../types';

type HookConfig = Parameters<typeof useKeyboardNavigation>[0];

const buildOptions = (): DropdownOption[] => [
  { value: 'header', label: 'Group', group: 'header' },
  { value: 'first', label: 'First' },
  { value: 'disabled', label: 'Disabled', disabled: true },
  { value: 'second', label: 'Second' },
];

describe('useKeyboardNavigation', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    vi.useRealTimers();
  });

  const renderHook = async (
    config: HookConfig
  ): Promise<{
    getKeyDownHandler: () => ReturnType<typeof useKeyboardNavigation>['handleKeyDown'];
    getActionHandler: () => ReturnType<typeof useKeyboardNavigation>['handleKeyAction'];
    rerender: (next: HookConfig) => Promise<void>;
  }> => {
    const keyDownRef: {
      current: ReturnType<typeof useKeyboardNavigation>['handleKeyDown'] | null;
    } = { current: null };
    const actionRef: {
      current: ReturnType<typeof useKeyboardNavigation>['handleKeyAction'] | null;
    } = { current: null };

    const Harness: React.FC<{ hookConfig: HookConfig }> = ({ hookConfig }) => {
      const result = useKeyboardNavigation(hookConfig);
      useEffect(() => {
        keyDownRef.current = result.handleKeyDown;
        actionRef.current = result.handleKeyAction;
      }, [result.handleKeyAction, result.handleKeyDown]);
      return null;
    };

    const mount = async (hookConfig: HookConfig) => {
      await act(async () => {
        root.render(<Harness hookConfig={hookConfig} />);
        await Promise.resolve();
      });
    };

    await mount(config);

    return {
      getKeyDownHandler: () => {
        if (!keyDownRef.current) {
          throw new Error('Hook handler not initialised');
        }
        return keyDownRef.current;
      },
      getActionHandler: () => {
        if (!actionRef.current) {
          throw new Error('Hook handler not initialised');
        }
        return actionRef.current;
      },
      rerender: async (next) => {
        await mount(next);
      },
    };
  };

  const createEvent = (key: string) => {
    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const event = {
      key,
      preventDefault,
      stopPropagation,
    } as unknown as React.KeyboardEvent<HTMLDivElement>;
    return { event, preventDefault, stopPropagation };
  };

  const buildConfig = (overrides: Partial<HookConfig> = {}): HookConfig => {
    const options = overrides.options ?? buildOptions();
    return {
      options,
      isOpen: false,
      highlightedIndex: -1,
      setHighlightedIndex: vi.fn(),
      selectOption: vi.fn(),
      openDropdown: vi.fn(),
      closeDropdown: vi.fn(),
      disabled: false,
      ...overrides,
    };
  };

  it('opens the dropdown on Enter when closed and selects highlighted option when open', async () => {
    const config = buildConfig();
    const { getKeyDownHandler, rerender } = await renderHook(config);
    const handler = getKeyDownHandler();

    const { event: enterEvent, preventDefault: enterPrevent } = createEvent('Enter');
    handler(enterEvent);
    expect(config.openDropdown).toHaveBeenCalled();
    expect(enterPrevent).toHaveBeenCalled();

    const openConfig = buildConfig({
      ...config,
      isOpen: true,
      highlightedIndex: 1,
    });
    await rerender(openConfig);
    const openHandler = getKeyDownHandler();
    const { event: selectEvent, preventDefault: selectPrevent } = createEvent('Enter');
    openHandler(selectEvent);
    expect(openConfig.selectOption).toHaveBeenCalledWith('first');
    expect(selectPrevent).toHaveBeenCalled();
  });

  it('ignores selection shortcuts when highlighted option is disabled', async () => {
    const config = buildConfig({
      isOpen: true,
      highlightedIndex: 2,
    });
    const { getKeyDownHandler } = await renderHook(config);
    const handler = getKeyDownHandler();
    const { event, preventDefault } = createEvent(' ');
    handler(event);
    expect(config.selectOption).not.toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalled();
  });

  it('closes on Escape and respects Tab without preventing default', async () => {
    const config = buildConfig({ isOpen: true });
    const { getKeyDownHandler } = await renderHook(config);
    const handler = getKeyDownHandler();

    const { event: escapeEvent, preventDefault: escapePrevent } = createEvent('Escape');
    handler(escapeEvent);
    expect(config.closeDropdown).toHaveBeenCalled();
    expect(escapePrevent).toHaveBeenCalled();

    const { event: tabEvent, preventDefault: tabPrevent } = createEvent('Tab');
    handler(tabEvent);
    expect(tabPrevent).not.toHaveBeenCalled();
    expect(config.closeDropdown).toHaveBeenCalledTimes(2);
  });

  it('navigates with Arrow keys, wrapping around enabled options', async () => {
    const options = buildOptions();
    const setHighlightedIndex = vi.fn();
    const config = buildConfig({
      isOpen: true,
      highlightedIndex: 3,
      setHighlightedIndex,
      options,
    });
    const { getKeyDownHandler, rerender } = await renderHook(config);
    let handler = getKeyDownHandler();

    const { event: downEvent, preventDefault: downPrevent } = createEvent('ArrowDown');
    handler(downEvent);
    expect(setHighlightedIndex).toHaveBeenCalledWith(1); // wraps to first selectable
    expect(downPrevent).toHaveBeenCalled();

    const upConfig = {
      ...config,
      highlightedIndex: 0,
    };
    await rerender(upConfig);
    handler = getKeyDownHandler();
    const { event: upEvent, preventDefault: upPrevent } = createEvent('ArrowUp');
    handler(upEvent);
    expect(setHighlightedIndex).toHaveBeenCalledWith(3);
    expect(upPrevent).toHaveBeenCalled();
  });

  it('opens dropdown with ArrowDown when closed', async () => {
    const config = buildConfig({ isOpen: false });
    const { getKeyDownHandler } = await renderHook(config);
    const handler = getKeyDownHandler();
    const { event, preventDefault } = createEvent('ArrowDown');
    handler(event);
    expect(config.openDropdown).toHaveBeenCalled();
    expect(preventDefault).toHaveBeenCalled();
  });

  it('moves to first and last enabled options with Home and End', async () => {
    const options = buildOptions();
    const setHighlightedIndex = vi.fn();
    const config = buildConfig({
      isOpen: true,
      highlightedIndex: 2,
      setHighlightedIndex,
      options,
    });
    const { getKeyDownHandler } = await renderHook(config);
    const handler = getKeyDownHandler();

    const { event: homeEvent, preventDefault: homePrevent } = createEvent('Home');
    handler(homeEvent);
    expect(setHighlightedIndex).toHaveBeenCalledWith(1);
    expect(homePrevent).toHaveBeenCalled();

    const { event: endEvent, preventDefault: endPrevent } = createEvent('End');
    handler(endEvent);
    expect(setHighlightedIndex).toHaveBeenCalledWith(3);
    expect(endPrevent).toHaveBeenCalled();
  });

  it('does nothing when disabled', async () => {
    const config = buildConfig({
      isOpen: true,
      disabled: true,
    });
    const { getKeyDownHandler } = await renderHook(config);
    const handler = getKeyDownHandler();
    const { event, preventDefault } = createEvent('ArrowDown');
    handler(event);
    expect(config.openDropdown).not.toHaveBeenCalled();
    expect(config.setHighlightedIndex).not.toHaveBeenCalled();
    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('exposes handleKeyAction for shortcut integrations', async () => {
    const setHighlightedIndex = vi.fn();
    const config = buildConfig({
      isOpen: true,
      highlightedIndex: 1,
      setHighlightedIndex,
    });

    const { getActionHandler } = await renderHook(config);
    const handleAction = getActionHandler();

    expect(handleAction('ArrowDown')).toBe('handled');
    expect(setHighlightedIndex).toHaveBeenCalledWith(3);

    expect(handleAction('Escape')).toBe('handled');
    expect(config.closeDropdown).toHaveBeenCalled();

    expect(handleAction('Tab')).toBe('handled-no-prevent');
    expect(config.closeDropdown).toHaveBeenCalledTimes(2);
  });
});
