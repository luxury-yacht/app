/**
 * frontend/src/modules/object-panel/components/ObjectPanel/Shell/ShellTab.test.tsx
 *
 * Test suite for ShellTab.
 * Covers key behaviors and edge cases for ShellTab.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import ShellTab from './ShellTab';
import { DockablePanelProvider } from '@components/dockable/DockablePanelProvider';

const wailsMocks = vi.hoisted(() => ({
  StartShellSession: vi.fn(),
  SendShellInput: vi.fn(),
  ResizeShellSession: vi.fn(),
  CloseShellSession: vi.fn(),
}));

const terminalMocks = vi.hoisted(() => {
  class TerminalInstance {
    cols = 120;
    rows = 40;
    loadAddon = vi.fn();
    open = vi.fn();
    focus = vi.fn();
    dispose = vi.fn();
    reset = vi.fn();
    write = vi.fn();
    writeln = vi.fn();
    paste = vi.fn();
    hasSelection = vi.fn(() => false);
    getSelection = vi.fn(() => '');
    private disposeData = vi.fn();
    private dataHandler: ((data: string) => void) | null = null;
    private keyHandler: ((event: KeyboardEvent) => boolean) | null = null;
    onData = vi.fn((handler: (data: string) => void) => {
      this.dataHandler = handler;
      return { dispose: this.disposeData };
    });
    attachCustomKeyEventHandler = vi.fn((handler: (event: KeyboardEvent) => boolean) => {
      this.keyHandler = handler;
    });
    triggerKey = (event: KeyboardEvent) => this.keyHandler?.(event);
    triggerData = (data: string) => {
      this.dataHandler?.(data);
    };
  }

  const instances: TerminalInstance[] = [];

  const TerminalMock = vi.fn(function TerminalConstructor() {
    const instance = new TerminalInstance();
    instances.push(instance);
    return instance;
  });

  return { TerminalMock, instances };
});

const fitAddonMocks = vi.hoisted(() => {
  class FitAddonInstance {
    fit = vi.fn();
  }
  const FitAddon = vi.fn(function FitAddonConstructor() {
    return new FitAddonInstance();
  });
  return { FitAddon };
});

const clipboardAddonMocks = vi.hoisted(() => {
  const instances: Array<{ dispose: () => void }> = [];
  const ClipboardAddon = vi.fn(function ClipboardAddonConstructor() {
    const instance = { dispose: vi.fn() };
    instances.push(instance);
    return instance;
  });
  return { ClipboardAddon, instances };
});

const eventRegistry = vi.hoisted(() => ({
  handlers: {} as Record<string, (payload: unknown) => void>,
}));

vi.mock('@wailsjs/go/backend/App', () => wailsMocks);

vi.mock('@wailsjs/runtime/runtime', () => ({
  EventsOn: (name: string, handler: (payload: unknown) => void) => {
    eventRegistry.handlers[name] = handler;
    return () => {
      if (eventRegistry.handlers[name] === handler) {
        delete eventRegistry.handlers[name];
      }
    };
  },
}));

vi.mock('@xterm/xterm', () => ({
  Terminal: terminalMocks.TerminalMock,
}));

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: fitAddonMocks.FitAddon,
}));

vi.mock('@xterm/addon-clipboard', () => ({
  ClipboardAddon: clipboardAddonMocks.ClipboardAddon,
}));

vi.mock('@shared/components/dropdowns/Dropdown', () => ({
  Dropdown: ({
    value = '',
    onChange,
    options = [],
  }: {
    value?: string;
    onChange?: (value: string) => void;
    options?: Array<{ value: string; label: string }>;
  }) => (
    <select value={value} onChange={(event) => onChange?.(event.target.value)}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

const flushAsync = () => act(() => Promise.resolve());
const getLatestTerminal = () =>
  terminalMocks.instances.length > 0
    ? terminalMocks.instances[terminalMocks.instances.length - 1]
    : undefined;
const emitEvent = (name: string, payload: unknown) =>
  act(() => {
    eventRegistry.handlers[name]?.(payload);
  });

describe('ShellTab', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(eventRegistry.handlers).forEach((key) => delete eventRegistry.handlers[key]);
    terminalMocks.instances.length = 0;
    clipboardAddonMocks.instances.length = 0;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    class TestResizeObserver {
      callback: ResizeObserverCallback;
      observe = vi.fn();
      disconnect = vi.fn();
      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }
    }
    (globalThis as any).ResizeObserver = TestResizeObserver;
    const clipboardMock = {
      readText: vi.fn().mockResolvedValue(''),
      writeText: vi.fn().mockResolvedValue(undefined),
    };
    if (!navigator.clipboard) {
      (navigator as any).clipboard = clipboardMock;
    } else {
      Object.assign(navigator.clipboard, clipboardMock);
    }
    wailsMocks.StartShellSession.mockResolvedValue({
      sessionId: 'sess-1',
      namespace: 'team-a',
      podName: 'pod-1',
      container: 'app',
      command: ['/bin/sh'],
      containers: ['app'],
    });
    wailsMocks.SendShellInput.mockResolvedValue(undefined);
    wailsMocks.ResizeShellSession.mockResolvedValue(undefined);
    wailsMocks.CloseShellSession.mockResolvedValue(undefined);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const clickConnectButton = () => {
    const button = container.querySelector<HTMLButtonElement>('.shell-tab__button');
    expect(button).toBeTruthy();
    act(() => {
      button?.click();
    });
  };

  const renderShellTab = async (props?: Partial<React.ComponentProps<typeof ShellTab>>) => {
    const finalProps: React.ComponentProps<typeof ShellTab> = {
      namespace: 'team-a',
      resourceName: 'pod-1',
      availableContainers: [],
      isActive: true,
      disabledReason: undefined,
      clusterId: 'alpha:ctx',
      ...props,
    };
    await act(async () => {
      root.render(
        <DockablePanelProvider>
          <ShellTab {...finalProps} />
        </DockablePanelProvider>
      );
    });
    await flushAsync();
    return finalProps;
  };

  it('starts a shell session and streams events to the terminal', async () => {
    await renderShellTab();

    expect(wailsMocks.StartShellSession).not.toHaveBeenCalled();

    clickConnectButton();

    expect(wailsMocks.StartShellSession).toHaveBeenCalledWith('alpha:ctx', {
      namespace: 'team-a',
      podName: 'pod-1',
      container: undefined,
      command: ['/bin/sh'],
    });

    const terminal = getLatestTerminal();
    expect(terminal).toBeTruthy();
    expect(terminal?.writeln).toHaveBeenCalledWith(expect.stringContaining('Connecting'));
    expect(clipboardAddonMocks.ClipboardAddon).toHaveBeenCalled();
    expect(terminal?.loadAddon).toHaveBeenCalledWith(clipboardAddonMocks.instances[0]);

    emitEvent('object-shell:status', { sessionId: 'sess-1', status: 'open' });
    await flushAsync();

    expect(terminal?.writeln).toHaveBeenCalledWith(expect.stringContaining('Connected'));

    emitEvent('object-shell:output', { sessionId: 'sess-1', stream: 'stdout', data: 'hello' });
    expect(terminal?.write).toHaveBeenCalledWith('hello');
  });

  it('copies selection on mod+c when the terminal has a selection', async () => {
    await renderShellTab();
    clickConnectButton();

    const terminal = getLatestTerminal();
    expect(terminal?.attachCustomKeyEventHandler).toHaveBeenCalled();

    terminal?.hasSelection.mockReturnValue(true);
    terminal?.getSelection.mockReturnValue('kubectl get pods');

    const event = {
      type: 'keydown',
      key: 'c',
      ctrlKey: true,
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;

    const handled = terminal?.triggerKey?.(event);

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('kubectl get pods');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(handled).toBe(false);
  });

  it('pastes clipboard contents on mod+v', async () => {
    await renderShellTab();
    clickConnectButton();

    const terminal = getLatestTerminal();
    (navigator.clipboard.readText as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
      'echo hello\n'
    );

    const event = {
      type: 'keydown',
      key: 'v',
      ctrlKey: true,
      metaKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent;

    const handled = terminal?.triggerKey?.(event);
    await flushAsync();

    expect(navigator.clipboard.readText).toHaveBeenCalled();
    expect(terminal?.paste).toHaveBeenCalledWith('echo hello\n');
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(handled).toBe(false);
  });

  it('sends stdin data to the backend when the session is open', async () => {
    await renderShellTab();
    clickConnectButton();
    emitEvent('object-shell:status', { sessionId: 'sess-1', status: 'open' });
    await flushAsync();

    const terminal = getLatestTerminal();
    terminal?.triggerData?.('ls\n');
    await flushAsync();

    expect(wailsMocks.SendShellInput).toHaveBeenCalledWith('sess-1', 'ls\n');
  });

  it('closes the shell session when the component unmounts', async () => {
    await renderShellTab();
    clickConnectButton();
    await flushAsync();

    act(() => {
      root.unmount();
    });

    expect(wailsMocks.CloseShellSession).toHaveBeenCalledWith('sess-1');
  });
});
