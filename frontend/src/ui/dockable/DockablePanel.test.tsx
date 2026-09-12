/**
 * frontend/src/components/dockable/DockablePanel.test.tsx
 *
 * Test suite for DockablePanel.
 * Covers key behaviors and edge cases for DockablePanel.
 */

import { ZoomProvider } from '@core/contexts/ZoomContext';
import { ObjectPanelTabs } from '@modules/object-panel/components/ObjectPanel/ObjectPanelTabs';
import { getTabbableElements } from '@shared/components/modals/getTabbableElements';
import { useAppRegionNavigation } from '@ui/layout/appFocusRegions';
import { KeyboardProvider } from '@ui/shortcuts/context';
import React, { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import DockablePanel from './DockablePanel';
import { DockablePanelProvider, useDockablePanelContext } from './DockablePanelProvider';

vi.mock('@core/backend-api', () => ({
  GetZoomLevel: vi.fn().mockResolvedValue(100),
  SetZoomLevel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@modules/kubernetes/config/KubeconfigContext', () => ({
  useKubeconfig: vi.fn(() => ({
    selectedClusterId: 'cluster-a',
    selectedClusterIds: ['cluster-a'],
  })),
}));

const ensureContentElement = () => {
  if (!document.querySelector('.content')) {
    const el = document.createElement('div');
    el.className = 'content';
    document.body.appendChild(el);
    // JSDOM doesn't do layout, so mock getBoundingClientRect to return realistic dimensions.
    el.getBoundingClientRect = () =>
      DOMRect.fromRect({
        x: 0,
        y: 0,
        width: window.innerWidth,
        height: window.innerHeight,
      });
  }
};

const renderPanel = async (ui: React.ReactElement) => {
  ensureContentElement();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  await act(async () => {
    const wrapped =
      ui.type === DockablePanelProvider ? (
        <KeyboardProvider>
          <ZoomProvider>{ui}</ZoomProvider>
        </KeyboardProvider>
      ) : (
        <KeyboardProvider>
          <DockablePanelProvider>
            <ZoomProvider>{ui}</ZoomProvider>
          </DockablePanelProvider>
        </KeyboardProvider>
      );
    root.render(wrapped);
    await Promise.resolve();
  });

  return {
    container,
    root,
    unmount: () =>
      act(() => {
        root.unmount();
        container.remove();
      }),
  };
};

const getVisiblePanelSection = (selector: string) =>
  Array.from(document.querySelectorAll<HTMLElement>(selector)).find((element) => {
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }) ?? null;

describe('DockablePanel', () => {
  afterEach(() => {
    document.querySelectorAll('.dockable-panel-layer').forEach((node) => {
      node.remove();
    });
  });

  it('keeps a new-panel focus request when its initiating content unmounts before registration', async () => {
    const Launcher = ({ onOpen }: { onOpen: () => void }) => {
      const { focusPanel } = useDockablePanelContext();
      return (
        <button
          type="button"
          onClick={() => {
            focusPanel('new-from-menu');
            onOpen();
          }}
        >
          Open related object
        </button>
      );
    };
    const Flow = () => {
      const [opening, setOpening] = React.useState(false);
      const [opened, setOpened] = React.useState(false);
      React.useEffect(() => {
        if (opening) {
          const timer = setTimeout(() => setOpened(true), 30);
          return () => clearTimeout(timer);
        }
      }, [opening]);
      if (opening && !opened) {
        return <span>Opening related object</span>;
      }
      return opened ? (
        <DockablePanel panelId="new-from-menu" title="Related" defaultPosition="right" isOpen>
          <button type="button">Related action</button>
        </DockablePanel>
      ) : (
        <Launcher onOpen={() => setOpening(true)} />
      );
    };
    const { container, unmount } = await renderPanel(<Flow />);
    await act(async () => container.querySelector('button')?.click());
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(document.activeElement).toBe(
      document.querySelector('[role="tab"][data-panel-id="new-from-menu"]')
    );
    unmount();
  });

  it.each([false, true])(
    'resumes control order around a pointer-focused body (reverse: %s)',
    async (shiftKey) => {
      const { unmount } = await renderPanel(
        <DockablePanel panelId="body-order" title="Body" defaultPosition="bottom" isOpen>
          <button type="button" data-testid="before-body">
            Before body
          </button>
          <div tabIndex={-1} data-testid="read-only-body">
            Read-only content
          </div>
          <button type="button" data-testid="after-body">
            After body
          </button>
        </DockablePanel>
      );
      const body = requireValue(
        document.querySelector<HTMLElement>('[data-testid="read-only-body"]'),
        'read-only body'
      );
      await act(async () => body.focus());
      await act(async () =>
        body.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true })
        )
      );
      expect(document.activeElement).toBe(
        document.querySelector(`[data-testid="${shiftKey ? 'before-body' : 'after-body'}"]`)
      );
      unmount();
    }
  );

  it.each([false, true])(
    'visits tab actions and reorders through the actual panel owner (object panel: %s)',
    async (objectPanel) => {
      const content = (
        <div className="object-panel-body">
          <div className="object-panel-content">
            <button type="button">Details action</button>
          </div>
        </div>
      );
      const { unmount } = await renderPanel(
        <>
          <DockablePanel
            panelId="keyboard-a"
            title="Alpha"
            defaultPosition="right"
            isOpen
            className={objectPanel ? 'object-panel-dockable' : undefined}
          >
            {content}
          </DockablePanel>
          <DockablePanel
            panelId="keyboard-b"
            title="Beta"
            defaultPosition="right"
            isOpen
            className={objectPanel ? 'object-panel-dockable' : undefined}
          >
            {content}
          </DockablePanel>
        </>
      );
      const tab = requireValue(
        document.querySelector<HTMLElement>(
          '.dockable-tab-bar [role="tab"][data-panel-id="keyboard-b"]'
        ),
        'Beta tab'
      );
      const press = async (key: string) =>
        act(async () =>
          document.activeElement?.dispatchEvent(
            new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
          )
        );
      await act(async () => tab.focus());
      await press('Tab');
      expect(document.activeElement).toBe(tab.parentElement?.querySelector('.tab-item__close'));
      await act(async () => {
        tab.focus();
        tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      });
      const move = Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
        (el) => el.textContent === 'Move tab left'
      );
      expect(move).toBeTruthy();
      await act(async () => move?.click());
      const ids = Array.from(
        document.querySelectorAll<HTMLElement>('.dockable-tab-bar [role="tab"]')
      ).map((el) => el.dataset.panelId);
      expect(ids).toEqual(['keyboard-b', 'keyboard-a']);
      expect(document.activeElement).toBe(tab);
      unmount();
    }
  );

  it('cycles into a real panel with suppressed controls and restores focus without switching its tab', async () => {
    const Navigation = () => {
      useAppRegionNavigation();
      return (
        <header data-app-region="header">
          <button type="button" data-testid="region-start">
            Start
          </button>
        </header>
      );
    };
    const { unmount } = await renderPanel(
      <>
        <Navigation />
        <DockablePanel panelId="region-panel" title="Panel" defaultPosition="right" isOpen>
          <button type="button" data-testid="region-action">
            Action
          </button>
        </DockablePanel>
      </>
    );
    const start = requireValue(
      document.querySelector<HTMLElement>('[data-testid="region-start"]'),
      'header control'
    );
    const action = requireValue(
      document.querySelector<HTMLElement>('[data-testid="region-action"]'),
      'panel control'
    );
    const cycle = async (target: HTMLElement, shiftKey = false) => {
      await act(async () => {
        target.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Tab',
            ctrlKey: true,
            shiftKey,
            bubbles: true,
            cancelable: true,
          })
        );
      });
    };
    await act(async () => {
      start.focus();
    });
    expect(action.tabIndex).toBe(-1);
    await cycle(start);
    expect(document.activeElement?.closest('.dockable-panel')).toBe(
      action.closest('.dockable-panel')
    );
    expect(action.tabIndex).toBe(0);
    await act(async () => {
      action.focus();
    });
    await cycle(action);
    expect(document.activeElement).toBe(start);
    await cycle(start, true);
    expect(document.activeElement).toBe(action);
    unmount();
  });

  it('invokes onClose and removes the panel when the close control is clicked', async () => {
    const onClose = vi.fn();

    const Host = () => {
      const [open, setOpen] = React.useState(true);
      return (
        <DockablePanel
          panelId="dockable-panel-test-close"
          onClose={() => {
            setOpen(false);
            onClose();
          }}
          defaultPosition="floating"
          isOpen={open}
        >
          <div>panel-body</div>
        </DockablePanel>
      );
    };

    const { unmount } = await renderPanel(<Host />);

    const layer = document.querySelector('.dockable-panel-layer');
    expect(layer).toBeTruthy();

    const closeButton = requireValue(
      layer,
      'expected test value in DockablePanel.test.tsx'
    ).querySelector('[aria-label="Close all tabs in this panel"]') as HTMLButtonElement;
    expect(closeButton).toBeTruthy();

    act(() => {
      closeButton.click();
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.dockable-panel')).toBeNull();

    unmount();
  });

  it('closes the active tab on Escape using left-adjacent activation', async () => {
    const Host = () => {
      const [openPanels, setOpenPanels] = React.useState({
        a: true,
        b: true,
        c: true,
      });
      const closePanel = (key: keyof typeof openPanels) => {
        setOpenPanels((current) => ({ ...current, [key]: false }));
      };

      return (
        <>
          {!!openPanels.a && (
            <DockablePanel
              panelId="panel-a"
              title="A"
              defaultPosition="right"
              isOpen={openPanels.a}
              onClose={() => closePanel('a')}
              closeActiveTabOnEscape
            >
              <button type="button">Panel A body</button>
            </DockablePanel>
          )}
          {!!openPanels.b && (
            <DockablePanel
              panelId="panel-b"
              title="B"
              defaultPosition="right"
              isOpen={openPanels.b}
              onClose={() => closePanel('b')}
              closeActiveTabOnEscape
            >
              <button type="button">Panel B body</button>
            </DockablePanel>
          )}
          {!!openPanels.c && (
            <DockablePanel
              panelId="panel-c"
              title="C"
              defaultPosition="right"
              isOpen={openPanels.c}
              onClose={() => closePanel('c')}
              closeActiveTabOnEscape
            >
              <button type="button">Panel C body</button>
            </DockablePanel>
          )}
        </>
      );
    };

    const { unmount } = await renderPanel(<Host />);

    const tabB = document.querySelector('[role="tab"][data-panel-id="panel-b"]') as HTMLElement;
    expect(tabB).toBeTruthy();

    await act(async () => {
      tabB.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      tabB.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    expect(
      document.querySelector('[role="tab"][data-panel-id="panel-b"]')?.getAttribute('aria-selected')
    ).toBe('true');

    await act(async () => {
      tabB.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const selectedTabA = document.querySelector(
      '[role="tab"][data-panel-id="panel-a"]'
    ) as HTMLElement | null;
    expect(document.querySelector('[role="tab"][data-panel-id="panel-b"]')).toBeNull();
    expect(selectedTabA?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(selectedTabA);

    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const selectedTabC = document.querySelector(
      '[role="tab"][data-panel-id="panel-c"]'
    ) as HTMLElement | null;
    expect(document.querySelector('[role="tab"][data-panel-id="panel-a"]')).toBeNull();
    expect(selectedTabC?.getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(selectedTabC);

    await act(async () => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });

    expect(document.querySelector('.dockable-panel')).toBeNull();

    unmount();
  });

  it('updates docking position and notifies via onPositionChange', async () => {
    const onPositionChange = vi.fn();
    const { unmount } = await renderPanel(
      <DockablePanel
        panelId="dockable-panel-test-dock"
        defaultPosition="floating"
        allowMaximize
        onPositionChange={onPositionChange}
      >
        <div>panel-body</div>
      </DockablePanel>
    );

    expect(onPositionChange).toHaveBeenCalledWith('floating');

    const layer = document.querySelector('.dockable-panel-layer');
    expect(layer).toBeTruthy();

    const dockRightButton = requireValue(
      layer,
      'expected test value in DockablePanel.test.tsx'
    ).querySelector('[aria-label="Dock panel to right side"]') as HTMLButtonElement;
    expect(dockRightButton).toBeTruthy();

    act(() => {
      dockRightButton.click();
    });

    expect(onPositionChange).toHaveBeenCalledWith('right');

    const panelElement = requireValue(
      layer,
      'expected test value in DockablePanel.test.tsx'
    ).querySelector('.dockable-panel');
    expect(panelElement).toBeTruthy();
    expect(
      requireValue(panelElement, 'expected test value in DockablePanel.test.tsx').className
    ).toMatch(/dockable-panel--right/);

    const maximizeButton = layer
      ?.querySelector('.dockable-panel__control-btn')
      ?.closest('.dockable-panel')
      ?.querySelector('[aria-label="Maximize panel"]') as HTMLButtonElement | null;
    expect(maximizeButton).toBeTruthy();
    if (maximizeButton) {
      act(() => {
        maximizeButton.click();
      });
      expect(layer?.querySelector('.dockable-panel--maximized')).toBeTruthy();

      const restoreButton = layer
        ?.querySelector('.dockable-panel')
        ?.querySelector('[aria-label="Restore panel size"]') as HTMLButtonElement | null;
      expect(restoreButton).toBeTruthy();

      act(() => {
        restoreButton?.click();
      });

      expect(layer?.querySelector('.dockable-panel--maximized')).toBeNull();
      expect(
        layer?.querySelector('.dockable-panel')?.className.includes('dockable-panel--right')
      ).toBe(true);
    }

    unmount();
  });

  it('never renders the legacy in-page floating shell', async () => {
    const { unmount } = await renderPanel(
      <DockablePanel panelId="native-float-only" defaultPosition="floating" isOpen>
        <div>panel-body</div>
      </DockablePanel>
    );

    const panel = document.querySelector('.dockable-panel');
    expect(panel?.classList.contains('dockable-panel--floating')).toBe(false);
    expect(document.querySelector('.dockable-panel__resize-zone')).toBeNull();

    unmount();
  });

  it('keeps a pending native transfer mounted without rendering its workspace surface', async () => {
    let revealPanel: (() => void) | undefined;
    const Host = () => {
      const [suppressed, setSuppressed] = React.useState(true);
      revealPanel = () => setSuppressed(false);
      return (
        <DockablePanel
          panelId="pending-native-panel"
          defaultPosition="floating"
          isOpen
          suppressSurface={suppressed}
        >
          <div>panel-body</div>
        </DockablePanel>
      );
    };

    const { unmount } = await renderPanel(<Host />);

    expect(document.querySelector('.dockable-panel')).toBeNull();

    act(() => {
      revealPanel?.();
    });

    expect(document.querySelector('.dockable-panel')).toBeTruthy();
    unmount();
  });

  it('uses native window geometry instead of docked inline dimensions in native mode', async () => {
    const { unmount } = await renderPanel(
      <DockablePanelProvider nativeWindowMode>
        <DockablePanel panelId="native-window-panel" defaultPosition="right" isOpen>
          <div>panel-body</div>
        </DockablePanel>
      </DockablePanelProvider>
    );

    const panel = document.querySelector('.dockable-panel') as HTMLElement | null;
    expect(panel?.style.inset).toBe('0px');
    expect(panel?.style.width).toBe('100%');
    expect(panel?.style.height).toBe('100%');
    expect(panel?.style.transform).toBe('none');

    unmount();
  });

  it('keeps Tab navigation contained within the panel once focus is inside it', async () => {
    const { unmount } = await renderPanel(
      <DockablePanel panelId="dockable-panel-tab-trap" defaultPosition="floating" isOpen>
        <button type="button">First control</button>
        <button type="button">Second control</button>
      </DockablePanel>
    );

    const layer = document.querySelector('.dockable-panel-layer');
    const panel = layer?.querySelector('.dockable-panel') as HTMLDivElement | null;
    expect(panel).toBeTruthy();

    const entryTarget = panel?.querySelector(
      '[aria-label="Dock panel to bottom"]'
    ) as HTMLButtonElement | null;
    await act(async () => {
      entryTarget?.focus();
      await Promise.resolve();
    });

    const tabbables = getTabbableElements(panel);
    const firstTabbable = tabbables[0];
    const lastTabbable = tabbables[tabbables.length - 1];
    expect(firstTabbable).toBeTruthy();
    expect(lastTabbable).toBeTruthy();

    await act(async () => {
      lastTabbable?.focus();
      lastTabbable?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(firstTabbable);
    expect(firstTabbable?.classList.contains('keyboard-programmatic-focus')).toBe(true);

    await act(async () => {
      firstTabbable?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(lastTabbable);

    unmount();
  });

  it('does not trap Tab for native tab regions inside the panel', async () => {
    const { unmount } = await renderPanel(
      <DockablePanel
        panelId="dockable-panel-native-tab-pass-through"
        defaultPosition="floating"
        isOpen
      >
        <div data-tab-native="true">
          <button type="button">Terminal input</button>
        </div>
        <button type="button">Other control</button>
      </DockablePanel>
    );

    const layer = document.querySelector('.dockable-panel-layer');
    const panel = layer?.querySelector('.dockable-panel') as HTMLDivElement | null;
    expect(panel).toBeTruthy();

    const terminalButton = Array.from(panel?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent === 'Terminal input'
    );
    expect(terminalButton).toBeTruthy();

    await act(async () => {
      terminalButton?.focus();
      await Promise.resolve();
    });

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      terminalButton?.dispatchEvent(event);
      await Promise.resolve();
    });

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(terminalButton);

    unmount();
  });

  it('keeps panel controls out of the native tab order until the panel is focused', async () => {
    const { unmount } = await renderPanel(
      <>
        <button type="button">Outside app control</button>
        <DockablePanel panelId="dockable-panel-native-tab-gate" defaultPosition="floating" isOpen>
          <button type="button">Panel body control</button>
        </DockablePanel>
      </>
    );

    const layer = document.querySelector('.dockable-panel-layer');
    const panel = layer?.querySelector('.dockable-panel') as HTMLDivElement | null;
    expect(panel).toBeTruthy();

    const closeButton = panel?.querySelector(
      '[aria-label="Close all tabs in this panel"]'
    ) as HTMLButtonElement | null;
    const bodyButton = Array.from(panel?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent === 'Panel body control'
    );

    expect(closeButton?.getAttribute('tabindex')).toBe('-1');
    expect(bodyButton?.getAttribute('tabindex')).toBe('-1');

    await act(async () => {
      closeButton?.focus();
      await Promise.resolve();
    });

    expect(closeButton?.getAttribute('tabindex')).toBeNull();
    expect(bodyButton?.getAttribute('tabindex')).toBeNull();

    unmount();
  });

  it('uses the grouped object-panel tab order from the visible active tab content', async () => {
    const ObjectPanelShell = ({
      panelId,
      title,
      tabPrefix,
      contentLabel,
    }: {
      panelId: string;
      title: string;
      tabPrefix: string;
      contentLabel: string;
    }) => (
      <DockablePanel
        panelId={panelId}
        title={title}
        defaultPosition="right"
        isOpen
        className="object-panel-dockable"
        contentClassName="object-panel-body"
      >
        <div className="object-panel-header">
          <span>{title} header</span>
        </div>
        <ObjectPanelTabs
          tabs={[
            { id: 'details', label: `${tabPrefix} Details` },
            { id: 'logs', label: `${tabPrefix} Logs` },
          ]}
          activeTab="details"
          onSelect={() => undefined}
        />
        <div className="object-panel-content">
          <button type="button">{contentLabel}</button>
        </div>
      </DockablePanel>
    );

    const { unmount } = await renderPanel(
      <>
        <ObjectPanelShell
          panelId="grouped-object-panel-a"
          title="Panel A"
          tabPrefix="A"
          contentLabel="Content A"
        />
        <ObjectPanelShell
          panelId="grouped-object-panel-b"
          title="Panel B"
          tabPrefix="B"
          contentLabel="Content B"
        />
      </>
    );

    const groupedTabs = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.dockable-panel__header .dockable-tab-bar-shell [role="tab"]'
      )
    );
    expect(groupedTabs).toHaveLength(2);

    const secondGroupedTab =
      groupedTabs.find((tab) => tab.textContent?.includes('Panel B')) ?? null;
    expect(secondGroupedTab).toBeTruthy();

    await act(async () => {
      secondGroupedTab?.click();
      await Promise.resolve();
    });

    expect(getVisiblePanelSection('.object-panel-body')?.textContent).toContain('Content B');

    await act(async () => {
      secondGroupedTab?.focus();
      secondGroupedTab?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });

    expect(document.activeElement).toBe(
      secondGroupedTab?.parentElement?.querySelector('.tab-item__close')
    );
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      )
    );
    expect(document.activeElement?.textContent).toContain('B Details');

    await act(async () => {
      (document.activeElement as HTMLElement | null)?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });

    expect(document.activeElement?.textContent).toContain('B Logs');

    await act(async () => {
      (document.activeElement as HTMLElement | null)?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });

    expect((document.activeElement as HTMLElement | null)?.textContent).toContain('Content B');

    await act(async () => {
      (document.activeElement as HTMLElement | null)?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      );
      await Promise.resolve();
    });

    expect((document.activeElement as HTMLElement | null)?.getAttribute('aria-label')).toBe(
      'Dock panel to bottom'
    );

    unmount();
  });
});
