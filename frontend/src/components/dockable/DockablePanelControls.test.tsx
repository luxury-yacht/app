/**
 * frontend/src/components/dockable/DockablePanelControls.test.tsx
 *
 * Test suite for DockablePanelControls.
 * Covers key behaviors and edge cases for DockablePanelControls.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { DockablePanelControls } from './DockablePanelControls';

const renderControls = async (ui: React.ReactElement) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = ReactDOM.createRoot(host);

  await act(async () => {
    root.render(ui);
    await Promise.resolve();
  });

  return {
    host,
    root,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
};

describe('DockablePanelControls', () => {
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders floating controls and triggers dock callbacks', async () => {
    const onDock = vi.fn();
    const onToggleMaximize = vi.fn();
    const onClose = vi.fn();

    const { host, unmount } = await renderControls(
      <DockablePanelControls
        position="floating"
        isMaximized={false}
        allowMaximize={false}
        onDock={onDock}
        onToggleMaximize={onToggleMaximize}
        onClose={onClose}
      />
    );

    // Click each floating dock button to ensure the correct dock position is requested.
    const dockBottom = host.querySelector(
      '[aria-label="Dock panel to bottom"]'
    ) as HTMLButtonElement;
    const dockRight = host.querySelector(
      '[aria-label="Dock panel to right side"]'
    ) as HTMLButtonElement;
    expect(dockBottom).toBeTruthy();
    expect(dockRight).toBeTruthy();

    await act(async () => {
      dockBottom.click();
      dockRight.click();
    });

    expect(onDock).toHaveBeenCalledWith('bottom');
    expect(onDock).toHaveBeenCalledWith('right');

    await unmount();
  });

  it('renders right-docked controls and stops mouse down propagation', async () => {
    const onDock = vi.fn();
    const onToggleMaximize = vi.fn();
    const onClose = vi.fn();
    const parentMouseDown = vi.fn();

    const { host, unmount } = await renderControls(
      <div onMouseDown={parentMouseDown}>
        <DockablePanelControls
          position="right"
          isMaximized={false}
          allowMaximize={false}
          onDock={onDock}
          onToggleMaximize={onToggleMaximize}
          onClose={onClose}
        />
      </div>
    );

    // Ensure the controls container intercepts mouse down events.
    const controls = host.querySelector('.dockable-panel__controls') as HTMLDivElement;
    expect(controls).toBeTruthy();

    await act(async () => {
      controls.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    });

    expect(parentMouseDown).not.toHaveBeenCalled();

    const dockBottom = host.querySelector(
      '[aria-label="Dock panel to bottom"]'
    ) as HTMLButtonElement;
    const dockFloat = host.querySelector(
      '[aria-label="Undock panel to floating window"]'
    ) as HTMLButtonElement;
    expect(dockBottom).toBeTruthy();
    expect(dockFloat).toBeTruthy();

    await act(async () => {
      dockBottom.click();
      dockFloat.click();
    });

    expect(onDock).toHaveBeenCalledWith('bottom');
    expect(onDock).toHaveBeenCalledWith('floating');

    await unmount();
  });

  it('renders bottom-docked controls and toggles maximize/restore', async () => {
    const onDock = vi.fn();
    const onToggleMaximize = vi.fn();
    const onClose = vi.fn();

    const { host, root, unmount } = await renderControls(
      <DockablePanelControls
        position="bottom"
        isMaximized={false}
        allowMaximize
        onDock={onDock}
        onToggleMaximize={onToggleMaximize}
        onClose={onClose}
      />
    );

    // Verify bottom-docked controls and maximize button behavior.
    const dockRight = host.querySelector(
      '[aria-label="Dock panel to right side"]'
    ) as HTMLButtonElement;
    const dockFloat = host.querySelector(
      '[aria-label="Undock panel to floating window"]'
    ) as HTMLButtonElement;
    const maximize = host.querySelector('[aria-label="Maximize panel"]') as HTMLButtonElement;
    expect(dockRight).toBeTruthy();
    expect(dockFloat).toBeTruthy();
    expect(maximize).toBeTruthy();

    await act(async () => {
      dockRight.click();
      dockFloat.click();
      maximize.click();
    });

    expect(onDock).toHaveBeenCalledWith('right');
    expect(onDock).toHaveBeenCalledWith('floating');
    expect(onToggleMaximize).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(
        <DockablePanelControls
          position="bottom"
          isMaximized
          allowMaximize
          onDock={onDock}
          onToggleMaximize={onToggleMaximize}
          onClose={onClose}
        />
      );
      await Promise.resolve();
    });

    const restore = host.querySelector('[aria-label="Restore panel size"]') as HTMLButtonElement;
    expect(restore).toBeTruthy();

    await act(async () => {
      restore.click();
    });

    expect(onToggleMaximize).toHaveBeenCalledTimes(2);

    await unmount();
  });

  it('invokes the close callback', async () => {
    const onDock = vi.fn();
    const onToggleMaximize = vi.fn();
    const onClose = vi.fn();

    const { host, unmount } = await renderControls(
      <DockablePanelControls
        position="floating"
        isMaximized={false}
        allowMaximize={false}
        onDock={onDock}
        onToggleMaximize={onToggleMaximize}
        onClose={onClose}
      />
    );

    // Click the close control to verify the callback wiring.
    const closeButton = host.querySelector('[aria-label="Close panel"]') as HTMLButtonElement;
    expect(closeButton).toBeTruthy();

    await act(async () => {
      closeButton.click();
    });

    expect(onClose).toHaveBeenCalledTimes(1);

    await unmount();
  });
});
