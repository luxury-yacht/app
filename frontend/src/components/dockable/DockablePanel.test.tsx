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

import DockablePanel from './DockablePanel';
import { DockablePanelProvider } from './DockablePanelProvider';
import { ZoomProvider } from '@core/contexts/ZoomContext';

vi.mock('@wailsjs/go/backend/App', () => ({
  GetZoomLevel: vi.fn().mockResolvedValue(100),
  SetZoomLevel: vi.fn().mockResolvedValue(undefined),
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
        <ZoomProvider>{ui}</ZoomProvider>
      ) : (
        <DockablePanelProvider>
          <ZoomProvider>{ui}</ZoomProvider>
        </DockablePanelProvider>
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

    const closeButton = layer!.querySelector('[aria-label="Close panel"]') as HTMLButtonElement;
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
});
