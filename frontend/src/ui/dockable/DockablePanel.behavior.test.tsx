import { ZoomProvider } from '@core/contexts/ZoomContext';
import { useKubeconfig } from '@modules/kubernetes/config/KubeconfigContext';
import { KeyboardProvider } from '@ui/shortcuts/context';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PanelLifecycleGuardProvider,
  usePanelLifecycleGuard,
} from '@/core/panel-windows/panelLifecycleGuards';
import { DockablePanelTestHost } from '@/test-utils/DockablePanelTestHost';
import DockablePanel from './DockablePanel';
import {
  DockablePanelLayer,
  DockablePanelProvider,
  useDockablePanelContext,
} from './DockablePanelProvider';
import { createPanelLayoutStore } from './panelLayoutStore';
import { usePanelLayoutStoreContext } from './panelLayoutStoreContext';
import { getGroupForPanel, getPanelPosition } from './tabGroupState';

let layoutStore = createPanelLayoutStore();
const LayoutProbe = () => {
  layoutStore = usePanelLayoutStoreContext();
  return null;
};
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
  element: React.ReactNode,
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
            <ZoomProvider>
              <DockablePanelTestHost />
              <LayoutProbe />
              {element}
            </ZoomProvider>
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
  const state = layoutStore.getState(panelId);
  if (!state) {
    throw new Error(`missing panel state for ${panelId}`);
  }
  const group = getGroupForPanel(layoutStore.getTabGroups(), panelId);
  return {
    ...state,
    ...layoutStore.getGroupLayout(group ?? 'right'),
    position: getPanelPosition(layoutStore.getTabGroups(), panelId),
  };
};

describe('DockablePanel docked behaviour', () => {
  beforeEach(() => {
    layoutStore = createPanelLayoutStore();
  });

  afterEach(() => {
    document.body.replaceChildren();
    document.body.className = '';
    layoutStore = createPanelLayoutStore();
  });

  it('keeps panels visible when workspace content is replaced during reconstruction', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = ReactDOM.createRoot(host);
    const renderContent = async (generation: string) =>
      act(async () =>
        root.render(
          <KeyboardProvider>
            <DockablePanelProvider>
              <ZoomProvider>
                <div key={generation} className="content">
                  <DockablePanelLayer />
                  <div className="content-body" />
                </div>
                <DockablePanel panelId="restored-panel" isOpen title="Restored panel">
                  <div data-testid="restored-panel-body">Restored object content</div>
                </DockablePanel>
              </ZoomProvider>
            </DockablePanelProvider>
          </KeyboardProvider>
        )
      );
    try {
      await renderContent('loading');
      expect(document.querySelector('[data-testid="restored-panel-body"]')).not.toBeNull();
      await renderContent('ready');
      expect(document.querySelector('[data-testid="restored-panel-body"]')).not.toBeNull();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });

  it('keeps restored bottom membership while controlled panels initialize', async () => {
    const Projection = () => {
      const { tabGroups } = useDockablePanelContext();
      return ['restored-a', 'restored-b'].map((panelId) => (
        <DockablePanel
          key={panelId}
          panelId={panelId}
          isOpen
          defaultPosition={getPanelPosition(tabGroups, panelId) ?? 'right'}
          defaultGroupKey={getGroupForPanel(tabGroups, panelId) ?? undefined}
        >
          <div>{panelId}</div>
        </DockablePanel>
      ));
    };
    const rendered = await renderPanel(<Projection />, {
      initialTabGroups: {
        right: { tabs: [], activeTab: null },
        bottom: { tabs: ['restored-a', 'restored-b'], activeTab: 'restored-b' },
        floating: [],
      },
    });
    try {
      expect(layoutStore.getTabGroups().bottom).toEqual({
        tabs: ['restored-a', 'restored-b'],
        activeTab: 'restored-b',
      });
      expect(layoutStore.getTabGroups().right.tabs).toEqual([]);
    } finally {
      await rendered();
    }
  });

  it('retains group geometry after reordering across a cluster round trip', async () => {
    ensureContentElement();
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = ReactDOM.createRoot(host);
    let context: ReturnType<typeof useDockablePanelContext> | undefined;
    const Capture = () => {
      context = useDockablePanelContext();
      return null;
    };
    const renderCluster = async (clusterId: string) => {
      vi.mocked(useKubeconfig).mockReturnValue({
        selectedClusterId: clusterId,
        selectedClusterIds: ['cluster-a', 'cluster-b'],
      } as ReturnType<typeof useKubeconfig>);
      await act(async () =>
        root.render(
          <KeyboardProvider>
            <PanelLifecycleGuardProvider>
              <DockablePanelProvider>
                <ZoomProvider>
                  <DockablePanelTestHost />
                  <Capture />
                  {clusterId === 'cluster-a' ? (
                    <>
                      <DockablePanel key="a1" panelId="a1" defaultSize={{ width: 540 }} isOpen>
                        <div>A1</div>
                      </DockablePanel>
                      <DockablePanel key="a2" panelId="a2" defaultSize={{ width: 680 }} isOpen>
                        <div>A2</div>
                      </DockablePanel>
                    </>
                  ) : (
                    <DockablePanel key="b1" panelId="b1" defaultSize={{ width: 900 }} isOpen>
                      <div>B1</div>
                    </DockablePanel>
                  )}
                </ZoomProvider>
              </DockablePanelProvider>
            </PanelLifecycleGuardProvider>
          </KeyboardProvider>
        )
      );
    };
    const leaderWidth = () =>
      document.querySelector<HTMLElement>('.dockable-panel:has(.dockable-panel__header)')?.style
        .width;
    try {
      await renderCluster('cluster-a');
      expect(leaderWidth()).toBe('540px');
      await act(async () => context?.reorderTabInGroup('right', 'a2', 0));
      expect(leaderWidth()).toBe('540px');
      await renderCluster('cluster-b');
      await renderCluster('cluster-a');
      expect(leaderWidth()).toBe('540px');
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.mocked(useKubeconfig).mockReturnValue({
        selectedClusterId: 'cluster-a',
        selectedClusterIds: ['cluster-a'],
      } as ReturnType<typeof useKubeconfig>);
    }
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
    const beforeTargetZ = layoutStore.getGroupLayout('bottom').zIndex;

    const dockBottom = document.querySelector<HTMLButtonElement>(
      '.dockable-panel--right [aria-label="Dock panel to bottom"]'
    );
    await act(async () => dockBottom?.click());

    expect(panelState('panel-source-a').position).toBe('bottom');
    expect(panelState('panel-source-b').position).toBe('bottom');
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
    expect(layoutStore.getGroupLayout('bottom').zIndex).toBeGreaterThan(beforeTargetZ);
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

  it.each([
    { ids: ['a'], target: 'a', moves: [] },
    { ids: ['a', 'b', 'c'], target: 'a', moves: ['Move tab right'] },
    { ids: ['a', 'b', 'c'], target: 'b', moves: ['Move tab left', 'Move tab right'] },
    { ids: ['a', 'b', 'c'], target: 'c', moves: ['Move tab left'] },
  ])(
    'shows only usable move commands with icons at the bottom for $target in $ids',
    async ({ ids, target, moves }) => {
      const unmount = await renderPanel(
        ids.map((id) => (
          <DockablePanel key={id} panelId={id} title={id} defaultPosition="right" isOpen>
            <div>{id}</div>
          </DockablePanel>
        ))
      );
      const tab = document.querySelector(`[role="tab"][data-panel-id="${target}"]`);
      expect(tab).not.toBeNull();
      await act(async () =>
        tab?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
      );
      const items = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]'));
      expect
        .soft(items.map((item) => item.textContent))
        .toEqual(['Dock to bottom', 'Float', 'Close', ...moves]);
      for (const moveItem of items.filter((item) => item.textContent?.startsWith('Move tab '))) {
        expect.soft(moveItem.querySelector('.context-menu-icon svg')).not.toBeNull();
        expect.soft(moveItem.getAttribute('aria-disabled')).toBe('false');
      }
      expect(document.querySelectorAll('.context-menu-divider')).toHaveLength(moves.length ? 2 : 1);
      await unmount();
    }
  );

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
    expect(items.map((item) => item.textContent)).toEqual([
      'Dock to bottom',
      'Float',
      'Close',
      'Move tab right',
    ]);
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
    ).toEqual(['Dock to right', 'Float', 'Close', 'Move tab right']);
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
        'Move tab right',
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
