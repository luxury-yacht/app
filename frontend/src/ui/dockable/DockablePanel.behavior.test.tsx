import { ZoomProvider } from '@core/contexts/ZoomContext';
import { KeyboardProvider } from '@ui/shortcuts/context';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PanelLifecycleGuardProvider,
  usePanelLifecycleGuard,
} from '@/core/panel-windows/panelLifecycleGuards';
import DockablePanel from './DockablePanel';
import { DockablePanelProvider } from './DockablePanelProvider';
import { createPanelLayoutStore, setActivePanelLayoutStore } from './panelLayoutStore';
import { getAllPanelStates } from './useDockablePanelState';

vi.mock('@core/backend-api', () => ({
  GetZoomLevel: vi.fn().mockResolvedValue(100),
  SetZoomLevel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/utils/errorHandler', () => ({ errorHandler: { warn: vi.fn() } }));

function UnsavedPanel({ panelId }: Readonly<{ panelId: string }>) {
  usePanelLifecycleGuard(panelId, () => ({ reason: 'unsaved-yaml', focus: () => undefined }));
  return null;
}

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: vi.fn(() => ({
    selectedClusterId: 'cluster-a',
    selectedClusterIds: ['cluster-a'],
  })),
}));

const ensureContentElement = () => {
  const content = document.createElement('div');
  content.className = 'content';
  const body = document.createElement('div');
  body.className = 'content-body';
  content.appendChild(body);
  content.getBoundingClientRect = () =>
    DOMRect.fromRect({
      x: 0,
      y: 0,
      width: window.innerWidth,
      height: window.innerHeight,
    });
  document.body.appendChild(content);
};

const renderPanel = async (
  element: React.ReactElement,
  providerProps: Omit<React.ComponentProps<typeof DockablePanelProvider>, 'children'> = {}
) => {
  ensureContentElement();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = ReactDOM.createRoot(host);

  await act(async () => {
    root.render(
      <KeyboardProvider>
        <PanelLifecycleGuardProvider>
          <DockablePanelProvider {...providerProps}>
            <ZoomProvider>{element}</ZoomProvider>
          </DockablePanelProvider>
        </PanelLifecycleGuardProvider>
      </KeyboardProvider>
    );
    await Promise.resolve();
  });

  return async () => {
    await act(async () => root.unmount());
    host.remove();
  };
};

const panelState = (panelId: string) => {
  const state = getAllPanelStates()[panelId];
  if (!state) {
    throw new Error(`missing panel state for ${panelId}`);
  }
  return state;
};

describe('DockablePanel docked behaviour', () => {
  beforeEach(() => {
    setActivePanelLayoutStore(createPanelLayoutStore());
  });

  afterEach(() => {
    document.body.replaceChildren();
    document.body.className = '';
    setActivePanelLayoutStore(createPanelLayoutStore());
  });

  it('initializes bottom-docked geometry from the provided size', async () => {
    const unmount = await renderPanel(
      <DockablePanel
        panelId="panel-init"
        defaultPosition="bottom"
        defaultSize={{ width: 480, height: 260 }}
        isOpen
      >
        <div>panel</div>
      </DockablePanel>
    );

    expect(panelState('panel-init')).toMatchObject({
      position: 'bottom',
      bottomSize: { height: 260 },
      rightSize: { width: 480 },
      isOpen: true,
    });
    await unmount();
  });

  it('resizes a right-docked panel from its separator', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 1200,
    });
    const unmount = await renderPanel(
      <DockablePanel panelId="panel-right" defaultPosition="right" isOpen>
        <div>panel</div>
      </DockablePanel>
    );
    const initialWidth = panelState('panel-right').rightSize.width;
    const handle = document.querySelector<HTMLElement>('[aria-label="Resize panel width"]');

    await act(async () => {
      handle?.dispatchEvent(
        new MouseEvent('mousedown', {
          bubbles: true,
          clientX: 700,
          clientY: 200,
        })
      );
      await Promise.resolve();
    });
    expect(document.body.classList.contains('dockable-panel-resizing-w')).toBe(true);
    await act(async () => {
      window.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          clientX: 620,
          clientY: 200,
        })
      );
    });
    await act(async () => {
      window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      await Promise.resolve();
    });

    expect(panelState('panel-right').rightSize.width).toBeGreaterThan(initialWidth);
    await unmount();
  });

  it('supports keyboard resizing for a bottom-docked separator', async () => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 1000,
    });
    const unmount = await renderPanel(
      <DockablePanel panelId="panel-bottom" defaultPosition="bottom" isOpen>
        <div>panel</div>
      </DockablePanel>
    );
    const initialHeight = panelState('panel-bottom').bottomSize.height;
    const handle = document.querySelector<HTMLElement>('[aria-label="Resize panel height"]');

    await act(async () => {
      handle?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowUp',
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });

    expect(panelState('panel-bottom').bottomSize.height).toBeGreaterThan(initialHeight);
    await unmount();
  });

  it('maximizes docked content and restores its prior edge and size', async () => {
    const unmount = await renderPanel(
      <DockablePanel panelId="panel-maximize" defaultPosition="right" allowMaximize isOpen>
        <div>panel</div>
      </DockablePanel>
    );
    const before = panelState('panel-maximize').rightSize;
    const maximize = document.querySelector<HTMLButtonElement>('[aria-label="Maximize panel"]');

    await act(async () => maximize?.click());
    expect(document.querySelector('.dockable-panel--maximized')).toBeTruthy();

    const restore = document.querySelector<HTMLButtonElement>('[aria-label="Restore panel size"]');
    await act(async () => restore?.click());
    expect(panelState('panel-maximize').rightSize).toEqual(before);
    expect(panelState('panel-maximize').position).toBe('right');
    await unmount();
  });

  it('keeps same-edge panels open as tabs', async () => {
    const unmount = await renderPanel(
      <>
        <DockablePanel panelId="panel-a" defaultPosition="right" isOpen>
          <div>A</div>
        </DockablePanel>
        <DockablePanel panelId="panel-b" defaultPosition="right" isOpen>
          <div>B</div>
        </DockablePanel>
      </>
    );

    expect(panelState('panel-a').isOpen).toBe(true);
    expect(panelState('panel-b').isOpen).toBe(true);
    expect(document.querySelectorAll('.dockable-panel [role="tab"]')).toHaveLength(2);
    await unmount();
  });

  it('logs a warning and renders nothing when panelId is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const unmount = await renderPanel(
      <DockablePanel panelId={'' as unknown as string}>
        <div>panel</div>
      </DockablePanel>
    );

    expect(warn).toHaveBeenCalledWith('DockablePanel: panelId prop is required');
    expect(document.querySelector('.dockable-panel')).toBeNull();
    warn.mockRestore();
    await unmount();
  });

  it('applies dock controls to every tab in a shared docked group', async () => {
    const unmount = await renderPanel(
      <>
        <DockablePanel panelId="panel-controls-a" defaultPosition="right" isOpen>
          <div>A</div>
        </DockablePanel>
        <DockablePanel panelId="panel-controls-b" defaultPosition="right" isOpen>
          <div>B</div>
        </DockablePanel>
      </>
    );

    const dockBottom = document.querySelector<HTMLButtonElement>(
      '.dockable-panel--right [aria-label="Dock panel to bottom"]'
    );
    await act(async () => dockBottom?.click());

    expect(panelState('panel-controls-a').position).toBe('bottom');
    expect(panelState('panel-controls-b').position).toBe('bottom');
    await unmount();
  });

  it('appends the whole group to an occupied dock and preserves its active tab', async () => {
    const unmount = await renderPanel(
      <>
        <DockablePanel panelId="panel-target-bottom" defaultPosition="bottom" isOpen>
          <div>Target</div>
        </DockablePanel>
        <DockablePanel panelId="panel-source-a" defaultPosition="right" isOpen>
          <div>Source A</div>
        </DockablePanel>
        <DockablePanel panelId="panel-source-b" defaultPosition="right" isOpen>
          <div>Source B</div>
        </DockablePanel>
      </>
    );
    const before = getAllPanelStates();
    expect(before['panel-target-bottom']?.zIndex).toBeLessThan(
      before['panel-source-a']?.zIndex ?? Number.NEGATIVE_INFINITY
    );

    const dockBottom = document.querySelector<HTMLButtonElement>(
      '.dockable-panel--right [aria-label="Dock panel to bottom"]'
    );
    await act(async () => dockBottom?.click());

    const after = getAllPanelStates();
    expect(after['panel-source-a']?.position).toBe('bottom');
    expect(after['panel-source-b']?.position).toBe('bottom');
    expect(document.querySelector('.dockable-panel--right')).toBeNull();
    expect(
      Array.from(document.querySelectorAll('.dockable-panel--bottom [role="tab"]')).map((tab) =>
        tab.getAttribute('data-panel-id')
      )
    ).toEqual(['panel-target-bottom', 'panel-source-a', 'panel-source-b']);
    expect(
      document
        .querySelector('.dockable-panel--bottom [aria-selected="true"]')
        ?.getAttribute('data-panel-id')
    ).toBe('panel-source-b');
    expect(after['panel-target-bottom']?.zIndex).toBeGreaterThan(
      after['panel-source-a']?.zIndex ?? Number.POSITIVE_INFINITY
    );
    await unmount();
  });

  it('moves the entire bottom group right and floats that complete group from its icon', async () => {
    const requestMove = vi.fn((_group, target) => target === 'floating');
    const unmount = await renderPanel(
      <>
        <DockablePanel panelId="panel-a" title="A" defaultPosition="bottom" isOpen>
          <div>A</div>
        </DockablePanel>
        <DockablePanel panelId="panel-b" title="B" defaultPosition="bottom" isOpen>
          <div>B</div>
        </DockablePanel>
      </>,
      { onGroupMoveRequest: requestMove }
    );
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="Dock panel to right side"]')?.click()
    );
    expect(panelState('panel-a').position).toBe('right');
    expect(panelState('panel-b').position).toBe('right');
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('[aria-label="Undock panel to floating window"]')
        ?.click()
    );
    expect(requestMove).toHaveBeenLastCalledWith(
      { groupKey: 'right', tabs: ['panel-a', 'panel-b'], activeTab: 'panel-b' },
      'floating'
    );
    await unmount();
  });

  it('offers context-aware actions on an inactive tab and docks only that tab', async () => {
    const nativeMove = vi.fn();
    const unmount = await renderPanel(
      <>
        <DockablePanel panelId="panel-menu-a" title="A" defaultPosition="right" isOpen>
          <div>A</div>
        </DockablePanel>
        <DockablePanel panelId="panel-menu-b" title="B" defaultPosition="right" isOpen>
          <div>B</div>
        </DockablePanel>
      </>,
      { onTabMoveRequest: nativeMove }
    );
    await act(async () =>
      document.querySelector('[role="tab"][data-panel-id="panel-menu-a"]')?.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: 100,
          clientY: 100,
        })
      )
    );
    const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
    expect(items.map((item) => item.textContent)).toEqual(['Dock to bottom', 'Float', 'Close']);
    expect(document.querySelector('[aria-selected="true"]')?.getAttribute('data-panel-id')).toBe(
      'panel-menu-b'
    );
    await act(async () => items.find((item) => item.textContent === 'Dock to bottom')?.click());
    expect(panelState('panel-menu-a').position).toBe('bottom');
    expect(panelState('panel-menu-b').position).toBe('right');
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(nativeMove).not.toHaveBeenCalled();
    await unmount();
  });

  it('closes every tab when the panel close control is clicked', async () => {
    const unmount = await renderPanel(
      <>
        <DockablePanel panelId="panel-close-a" defaultPosition="right">
          <div>A</div>
        </DockablePanel>
        <DockablePanel panelId="panel-close-b" defaultPosition="right">
          <div>B</div>
        </DockablePanel>
      </>
    );

    const close = document.querySelector<HTMLButtonElement>(
      '[aria-label="Close all tabs in this panel"]'
    );
    await act(async () => close?.click());

    expect(panelState('panel-close-a').isOpen).toBe(false);
    expect(panelState('panel-close-b').isOpen).toBe(false);
    await unmount();
  });

  it('keeps the complete group maximized when switching tabs and restores it together', async () => {
    const unmount = await renderPanel(
      <>
        <DockablePanel panelId="a" title="A" defaultPosition="right" allowMaximize>
          <div>A</div>
        </DockablePanel>
        <DockablePanel panelId="b" title="B" defaultPosition="right" allowMaximize>
          <div>B</div>
        </DockablePanel>
      </>
    );
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="Maximize panel"]')?.click()
    );
    expect(document.querySelectorAll('.dockable-panel--maximized [role="tab"]')).toHaveLength(2);
    await act(async () =>
      document.querySelector<HTMLElement>('[role="tab"][data-panel-id="a"]')?.click()
    );
    expect(
      document
        .querySelector('.dockable-panel--maximized [aria-selected="true"]')
        ?.getAttribute('data-panel-id')
    ).toBe('a');
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="Restore panel size"]')?.click()
    );
    expect(document.querySelector('.dockable-panel--maximized')).toBeNull();
    expect(document.querySelectorAll('.dockable-panel--right [role="tab"]')).toHaveLength(2);
    await unmount();
  });

  it('keeps all group members in place when an inactive tab blocks docking or closing', async () => {
    const unmount = await renderPanel(
      <>
        <UnsavedPanel panelId="a" />
        <DockablePanel panelId="a" title="A" defaultPosition="right">
          <div>A</div>
        </DockablePanel>
        <DockablePanel panelId="b" title="B" defaultPosition="right">
          <div>B</div>
        </DockablePanel>
      </>
    );
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[aria-label="Dock panel to bottom"]')?.click()
    );
    await act(async () =>
      document
        .querySelector<HTMLButtonElement>('[aria-label="Close all tabs in this panel"]')
        ?.click()
    );
    expect(panelState('a')).toMatchObject({ position: 'right', isOpen: true });
    expect(panelState('b')).toMatchObject({ position: 'right', isOpen: true });
    await unmount();
  });

  it('floats the right-clicked tab alone and closes a different inactive tab from its menu', async () => {
    const move = vi.fn();
    const groupMove = vi.fn();
    const unmount = await renderPanel(
      <>
        <DockablePanel panelId="a" title="A" defaultPosition="bottom">
          <div>A</div>
        </DockablePanel>
        <DockablePanel panelId="b" title="B" defaultPosition="bottom">
          <div>B</div>
        </DockablePanel>
      </>,
      { onTabMoveRequest: move, onGroupMoveRequest: groupMove }
    );
    const openMenu = async () =>
      act(async () =>
        document
          .querySelector('[role="tab"][data-panel-id="a"]')
          ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
      );
    await openMenu();
    expect(
      Array.from(document.querySelectorAll('[role="menuitem"]')).map((item) => item.textContent)
    ).toEqual(['Dock to right', 'Float', 'Close']);
    await act(async () =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
        .find((item) => item.textContent === 'Float')
        ?.click()
    );
    expect(move).toHaveBeenCalledWith(
      expect.objectContaining({ panelId: 'a', sourceGroupId: 'bottom' }),
      'floating'
    );
    expect(groupMove).not.toHaveBeenCalled();
    expect(document.querySelectorAll('[role="tab"]')).toHaveLength(2);
    await openMenu();
    await act(async () =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'))
        .find((item) => item.textContent === 'Close')
        ?.click()
    );
    expect(panelState('a').isOpen).toBe(false);
    expect(panelState('b').isOpen).toBe(true);
    await unmount();
  });

  it.each(['right', 'bottom'] as const)(
    'offers native tab docking to %s separately from docking the complete native group',
    async (target) => {
      const move = vi.fn();
      const groupMove = vi.fn();
      const unmount = await renderPanel(
        <>
          <DockablePanel panelId="a" title="A" defaultPosition="right" defaultGroupKey="right">
            <div>A</div>
          </DockablePanel>
          <DockablePanel panelId="b" title="B" defaultPosition="right" defaultGroupKey="right">
            <div>B</div>
          </DockablePanel>
        </>,
        {
          nativeWindowMode: true,
          onTabMoveRequest: move,
          onGroupMoveRequest: groupMove,
          initialTabGroups: {
            right: { tabs: ['a', 'b'], activeTab: 'b' },
            bottom: { tabs: [], activeTab: null },
            floating: [],
          },
        }
      );
      await act(async () =>
        document
          .querySelector('[role="tab"][data-panel-id="a"]')
          ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
      );
      const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      expect(items.map((item) => item.textContent)).toEqual([
        'Dock to right',
        'Dock to bottom',
        'Close',
      ]);
      await act(async () =>
        items.find((item) => item.textContent === `Dock to ${target}`)?.click()
      );
      expect(move).toHaveBeenCalledWith(expect.objectContaining({ panelId: 'a' }), target);
      expect(groupMove).not.toHaveBeenCalled();
      await act(async () =>
        document
          .querySelector<HTMLButtonElement>('[aria-label="Dock panel to right side"]')
          ?.click()
      );
      expect(groupMove).toHaveBeenCalledWith(
        expect.objectContaining({ tabs: ['a', 'b'], activeTab: 'b' }),
        'right'
      );
      await unmount();
    }
  );

  it('dismisses the tab menu with Escape without closing any tab', async () => {
    const unmount = await renderPanel(
      <DockablePanel panelId="a" title="A" defaultPosition="right">
        <div>A</div>
      </DockablePanel>
    );
    await act(async () =>
      document
        .querySelector('[role="tab"][data-panel-id="a"]')
        ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    );
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    await act(async () =>
      document
        .querySelector('[role="menu"]')
        ?.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
        )
    );
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(panelState('a').isOpen).toBe(true);
    await unmount();
  });
});
