/**
 * frontend/src/ui/layout/appFocusRegions.test.tsx
 *
 * App region navigation (AppRegionNavigation): Control+Tab cycles the
 * header, sidebar, content, panel, and notification regions in both
 * directions, restoring each region's last focus; plain Tab wraps inside a
 * region; editors keep their own Tab; a blocking surface keeps navigation;
 * entering a panel region raises its panel; a brief outline marks the region
 * a keyboard entry lands in; the shortcut help lists the commands. The
 * regions are minimal stand-ins, rendered inside the production shell (real
 * keyboard provider, surfaces, and panel layout store) over a faked backend
 * (test-utils/appState).
 */

import { useDockablePanelContext } from '@ui/dockable';
import { usePanelLayoutStoreContext } from '@ui/dockable/panelLayoutStoreContext';
import { useKeyboardContext } from '@ui/shortcuts/context';
import { useKeyboardSurface } from '@ui/shortcuts/surfaces';
import { act, useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { AppRegionNavigation } from './AppRegionNavigation';

const app = installAppStateHarness();
let view: MountedApp;
let shortcuts: ReturnType<ReturnType<typeof useKeyboardContext>['getAvailableShortcuts']>;
let panelStore: ReturnType<typeof usePanelLayoutStoreContext> | null = null;

/** Docks `panel-a` in the right group of the visible cluster's panel layout. */
function DockedPanel() {
  const { syncPanelGroup } = useDockablePanelContext();
  panelStore = usePanelLayoutStoreContext();
  useEffect(() => {
    syncPanelGroup('panel-a', 'right', undefined);
  }, [syncPanelGroup]);
  return null;
}

function Regions({ blocking = false, hiddenSidebar = false, panel = true } = {}) {
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
      <DockedPanel />
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

const element = (id: string) =>
  requireValue(document.querySelector<HTMLElement>(`[data-testid="${id}"]`), `Missing ${id}`);

const render = async (props: Parameters<typeof Regions>[0] = {}) => {
  await view.show(<Regions {...props} />);
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

/** The panel's stacking order; entering its region raises it. */
const panelZIndex = () => requireValue(panelStore, 'panel store').getGroupLayout('right').zIndex;

const outline = () => document.querySelector<HTMLElement>('.keyboard-region-outline');
const flushOutline = () => act(() => vi.advanceTimersByTime(20));
let regionGeometry: MockInstance | null = null;
/** Lays the regions out (jsdom has no layout) and lets the outline's delay run on demand. */
const prepareOutline = () => {
  vi.useFakeTimers();
  regionGeometry = vi
    .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
    .mockImplementation(function (this: HTMLElement) {
      const region = this.getAttribute('data-app-region');
      if (region === 'header') {
        return new DOMRect(0, this.tagName === 'HEADER' ? 0 : 30, 800, 30);
      }
      if (region === 'sidebar') {
        return new DOMRect(0, 60, 200, 500);
      }
      return new DOMRect(200, 60, 600, 500);
    });
};

beforeEach(async () => {
  const dev = app.cluster({ name: 'dev', context: 'alpha' });
  app.namespaces(dev, ['default']);
  view = await app.render(null);
});

afterEach(() => {
  regionGeometry?.mockRestore();
  regionGeometry = null;
  panelStore = null;
  vi.useRealTimers();
});

describe('app region navigation', () => {
  it('briefly outlines the whole region on keyboard entry without replaying for local Tab', async () => {
    prepareOutline();
    await render();
    focus('header-first');
    expect(outline()).toBeNull();
    await tab();
    flushOutline();
    const cue = outline();
    expect(cue).not.toBeNull();
    expect(cue?.getAttribute('aria-hidden')).toBe('true');
    expect(cue?.tabIndex).toBe(-1);
    expect(cue?.style.getPropertyValue('--region-outline-width')).toBe('800px');
    expect(cue?.style.getPropertyValue('--region-outline-height')).toBe('60px');
    expect(document.activeElement).toBe(element('header-last'));
    cue?.dispatchEvent(new Event('animationend'));
    expect(outline()).toBeNull();
    await tab();
    flushOutline();
    expect(outline()).toBeNull();
    element('cluster').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    await tab();
    flushOutline();
    expect(outline()).not.toBeNull();
  });

  it('outlines only the destination when changing regions, including rapid reverse navigation', async () => {
    prepareOutline();
    await render();
    focus('header-first');
    await tab({ ctrlKey: true });
    flushOutline();
    expect(outline()?.style.getPropertyValue('--region-outline-width')).toBe('200px');
    expect(outline()?.style.getPropertyValue('--region-outline-top')).toBe('60px');
    await tab({ ctrlKey: true });
    await tab({ ctrlKey: true, shiftKey: true });
    await tab({ ctrlKey: true, shiftKey: true });
    flushOutline();
    expect(document.querySelectorAll('.keyboard-region-outline')).toHaveLength(1);
    expect(outline()?.style.getPropertyValue('--region-outline-height')).toBe('60px');
    expect(document.activeElement).toBe(element('header-first'));
  });

  it('keeps popup navigation in its owner region and dismisses the cue when typing', async () => {
    prepareOutline();
    await render();
    focus('search');
    await tab({ shiftKey: true });
    flushOutline();
    const cue = outline();
    expect(cue).not.toBeNull();
    element('last').setAttribute('aria-controls', 'outline-popup');
    const popup = document.createElement('div');
    popup.dataset.focusPortalOwner = 'outline-popup';
    const input = document.createElement('input');
    popup.append(input);
    view.container.append(popup);
    act(() => input.focus());
    flushOutline();
    expect(outline()).toBe(cue);
    input.dispatchEvent(new Event('beforeinput', { bubbles: true }));
    expect(outline()).toBeNull();
    expect(input.classList.contains('keyboard-programmatic-focus')).toBe(false);
    popup.remove();
  });

  it('does not outline an underlying region when a modal blocks navigation', async () => {
    prepareOutline();
    await render({ blocking: true });
    focus('modal');
    await tab({ ctrlKey: true });
    flushOutline();
    expect(outline()).toBeNull();
  });

  it.each(['pointer', 'unmount'])('cancels pending region indication on %s', async (reason) => {
    prepareOutline();
    await render();
    focus('header-first');
    await tab();
    if (reason === 'pointer') {
      element('header-last').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    } else {
      view.clear();
    }
    flushOutline();
    expect(outline()).toBeNull();
  });

  it('switches regions from a portaled control using its invoking region', async () => {
    await render();
    element('last').setAttribute('aria-controls', 'region-popup');
    const portal = document.createElement('div');
    portal.dataset.focusPortalOwner = 'region-popup';
    const action = document.createElement('button');
    portal.append(action);
    document.body.append(portal);
    act(() => action.focus());
    await tab({ ctrlKey: true });
    expect(document.activeElement).toBe(element('panel-tab'));
    portal.remove();
    await tab({ ctrlKey: true, shiftKey: true });
    expect(document.activeElement).toBe(element('last'));
  });

  it('cycles all regions in both directions, raising the entered panel, including with no panels', async () => {
    await render();
    focus('header-first');
    const before = panelZIndex();
    for (const id of ['sidebar', 'search', 'panel-tab', 'header-first']) {
      expect((await tab({ ctrlKey: true })).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(element(id));
    }
    expect(panelZIndex()).toBeGreaterThan(before);
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
    const main = requireValue(element('search').closest('main'), 'Missing main');
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
    const before = panelZIndex();
    focus('modal');
    await tab({ ctrlKey: true });
    expect(document.activeElement).toBe(element('modal'));
    focus('header-first');
    await tab({ ctrlKey: true });
    expect(panelZIndex()).toBe(before);
    expect(document.activeElement).not.toBe(element('sidebar'));
  });

  it('includes a sidebar root and separate resize handle in local traversal', async () => {
    await render();
    const sidebar = requireValue(element('sidebar').parentElement, 'Missing sidebar');
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
    view.container.append(notifications);
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
