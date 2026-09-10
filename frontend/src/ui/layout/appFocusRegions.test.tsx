import { KeyboardProvider, useKeyboardContext } from '@ui/shortcuts/context';
import { useKeyboardSurface } from '@ui/shortcuts/surfaces';
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppRegionNavigation } from './AppRegionNavigation';

vi.mock('@core/desktop-runtime', () => ({
  onEvent: () => () => undefined,
  desktopRuntimeAvailable: () => false,
}));

const focusPanel = vi.hoisted(() => vi.fn());
vi.mock('@ui/dockable/useDockablePanelState', () => ({ focusPanelById: focusPanel }));
let shortcuts: ReturnType<ReturnType<typeof useKeyboardContext>['getAvailableShortcuts']>;

function Harness({ blocking = false, hiddenSidebar = false, panel = true } = {}) {
  const editor = useRef<HTMLDivElement>(null);
  const modal = useRef<HTMLDivElement>(null);
  useKeyboardSurface({
    kind: 'editor',
    rootRef: editor,
    suppressShortcuts: true,
    onKeyDown: (event) => (event.key === 'Tab' ? 'handled-no-prevent' : false),
  });
  useKeyboardSurface({ kind: 'modal', rootRef: modal, active: blocking, blocking: true });
  shortcuts = useKeyboardContext().getAvailableShortcuts();
  return (
    <>
      <AppRegionNavigation />
      <header data-app-region="header">
        <button type="button" data-testid="header-first">
          About
        </button>
        <button type="button" data-testid="header-last">
          Settings
        </button>
      </header>
      <div data-app-region="header">
        <button type="button" data-testid="cluster">
          Cluster
        </button>
      </div>
      <aside data-app-region="sidebar" hidden={hiddenSidebar}>
        <button type="button" data-testid="sidebar">
          Overview
        </button>
      </aside>
      <main data-app-region="content" tabIndex={-1}>
        <input data-testid="search" />
        <button type="button" data-testid="last">
          Last control
        </button>
        <div ref={editor} data-tab-native="true">
          <textarea data-testid="editor" />
        </div>
      </main>
      {!!panel && (
        <div
          className="dockable-panel"
          data-group-key="right"
          data-active-panel-id="panel-a"
          tabIndex={-1}
        >
          <div className="dockable-panel__header">
            <div role="tab" aria-selected="true" tabIndex={-1} data-testid="panel-tab">
              Object
            </div>
          </div>
          <button type="button" data-testid="panel-control">
            Action
          </button>
        </div>
      )}
      {!!blocking && (
        <div ref={modal}>
          <input data-testid="modal" />
        </div>
      )}
    </>
  );
}

describe('app region navigation through KeyboardProvider', () => {
  let container: HTMLDivElement;
  let root: Root;
  const element = (id: string) => {
    const result = document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
    if (!result) {
      throw new Error(`Missing ${id}`);
    }
    return result;
  };
  const render = async (props = {}) => {
    await act(async () => {
      root.render(
        <KeyboardProvider>
          <Harness {...props} />
        </KeyboardProvider>
      );
    });
  };
  const focus = (id: string) =>
    act(() => {
      element(id).focus();
    });
  const tab = async (init: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
      ...init,
    });
    await act(async () => {
      document.activeElement?.dispatchEvent(event);
    });
    return event;
  };
  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('cycles all regions in both directions without changing selections, including with no panels', async () => {
    await render();
    focus('header-first');
    for (const id of ['sidebar', 'search', 'panel-tab', 'header-first']) {
      expect((await tab({ ctrlKey: true })).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(element(id));
    }
    expect(focusPanel).toHaveBeenCalledWith('panel-a');
    await tab({ ctrlKey: true, shiftKey: true });
    expect(document.activeElement).toBe(element('panel-tab'));
    await render({ panel: false });
    focus('header-first');
    await tab({ ctrlKey: true, shiftKey: true });
    expect(document.activeElement).toBe(element('search'));
  });

  it('restores focus in each region and falls back when a saved target becomes unavailable', async () => {
    await render();
    focus('header-last');
    focus('last');
    focus('panel-control');
    await tab({ ctrlKey: true });
    expect(document.activeElement).toBe(element('header-last'));
    await tab({ ctrlKey: true, shiftKey: true });
    expect(document.activeElement).toBe(element('panel-control'));
    await tab({ ctrlKey: true, shiftKey: true });
    expect(document.activeElement).toBe(element('last'));
    focus('sidebar');
    element('last').setAttribute('disabled', '');
    await tab({ ctrlKey: true });
    expect(document.activeElement).toBe(element('search'));
    focus('sidebar');
    element('search').remove();
    await tab({ ctrlKey: true });
    expect(document.activeElement).toBe(element('editor'));
  });

  it('wraps plain Tab locally and includes the separate cluster tab strip in the header', async () => {
    await render();
    focus('cluster');
    await tab();
    expect(document.activeElement).toBe(element('header-first'));
    await tab({ shiftKey: true });
    expect(document.activeElement).toBe(element('cluster'));
    focus('search');
    await tab({ shiftKey: true });
    expect(document.activeElement).toBe(element('editor'));
    focus('header-first');
    expect((await tab()).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(element('header-last'));
    focus('sidebar');
    expect((await tab()).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(element('sidebar'));
  });

  it('skips hidden regions and can enter an empty content region', async () => {
    await render({ hiddenSidebar: true, panel: false });
    focus('header-first');
    await tab({ ctrlKey: true });
    expect(document.activeElement).toBe(element('search'));
    const main = element('search').closest('main');
    if (!main) {
      throw new Error('Missing main');
    }
    main.replaceChildren();
    focus('header-first');
    await tab({ ctrlKey: true });
    expect(document.activeElement).toBe(main);
    await tab();
    expect(document.activeElement).toBe(main);
  });

  it('preserves editor Tab but lets Control+Tab escape; Command/Alt+Tab are not claimed', async () => {
    await render();
    focus('editor');
    expect((await tab()).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(element('editor'));
    await tab({ ctrlKey: true });
    expect(document.activeElement).toBe(element('panel-tab'));
    focus('search');
    expect((await tab({ metaKey: true })).defaultPrevented).toBe(false);
    expect((await tab({ altKey: true })).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(element('search'));
  });

  it('keeps region commands behind a blocking surface, even if focus has leaked outside', async () => {
    await render({ blocking: true });
    focus('modal');
    await tab({ ctrlKey: true });
    expect(document.activeElement).toBe(element('modal'));
    focus('header-first');
    await tab({ ctrlKey: true });
    expect(focusPanel).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(element('sidebar'));
  });

  it('includes a sidebar root and separate resize handle in local traversal', async () => {
    await render();
    const sidebar = element('sidebar').parentElement;
    if (!sidebar) {
      throw new Error('Missing sidebar');
    }
    sidebar.tabIndex = 0;
    element('sidebar').tabIndex = -1;
    const resize = document.createElement('hr');
    resize.dataset.appRegion = 'sidebar';
    resize.tabIndex = 0;
    sidebar.after(resize);
    focus('sidebar');
    await tab();
    expect(document.activeElement).toBe(resize);
    await tab();
    expect(document.activeElement).toBe(sidebar);
    resize.remove();
  });

  it('keeps visible notification controls reachable after panels', async () => {
    await render();
    const notifications = document.createElement('div');
    notifications.dataset.appRegion = 'notifications';
    const dismiss = document.createElement('button');
    dismiss.textContent = 'Dismiss';
    notifications.append(dismiss);
    container.append(notifications);
    focus('header-first');
    await tab({ ctrlKey: true, shiftKey: true });
    expect(document.activeElement).toBe(dismiss);
    await tab();
    expect(document.activeElement).toBe(dismiss);
    notifications.remove();
    await tab({ ctrlKey: true });
    expect(document.activeElement).toBe(element('header-first'));
  });

  it('publishes both region directions and local navigation in shortcut help', async () => {
    await render();
    const navigation = shortcuts.find((group) => group.category === 'Navigation')?.shortcuts;
    expect(navigation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key: 'Tab',
          modifiers: expect.objectContaining({ ctrl: true, shift: false }),
          description: 'Focus next region',
        }),
        expect.objectContaining({
          key: 'Tab',
          modifiers: expect.objectContaining({ ctrl: true, shift: true }),
          description: 'Focus previous region',
        }),
        expect.objectContaining({ key: 'Tab', description: 'Next control in region' }),
      ])
    );
  });
});
