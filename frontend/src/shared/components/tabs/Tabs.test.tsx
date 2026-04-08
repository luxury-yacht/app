/**
 * frontend/src/shared/components/tabs/Tabs.test.tsx
 */
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { Tabs } from './Tabs';

describe('Tabs', () => {
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
  });

  it('renders an empty tablist with the required aria-label', () => {
    act(() => {
      root.render(<Tabs tabs={[]} activeId={null} onActivate={() => {}} aria-label="Test Tabs" />);
    });

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist).toBeTruthy();
    expect(tablist?.getAttribute('aria-label')).toBe('Test Tabs');
    expect(tablist?.querySelectorAll('[role="tab"]').length).toBe(0);
  });

  it('renders one button per tab descriptor with the right label', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
            { id: 'c', label: 'Gamma' },
          ]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs.length).toBe(3);
    expect(tabs[0].textContent).toContain('Alpha');
    expect(tabs[1].textContent).toContain('Beta');
    expect(tabs[2].textContent).toContain('Gamma');
  });

  it('marks the active tab with aria-selected and the active modifier class', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
          ]}
          activeId="b"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].classList.contains('tab-item--active')).toBe(false);
    expect(tabs[1].classList.contains('tab-item--active')).toBe(true);
  });

  it('calls onActivate with the tab id when a tab is clicked', () => {
    const onActivate = vi.fn();
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
          ]}
          activeId="a"
          onActivate={onActivate}
          aria-label="Test Tabs"
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    act(() => {
      tabs[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate).toHaveBeenCalledWith('b');
  });

  it('does not call onActivate when a disabled tab is clicked', () => {
    const onActivate = vi.fn();
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta', disabled: true },
          ]}
          activeId="a"
          onActivate={onActivate}
          aria-label="Test Tabs"
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    act(() => {
      tabs[1].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onActivate).not.toHaveBeenCalled();
    expect(tabs[1].getAttribute('aria-disabled')).toBe('true');
  });

  it('uses a roving tabIndex so only the active tab is in the tab order', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
            { id: 'c', label: 'Gamma' },
          ]}
          activeId="b"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs[0].tabIndex).toBe(-1);
    expect(tabs[1].tabIndex).toBe(0);
    expect(tabs[2].tabIndex).toBe(-1);
  });

  it('moves focus between tabs on ArrowRight/ArrowLeft without changing the active tab', () => {
    const onActivate = vi.fn();
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
            { id: 'c', label: 'Gamma' },
          ]}
          activeId="a"
          onActivate={onActivate}
          aria-label="Test Tabs"
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[0].focus();

    act(() => {
      tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(document.activeElement).toBe(tabs[1]);
    expect(onActivate).not.toHaveBeenCalled();

    act(() => {
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
      );
    });
    expect(document.activeElement).toBe(tabs[2]);

    act(() => {
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
      );
    });
    // Wraps around to the first tab.
    expect(document.activeElement).toBe(tabs[0]);

    act(() => {
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })
      );
    });
    // Wraps around backwards to the last tab.
    expect(document.activeElement).toBe(tabs[2]);

    expect(onActivate).not.toHaveBeenCalled();
  });

  it('jumps focus to the first tab on Home and the last tab on End', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
            { id: 'c', label: 'Gamma' },
          ]}
          activeId="b"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[1].focus();

    act(() => {
      tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    });
    expect(document.activeElement).toBe(tabs[2]);

    act(() => {
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Home', bubbles: true })
      );
    });
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('skips disabled tabs during arrow navigation', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta', disabled: true },
            { id: 'c', label: 'Gamma' },
          ]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[0].focus();

    act(() => {
      tabs[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    });
    expect(document.activeElement).toBe(tabs[2]);
  });

  it('activates the focused tab on Enter', () => {
    const onActivate = vi.fn();
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
          ]}
          activeId="a"
          onActivate={onActivate}
          aria-label="Test Tabs"
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[1].focus();

    act(() => {
      tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });

    expect(onActivate).toHaveBeenCalledWith('b');
  });

  it('activates the focused tab on Space', () => {
    const onActivate = vi.fn();
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
          ]}
          activeId="a"
          onActivate={onActivate}
          aria-label="Test Tabs"
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabs[1].focus();

    act(() => {
      tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });

    expect(onActivate).toHaveBeenCalledWith('b');
  });

  it('applies per-tab ariaControls and ariaLabel overrides', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha', ariaControls: 'panel-a' },
            { id: 'b', label: <svg />, ariaLabel: 'Icon-only tab' },
          ]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs[0].getAttribute('aria-controls')).toBe('panel-a');
    expect(tabs[1].getAttribute('aria-label')).toBe('Icon-only tab');
  });

  it('adds the uppercase modifier class when textTransform="uppercase"', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[{ id: 'a', label: 'Alpha' }]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
          textTransform="uppercase"
        />
      );
    });

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist?.classList.contains('tab-strip--uppercase')).toBe(true);
  });

  it('does not add the uppercase modifier class by default', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[{ id: 'a', label: 'Alpha' }]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist?.classList.contains('tab-strip--uppercase')).toBe(false);
  });

  it('merges a consumer className onto the root and applies an id', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[{ id: 'a', label: 'Alpha' }]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
          className="custom-class"
          id="custom-id"
        />
      );
    });

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist?.classList.contains('tab-strip')).toBe(true);
    expect(tablist?.classList.contains('custom-class')).toBe(true);
    expect(tablist?.id).toBe('custom-id');
  });

  it('adds the fit sizing modifier class by default', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[{ id: 'a', label: 'Alpha' }]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist?.classList.contains('tab-strip--sizing-fit')).toBe(true);
    expect(tablist?.classList.contains('tab-strip--sizing-equal')).toBe(false);
  });

  it('adds the equal sizing modifier class when tabSizing="equal"', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[{ id: 'a', label: 'Alpha' }]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
          tabSizing="equal"
        />
      );
    });

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist?.classList.contains('tab-strip--sizing-equal')).toBe(true);
    expect(tablist?.classList.contains('tab-strip--sizing-fit')).toBe(false);
  });

  it('sets --tab-item-min-width and --tab-item-max-width custom properties from props', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[{ id: 'a', label: 'Alpha' }]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
          minTabWidth={100}
          maxTabWidth={300}
        />
      );
    });

    const tablist = container.querySelector<HTMLDivElement>('[role="tablist"]');
    expect(tablist?.style.getPropertyValue('--tab-item-min-width')).toBe('100px');
    expect(tablist?.style.getPropertyValue('--tab-item-max-width')).toBe('300px');
  });

  it('uses fit-mode defaults: min 0, max 240 when min/max not provided', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[{ id: 'a', label: 'Alpha' }]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tablist = container.querySelector<HTMLDivElement>('[role="tablist"]');
    // 'fit' mode (the default) sizes tabs to content with no floor — so
    // short labels like "YAML" don't get bloated. Closeable tabs in fit
    // mode get an 80px floor via the .tab-strip--sizing-fit
    // .tab-item--closeable rule in tabs.css (so the close button has room).
    expect(tablist?.style.getPropertyValue('--tab-item-min-width')).toBe('0px');
    expect(tablist?.style.getPropertyValue('--tab-item-max-width')).toBe('240px');
  });

  it('uses equal-mode default: min 80 when min not provided', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[{ id: 'a', label: 'Alpha' }]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
          tabSizing="equal"
        />
      );
    });

    const tablist = container.querySelector<HTMLDivElement>('[role="tablist"]');
    // 'equal' mode shares the strip width across tabs, so a floor is
    // necessary to keep tabs from collapsing below readable width.
    expect(tablist?.style.getPropertyValue('--tab-item-min-width')).toBe('80px');
    expect(tablist?.style.getPropertyValue('--tab-item-max-width')).toBe('240px');
  });

  it('renders a close button when the tab descriptor has onClose', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha', onClose },
            { id: 'b', label: 'Beta' },
          ]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    expect(tabs[0].classList.contains('tab-item--closeable')).toBe(true);
    expect(tabs[0].querySelector('.tab-item__close')).toBeTruthy();
    expect(tabs[1].classList.contains('tab-item--closeable')).toBe(false);
    expect(tabs[1].querySelector('.tab-item__close')).toBeNull();
  });

  it('invokes onClose when the close button is clicked, without invoking onActivate', () => {
    const onClose = vi.fn();
    const onActivate = vi.fn();
    act(() => {
      root.render(
        <Tabs
          tabs={[{ id: 'a', label: 'Alpha', onClose }]}
          activeId="a"
          onActivate={onActivate}
          aria-label="Test Tabs"
        />
      );
    });

    const closeButton = container.querySelector<HTMLElement>('.tab-item__close');
    expect(closeButton).toBeTruthy();
    act(() => {
      closeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('invokes onClose when Delete is pressed on a focused closeable tab', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <Tabs
          tabs={[{ id: 'a', label: 'Alpha', onClose }]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tab = container.querySelector<HTMLButtonElement>('[role="tab"]');
    tab?.focus();

    act(() => {
      tab!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('invokes onClose when Backspace is pressed on a focused closeable tab', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <Tabs
          tabs={[{ id: 'a', label: 'Alpha', onClose }]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tab = container.querySelector<HTMLButtonElement>('[role="tab"]');
    tab?.focus();

    act(() => {
      tab!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not invoke onClose on Delete when the tab is not closeable', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[{ id: 'a', label: 'Alpha' }]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tab = container.querySelector<HTMLButtonElement>('[role="tab"]');
    tab?.focus();

    // Should not throw or do anything.
    act(() => {
      tab!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    });

    // No assertion needed beyond "doesn't throw" — no onClose to call.
  });

  it('spreads extraProps onto the tab button', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[
            {
              id: 'a',
              label: 'Alpha',
              extraProps: {
                'data-testid': 'cluster-id-1',
                draggable: true,
              } as any,
            },
          ]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tab = container.querySelector<HTMLButtonElement>('[role="tab"]');
    expect(tab?.getAttribute('data-testid')).toBe('cluster-id-1');
    expect(tab?.draggable).toBe(true);
  });

  it('warns in dev mode when extraProps overrides a reserved key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    act(() => {
      root.render(
        <Tabs
          tabs={[
            {
              id: 'a',
              label: 'Alpha',
              extraProps: { tabIndex: 99 } as any,
            },
          ]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    expect(warn).toHaveBeenCalled();
    expect(warn.mock.calls.some((call) => String(call[0]).includes('tabIndex'))).toBe(true);

    // The base's reserved value still wins at the DOM level.
    const tab = container.querySelector<HTMLButtonElement>('[role="tab"]');
    expect(tab?.tabIndex).toBe(0); // active tab gets tabIndex=0 from the base

    warn.mockRestore();
  });

  it('renders the leading slot before the label', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[
            {
              id: 'a',
              label: 'Alpha',
              leading: <span data-testid="leading-a">●</span>,
            },
          ]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const button = container.querySelector<HTMLButtonElement>('[role="tab"]');
    const leading = button?.querySelector('[data-testid="leading-a"]');
    const label = button?.querySelector('.tab-item__label');
    expect(leading).toBeTruthy();
    // leading should appear before label in the DOM
    expect(
      leading!.compareDocumentPosition(label!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('renders an empty tablist without crashing when tabs array is empty', () => {
    act(() => {
      root.render(<Tabs tabs={[]} activeId={null} onActivate={() => {}} aria-label="Test Tabs" />);
    });

    const tablist = container.querySelector('[role="tablist"]');
    expect(tablist).toBeTruthy();
    expect(tablist?.querySelectorAll('[role="tab"]').length).toBe(0);
  });

  it('keeps the strip keyboard-reachable when activeId does not match any tab', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
          ]}
          activeId="nonexistent"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLElement>('[role="tab"]');
    expect(tabs.length).toBe(2);
    // No tab should be aria-selected since activeId doesn't match.
    expect(tabs[0].getAttribute('aria-selected')).toBe('false');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
    // Roving-tabindex fallback: the first non-disabled tab receives
    // tabIndex=0 so the strip remains reachable via Tab key.
    expect(tabs[0].tabIndex).toBe(0);
    expect(tabs[1].tabIndex).toBe(-1);
  });

  it('falls back to the first non-disabled tab when activeId is null', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha', disabled: true },
            { id: 'b', label: 'Beta' },
            { id: 'c', label: 'Gamma' },
          ]}
          activeId={null}
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const tabs = container.querySelectorAll<HTMLElement>('[role="tab"]');
    expect(tabs.length).toBe(3);
    // Disabled tab 'a' is skipped; 'b' is the first non-disabled, so it
    // gets the focus stop.
    expect(tabs[0].tabIndex).toBe(-1);
    expect(tabs[1].tabIndex).toBe(0);
    expect(tabs[2].tabIndex).toBe(-1);
    // None is aria-selected.
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
  });

  it('does not render scroll buttons when content fits the container', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
          ]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    expect(container.querySelector('.tab-strip__overflow-indicator')).toBeNull();
  });

  it('renders scroll buttons when overflow="scroll" and content overflows', () => {
    // Force overflow by mocking the scroll measurements.
    const observers: Array<() => void> = [];
    const OriginalResizeObserver = (globalThis as any).ResizeObserver;
    (globalThis as any).ResizeObserver = class {
      constructor(public cb: () => void) {
        observers.push(cb);
      }
      observe() {}
      disconnect() {}
    };

    act(() => {
      root.render(
        <Tabs
          tabs={Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, label: `Tab ${i}` }))}
          activeId="t0"
          onActivate={() => {}}
          aria-label="Test Tabs"
          overflow="scroll"
        />
      );
    });

    // Force scrollWidth > clientWidth on the scroll container (the tablist
    // itself — .tab-strip is the scrolling element, matching live Dockable).
    const scrollContainer = container.querySelector<HTMLDivElement>('[role="tablist"]');
    Object.defineProperty(scrollContainer, 'scrollWidth', { value: 1000, configurable: true });
    Object.defineProperty(scrollContainer, 'clientWidth', { value: 200, configurable: true });

    // Trigger the observer callback.
    act(() => {
      observers.forEach((cb) => cb());
    });

    expect(container.querySelector('.tab-strip__overflow-indicator')).toBeTruthy();

    (globalThis as any).ResizeObserver = OriginalResizeObserver;
  });

  it('does not render scroll buttons when overflow="none"', () => {
    act(() => {
      root.render(
        <Tabs
          tabs={Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, label: `Tab ${i}` }))}
          activeId="t0"
          onActivate={() => {}}
          aria-label="Test Tabs"
          overflow="none"
        />
      );
    });

    expect(container.querySelector('.tab-strip__overflow-indicator')).toBeNull();
  });

  it('scrolls the strip when an overflow indicator is clicked', () => {
    const observers: Array<() => void> = [];
    const OriginalResizeObserver = (globalThis as any).ResizeObserver;
    (globalThis as any).ResizeObserver = class {
      constructor(public cb: () => void) {
        observers.push(cb);
      }
      observe() {}
      disconnect() {}
    };

    // Spy on requestAnimationFrame so we can drive the manual scroll
    // animation synchronously from the test.
    const rafCallbacks: FrameRequestCallback[] = [];
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallbacks.push(cb);
      return rafCallbacks.length;
    });

    act(() => {
      root.render(
        <Tabs
          tabs={Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, label: `Tab ${i}` }))}
          activeId="t0"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const scrollContainer = container.querySelector<HTMLDivElement>('[role="tablist"]')!;
    Object.defineProperty(scrollContainer, 'scrollWidth', { value: 1000, configurable: true });
    Object.defineProperty(scrollContainer, 'clientWidth', { value: 200, configurable: true });
    // Make scrollLeft writable so the manual animation can set it.
    let scrollLeftValue = 0;
    Object.defineProperty(scrollContainer, 'scrollLeft', {
      get: () => scrollLeftValue,
      set: (v: number) => {
        scrollLeftValue = v;
      },
      configurable: true,
    });

    // Mock per-tab offsets so the target-finding loop has something to work with.
    const tabButtons = container.querySelectorAll<HTMLButtonElement>('[role="tab"]');
    tabButtons.forEach((btn, i) => {
      Object.defineProperty(btn, 'offsetLeft', { value: i * 100, configurable: true });
      Object.defineProperty(btn, 'offsetWidth', { value: 100, configurable: true });
    });

    act(() => observers.forEach((cb) => cb()));

    const rightButton = container.querySelector<HTMLButtonElement>(
      '.tab-strip__overflow-indicator--right'
    );
    expect(rightButton).toBeTruthy();

    act(() => {
      rightButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    // Click should have scheduled a rAF to start the manual scroll animation.
    expect(rafSpy).toHaveBeenCalled();

    // Drive the animation forward to completion by calling the rAF
    // callback with a time far beyond DURATION_MS so progress = 1.
    const firstStep = rafCallbacks[0];
    expect(firstStep).toBeDefined();
    act(() => {
      firstStep(performance.now() + 10_000);
    });

    // With 10 tabs at offsetLeft = 0, 100, 200, ... and clientWidth = 200,
    // the first tab whose right edge is hidden past the right indicator
    // (barRight - indicatorSize + 1 = 169) is tab 1 (right edge at 200).
    // The animation target is tab1.offsetLeft + tab1.offsetWidth -
    // clientWidth + indicatorSize = 100 + 100 - 200 + 32 = 32.
    expect(scrollContainer.scrollLeft).toBe(32);

    rafSpy.mockRestore();
    (globalThis as any).ResizeObserver = OriginalResizeObserver;
  });

  it('scrolls the active tab into view when activeId changes', () => {
    const scrollIntoViewSpy = vi.fn();
    // Patch HTMLElement.prototype so all buttons share the spy.
    const original = HTMLElement.prototype.scrollIntoView;
    HTMLElement.prototype.scrollIntoView = scrollIntoViewSpy as any;

    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
          ]}
          activeId="a"
          onActivate={() => {}}
          aria-label="Test Tabs"
          overflow="scroll"
        />
      );
    });

    scrollIntoViewSpy.mockClear();

    act(() => {
      root.render(
        <Tabs
          tabs={[
            { id: 'a', label: 'Alpha' },
            { id: 'b', label: 'Beta' },
          ]}
          activeId="b"
          onActivate={() => {}}
          aria-label="Test Tabs"
          overflow="scroll"
        />
      );
    });

    expect(scrollIntoViewSpy).toHaveBeenCalled();
    const callArg = scrollIntoViewSpy.mock.calls[0][0];
    expect(callArg.inline).toBe('nearest');
    expect(callArg.behavior).toBe('smooth');

    HTMLElement.prototype.scrollIntoView = original;
  });

  it('renders both overflow indicators together once the strip overflows', () => {
    const observers: Array<() => void> = [];
    const OriginalResizeObserver = (globalThis as any).ResizeObserver;
    (globalThis as any).ResizeObserver = class {
      constructor(public cb: () => void) {
        observers.push(cb);
      }
      observe() {}
      disconnect() {}
    };

    act(() => {
      root.render(
        <Tabs
          tabs={Array.from({ length: 5 }, (_, i) => ({ id: `t${i}`, label: `Tab ${i}` }))}
          activeId="t0"
          onActivate={() => {}}
          aria-label="Test Tabs"
        />
      );
    });

    const scrollContainer = container.querySelector<HTMLDivElement>('[role="tablist"]')!;
    Object.defineProperty(scrollContainer, 'scrollWidth', { value: 500, configurable: true });
    Object.defineProperty(scrollContainer, 'clientWidth', { value: 300, configurable: true });

    act(() => observers.forEach((cb) => cb()));

    // Both indicators render together whenever the strip overflows, even
    // at scrollLeft = 0. No per-side conditional rendering, no count badge.
    const leftInd = container.querySelector('.tab-strip__overflow-indicator--left');
    const rightInd = container.querySelector('.tab-strip__overflow-indicator--right');
    expect(leftInd).toBeTruthy();
    expect(rightInd).toBeTruthy();
    expect(container.querySelector('.tab-strip__overflow-count')).toBeNull();

    (globalThis as any).ResizeObserver = OriginalResizeObserver;
  });
});
