import { act, createRef } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardProvider, useKeyboardContext } from '@/ui/shortcuts/context';
import { useLogKeyboardShortcuts } from './useLogKeyboardShortcuts';

describe('container log shortcut help', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let getAvailable: ReturnType<typeof useKeyboardContext>['getAvailableShortcuts'];
  const dispatch = vi.fn();
  const copy = vi.fn();
  const previousLogs = vi.fn();
  const scrollTo = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = async (isActive = true, isParsedView = false) => {
    const filterInputRef = createRef<HTMLInputElement>();
    const logsContentRef = createRef<HTMLDivElement>();
    const Harness = () => {
      getAvailable = useKeyboardContext().getAvailableShortcuts;
      useLogKeyboardShortcuts({
        isActive,
        isParsedView,
        displayMode: 'raw',
        showTimestamps: false,
        regexMatches: false,
        hasAnsiLogEntries: true,
        hasCopyableContent: true,
        supportsPreviousContainerLogs: true,
        canParseContainerLogs: true,
        dispatch,
        handleTogglePreviousContainerLogs: previousLogs,
        handleCopyContainerLogs: copy,
        filterInputRef,
        logsContentRef,
      });
      return (
        <>
          <input ref={filterInputRef} aria-label="Filter logs" />
          <div ref={logsContentRef}>
            <div className="gridtable-wrapper" />
          </div>
        </>
      );
    };
    await act(async () => {
      root.render(
        <KeyboardProvider>
          <Harness />
        </KeyboardProvider>
      );
    });
    const scrollContainer = isParsedView
      ? container.querySelector<HTMLElement>('.gridtable-wrapper')
      : logsContentRef.current;
    if (scrollContainer) {
      scrollContainer.scrollTo = scrollTo;
      Object.defineProperty(scrollContainer, 'scrollHeight', { value: 500 });
    }
  };

  const press = (key: string, shiftKey = false) => {
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true }));
    });
  };

  it('groups log actions in task order and preserves their key bindings', async () => {
    await render();
    const logs = getAvailable().find(({ category }) => category === 'Logs');
    expect(logs?.shortcuts.map(({ key, description }) => [key, description])).toEqual([
      ['r', 'Toggle auto-refresh'],
      ['Home', 'Scroll container logs to top'],
      ['End', 'Scroll container logs to bottom'],
      ['t', 'Toggle API timestamps'],
      ['v', 'Toggle previous logs'],
      ['h', 'Toggle match highlighting'],
      ['i', 'Toggle inverse filtering'],
      ['x', 'Toggle regex filtering'],
      ['c', 'Toggle case-sensitive matching'],
      ['p', 'Toggle Parse/Raw mode'],
      ['j', 'Toggle pretty JSON'],
      ['o', 'Toggle ANSI colors'],
      ['w', 'Toggle text wrap'],
      ['c', 'Copy container logs to clipboard'],
    ]);

    for (const key of ['r', 't', 'v', 'h', 'i', 'x', 'c', 'p', 'j', 'o', 'w', 'Home', 'End']) {
      press(key);
    }
    press('c', true);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([
      { type: 'TOGGLE_AUTO_REFRESH' },
      { type: 'SET_TIMESTAMP_MODE', payload: 'default' },
      { type: 'TOGGLE_HIGHLIGHT_MATCHES' },
      { type: 'TOGGLE_INVERSE_MATCHES' },
      { type: 'TOGGLE_REGEX_MATCHES' },
      { type: 'TOGGLE_CASE_SENSITIVE_MATCHES' },
      { type: 'TOGGLE_PARSED_VIEW' },
      { type: 'SET_DISPLAY_MODE', payload: 'pretty' },
      { type: 'TOGGLE_SHOW_ANSI_COLORS' },
      { type: 'TOGGLE_WRAP_TEXT' },
    ]);
    expect(previousLogs).toHaveBeenCalledOnce();
    expect(copy).toHaveBeenCalledOnce();
    expect(scrollTo.mock.calls).toEqual([
      [{ top: 0, behavior: 'auto' }],
      [{ top: 500, behavior: 'auto' }],
    ]);
  });

  it('scrolls the parsed list and omits the log section when inactive', async () => {
    await render(true, true);
    press('Home');
    press('End');
    expect(scrollTo.mock.calls).toEqual([
      [{ top: 0, behavior: 'auto' }],
      [{ top: 500, behavior: 'auto' }],
    ]);

    await render(false);
    expect(getAvailable().some(({ category }) => category === 'Logs')).toBe(false);
    press('r');
    press('c', true);
    expect(dispatch).not.toHaveBeenCalled();
    expect(copy).not.toHaveBeenCalled();
  });
});
