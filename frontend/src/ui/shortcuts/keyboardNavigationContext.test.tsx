import React, { act, useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  KeyboardNavigationProvider,
  useKeyboardNavigationContext,
  useKeyboardNavigationScope,
} from './keyboardNavigationContext';

type NavigationContext = ReturnType<typeof useKeyboardNavigationContext>;

const ContextProbe: React.FC<{ onReady: (ctx: NavigationContext) => void }> = ({ onReady }) => {
  const ctx = useKeyboardNavigationContext();
  useEffect(() => {
    onReady(ctx);
  }, [ctx, onReady]);
  return null;
};

interface ScopeProps {
  id: string;
  priority?: number;
  allowNativeSelector?: string;
  onNavigate?: Parameters<typeof useKeyboardNavigationScope>[0]['onNavigate'];
  onEnter?: Parameters<typeof useKeyboardNavigationScope>[0]['onEnter'];
  disabled?: boolean;
}

const ScopeHarness: React.FC<ScopeProps> = ({
  id,
  priority,
  allowNativeSelector,
  onNavigate,
  onEnter,
  disabled,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  useKeyboardNavigationScope({
    ref,
    priority,
    allowNativeSelector,
    onNavigate,
    onEnter,
    disabled,
  });
  return (
    <div ref={ref} data-testid={id}>
      <button data-allow-native="true">native opt-in</button>
      <button data-tab-native="true">force native</button>
      <button data-final="true">dynamic</button>
    </div>
  );
};

const createTabEvent = (target: Element, shiftKey = false): KeyboardEvent => {
  const event = {
    key: 'Tab',
    shiftKey,
    target,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  } as unknown as KeyboardEvent;
  return event;
};

describe('keyboardNavigationContext', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

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
  });

  const renderWithProvider = (
    ui: React.ReactNode,
    onReady: (ctx: NavigationContext) => void
  ): void => {
    act(() => {
      root.render(
        <KeyboardNavigationProvider>
          <ContextProbe onReady={onReady} />
          {ui}
        </KeyboardNavigationProvider>
      );
    });
  };

  it('lets scopes consume Tab events and prevent browser focus changes', () => {
    const onNavigate = vi.fn().mockReturnValue('handled' as const);
    let api: NavigationContext | null = null;

    renderWithProvider(<ScopeHarness id="primary" onNavigate={onNavigate} />, (ctx) => (api = ctx));

    const scope = container.querySelector('[data-testid="primary"]') as HTMLElement;
    const event = createTabEvent(scope);

    const handled = api!.handleKeyEvent(event);

    expect(handled).toBe(true);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
  });

  it('falls back to the next scope when handlers bubble', () => {
    const onNavigate = vi.fn().mockReturnValue('bubble' as const);
    const onEnter = vi.fn();
    let api: NavigationContext | null = null;

    renderWithProvider(
      <>
        <ScopeHarness id="primary" priority={10} onNavigate={onNavigate} />
        <ScopeHarness id="secondary" priority={5} onEnter={onEnter} />
      </>,
      (ctx) => (api = ctx)
    );

    const scope = container.querySelector('[data-testid="primary"]') as HTMLElement;
    const event = createTabEvent(scope);

    const handled = api!.handleKeyEvent(event);

    expect(handled).toBe(true);
    expect(onEnter).toHaveBeenCalledWith({ direction: 'forward', event });
  });

  it('lets scopes return native to preserve browser behavior', () => {
    const onNavigate = vi.fn().mockReturnValue('native' as const);
    let api: NavigationContext | null = null;

    renderWithProvider(<ScopeHarness id="native" onNavigate={onNavigate} />, (ctx) => (api = ctx));

    const scope = container.querySelector('[data-testid="native"]') as HTMLElement;
    const event = createTabEvent(scope);

    const handled = api!.handleKeyEvent(event);

    expect(handled).toBe(false);
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('skips handling when allowNativeSelector matches the target', () => {
    const onNavigate = vi.fn();
    let api: NavigationContext | null = null;

    renderWithProvider(
      <ScopeHarness id="native-selector" allowNativeSelector='[data-allow-native="true"]' />,
      (ctx) => (api = ctx)
    );

    const target = container.querySelector('[data-allow-native="true"]') as HTMLElement;
    const event = createTabEvent(target);

    const handled = api!.handleKeyEvent(event);

    expect(handled).toBe(false);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('honors data-tab-native opt-outs', () => {
    const onNavigate = vi.fn();
    let api: NavigationContext | null = null;

    renderWithProvider(<ScopeHarness id="native-attr" onNavigate={onNavigate} />, (ctx) => {
      api = ctx;
    });

    const target = container.querySelector('[data-tab-native="true"]') as HTMLElement;
    const event = createTabEvent(target);

    const handled = api!.handleKeyEvent(event);

    expect(handled).toBe(false);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it('skips disabled scopes and focuses the next available scope', () => {
    const onEnter = vi.fn();
    let api: NavigationContext | null = null;

    renderWithProvider(
      <>
        <ScopeHarness id="disabled" disabled />
        <ScopeHarness id="active" onEnter={onEnter} />
      </>,
      (ctx) => (api = ctx)
    );

    const disabledTarget = container.querySelector('[data-testid="disabled"]') as HTMLElement;
    const event = createTabEvent(disabledTarget);

    const handled = api!.handleKeyEvent(event);

    expect(handled).toBe(true);
    expect(onEnter).toHaveBeenCalledWith({ direction: 'forward', event });
  });

  it('updates scope configuration when props change', async () => {
    const DynamicScope: React.FC = () => {
      const [selector, setSelector] = useState('[data-old]');
      const ref = useRef<HTMLDivElement>(null);
      useKeyboardNavigationScope({ ref, allowNativeSelector: selector });

      useEffect(() => {
        setSelector('[data-final="true"]');
      }, []);

      return (
        <div ref={ref} data-testid="dynamic">
          <button data-final="true">final</button>
        </div>
      );
    };

    let api: NavigationContext | null = null;

    renderWithProvider(<DynamicScope />, (ctx) => (api = ctx));

    // Wait for the internal effect to update the selector.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const target = container.querySelector('[data-final="true"]') as HTMLElement;
    const event = createTabEvent(target);

    const handled = api!.handleKeyEvent(event);

    expect(handled).toBe(false);
  });

  it('wraps focus to the first scope when advancing past the last scope', () => {
    const firstEnter = vi.fn();
    const secondEnter = vi.fn();
    let api: NavigationContext | null = null;

    renderWithProvider(
      <>
        <ScopeHarness id="sidebar" priority={20} onEnter={firstEnter} />
        <ScopeHarness id="table" priority={10} onEnter={secondEnter} />
      </>,
      (ctx) => (api = ctx)
    );

    const lastScope = container.querySelector('[data-testid="table"]') as HTMLElement;
    const event = createTabEvent(lastScope);

    const handled = api!.handleKeyEvent(event);

    expect(handled).toBe(true);
    expect(firstEnter).toHaveBeenCalledWith({ direction: 'forward', event });
  });

  it('wraps focus to the last scope when moving backward before the first scope', () => {
    const firstEnter = vi.fn();
    const lastEnter = vi.fn();
    let api: NavigationContext | null = null;

    renderWithProvider(
      <>
        <ScopeHarness id="sidebar" priority={20} onEnter={firstEnter} />
        <ScopeHarness id="kubeconfig" priority={5} onEnter={lastEnter} />
      </>,
      (ctx) => (api = ctx)
    );

    const firstScope = container.querySelector('[data-testid="sidebar"]') as HTMLElement;
    const event = createTabEvent(firstScope, true);

    const handled = api!.handleKeyEvent(event);

    expect(handled).toBe(true);
    expect(lastEnter).toHaveBeenCalledWith({ direction: 'backward', event });
  });
});
