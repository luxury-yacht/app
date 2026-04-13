/**
 * frontend/src/components/dockable/DockablePanel.test.tsx
 *
 * Test suite for DockablePanel.
 * Covers key behaviors and edge cases for DockablePanel.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getTabbableElements } from '@shared/components/modals/getTabbableElements';
import { KeyboardProvider } from '@ui/shortcuts/context';

import DockablePanel from './DockablePanel';
import { DockablePanelProvider } from './DockablePanelProvider';
import { ZoomProvider } from '@core/contexts/ZoomContext';

vi.mock('@wailsjs/go/backend/App', () => ({
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
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.querySelectorAll('.dockable-panel-layer').forEach((node) => node.remove());
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

    const closeButton = layer!.querySelector(
      '[aria-label="Close all tabs in this panel"]'
    ) as HTMLButtonElement;
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

    const dockRightButton = layer!.querySelector(
      '[aria-label="Dock panel to right side"]'
    ) as HTMLButtonElement;
    expect(dockRightButton).toBeTruthy();

    act(() => {
      dockRightButton.click();
    });

    expect(onPositionChange).toHaveBeenCalledWith('right');

    const panelElement = layer!.querySelector('.dockable-panel');
    expect(panelElement).toBeTruthy();
    expect(panelElement!.className).toMatch(/dockable-panel--right/);

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
        <div aria-label="Object Panel Tabs">
          <div role="tab" tabIndex={-1}>
            {tabPrefix} Details
          </div>
          <div role="tab" tabIndex={-1}>
            {tabPrefix} Logs
          </div>
        </div>
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
