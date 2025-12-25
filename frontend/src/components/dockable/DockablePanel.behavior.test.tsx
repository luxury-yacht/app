/**
 * frontend/src/components/dockable/DockablePanel.behavior.test.tsx
 *
 * Test suite for DockablePanel.behavior.
 * Covers key behaviors and edge cases for DockablePanel.behavior.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import DockablePanel from './DockablePanel';
import { getAllPanelStates, restorePanelStates, type DockPosition } from './useDockablePanelState';

const removePanelLayers = () => {
  document.querySelectorAll('.dockable-panel-layer').forEach((node) => node.remove());
};

const renderPanel = async (element: React.ReactElement) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = ReactDOM.createRoot(host);

  await act(async () => {
    root.render(element);
    await Promise.resolve();
  });

  return {
    host,
    rerender: async (nextElement: React.ReactElement) => {
      await act(async () => {
        root.render(nextElement);
        await Promise.resolve();
      });
    },
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
};

describe('DockablePanel behaviour (real hook)', () => {
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    restorePanelStates({});
    vi.useRealTimers();
  });

  afterEach(() => {
    removePanelLayers();
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: originalInnerWidth,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: originalInnerHeight,
    });
    vi.useRealTimers();
  });

  const getPanelState = (panelId: string) => {
    const states = getAllPanelStates();
    const state = states[panelId];
    if (!state) {
      throw new Error(`Panel state for "${panelId}" not found`);
    }
    return state;
  };

  const flushEffects = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  it('initializes panel state with provided defaults', async () => {
    const { unmount } = await renderPanel(
      <DockablePanel
        panelId="panel-init"
        defaultPosition="bottom"
        defaultSize={{ width: 480, height: 260 }}
        isOpen
      >
        <div>panel</div>
      </DockablePanel>
    );

    await flushEffects();

    const state = getPanelState('panel-init');
    expect(state.position).toBe('bottom');
    expect(state.bottomSize.height).toBe(260);
    expect(state.rightSize.width).toBe(480);
    expect(state.isOpen).toBe(true);

    await unmount();
  });

  it('syncs controlled isOpen changes with the dock state', async () => {
    let setVisibility: ((value: boolean) => void) | undefined;
    const Host: React.FC = () => {
      const [open, setOpen] = React.useState(true);
      React.useEffect(() => {
        setVisibility = setOpen;
      }, []);
      return (
        <DockablePanel panelId="panel-controlled" isOpen={open}>
          <div>panel</div>
        </DockablePanel>
      );
    };

    const { unmount } = await renderPanel(<Host />);
    await flushEffects();
    expect(getPanelState('panel-controlled').isOpen).toBe(true);

    await act(async () => {
      setVisibility?.(false);
      await Promise.resolve();
    });
    expect(getPanelState('panel-controlled').isOpen).toBe(false);

    await unmount();
  });

  it('resizes a right-docked panel when dragging the left handle', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1280,
    });
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    const { unmount } = await renderPanel(
      <DockablePanel panelId="panel-right" defaultPosition="right" isOpen>
        <div>panel</div>
      </DockablePanel>
    );

    await flushEffects();
    const initialWidth = getPanelState('panel-right').rightSize.width;

    const resizeHandle = document.querySelector(
      '.dockable-panel__resize-handle--left'
    ) as HTMLDivElement | null;
    expect(resizeHandle).toBeTruthy();

    await act(async () => {
      resizeHandle!.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, clientX: 600, clientY: 200 })
      );
    });
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 500, clientY: 200 })
      );
    });
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    await flushEffects();
    const widths = getPanelState('panel-right');
    expect(widths.rightSize.width).toBeGreaterThan(initialWidth);

    rafSpy.mockRestore();
    cafSpy.mockRestore();
    await unmount();
  });

  it('maximizes within the content body and restores previous layout', async () => {
    const contentBody = document.createElement('div');
    contentBody.className = 'content-body';
    contentBody.style.position = 'absolute';
    contentBody.style.top = '42px';
    contentBody.style.left = '120px';
    contentBody.style.width = '800px';
    contentBody.style.height = '600px';
    document.body.appendChild(contentBody);

    const onMaximizeChange = vi.fn();
    const { unmount } = await renderPanel(
      <DockablePanel
        panelId="panel-maximize"
        defaultPosition="right"
        defaultSize={{ width: 420, height: 500 }}
        allowMaximize
        maximizeTargetSelector=".content-body"
        onMaximizeChange={onMaximizeChange}
        isOpen
      >
        <div>panel</div>
      </DockablePanel>
    );

    await flushEffects();
    const maximizeBtn = document.querySelector(
      '[aria-label="Maximize panel"]'
    ) as HTMLButtonElement | null;
    expect(maximizeBtn).toBeTruthy();

    await act(async () => {
      maximizeBtn?.click();
    });
    await flushEffects();
    const maximized = document.querySelector('.dockable-panel--maximized') as HTMLDivElement | null;
    expect(maximized).toBeTruthy();
    expect(onMaximizeChange).toHaveBeenCalledWith(true);
    const rect = maximized?.getBoundingClientRect();
    expect(rect?.top).toBeCloseTo(contentBody.getBoundingClientRect().top);
    expect(rect?.left).toBeCloseTo(contentBody.getBoundingClientRect().left);
    expect(rect?.width).toBeCloseTo(contentBody.getBoundingClientRect().width);
    expect(rect?.height).toBeCloseTo(contentBody.getBoundingClientRect().height);
    expect(maximized?.querySelector('.dockable-panel__resize-handle')).toBeNull();

    const stateBeforeRestore = getPanelState('panel-maximize');
    expect(stateBeforeRestore.position).toBe('right');

    const restoreBtn = document.querySelector(
      '[aria-label="Restore panel size"]'
    ) as HTMLButtonElement | null;
    expect(restoreBtn).toBeTruthy();

    await act(async () => {
      restoreBtn?.click();
    });
    await flushEffects();
    expect(document.querySelector('.dockable-panel--maximized')).toBeNull();
    expect(getPanelState('panel-maximize').position).toBe('right');
    expect(onMaximizeChange).toHaveBeenCalledWith(false);

    await unmount();
    contentBody.remove();
  });

  it('clamps bottom-docked height based on window resize bounds', async () => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 380,
    });

    const { unmount } = await renderPanel(
      <DockablePanel
        panelId="panel-bottom"
        defaultPosition="bottom"
        defaultSize={{ height: 360 }}
        minHeight={280}
        maxHeight={260}
        isOpen
      >
        <div>panel</div>
      </DockablePanel>
    );

    await flushEffects();

    await act(async () => {
      window.dispatchEvent(new Event('resize'));
      vi.runAllTimers();
    });
    await flushEffects();

    const bottomState = getPanelState('panel-bottom');
    expect(bottomState.bottomSize.height).toBe(window.innerHeight - 150);

    await unmount();
  });

  it('emits onPositionChange when docking is toggled', async () => {
    const onPositionChange = vi.fn();

    const { unmount } = await renderPanel(
      <DockablePanel
        panelId="panel-position"
        defaultPosition="floating"
        onPositionChange={onPositionChange}
      >
        <div>panel</div>
      </DockablePanel>
    );

    await flushEffects();
    const initialCall = onPositionChange.mock.calls[onPositionChange.mock.calls.length - 1]?.[0];
    expect(initialCall).toBe('floating');

    const dockRightButton = document.querySelector(
      "[aria-label='Dock panel to right side']"
    ) as HTMLButtonElement | null;
    expect(dockRightButton).toBeTruthy();

    await act(async () => {
      dockRightButton!.click();
      await Promise.resolve();
    });

    await flushEffects();
    const finalCall = onPositionChange.mock.calls[onPositionChange.mock.calls.length - 1]?.[0];
    expect(finalCall).toBe('right');
    expect(getPanelState('panel-position').position).toBe<DockPosition>('right');

    await unmount();
  });

  it('keeps child components mounted while switching between docked and floating states', async () => {
    const mountTracker = vi.fn();
    const Child: React.FC = () => {
      React.useEffect(() => {
        mountTracker('mount');
        return () => mountTracker('unmount');
      }, []);
      return <div data-testid="panel-child">child</div>;
    };

    const { unmount } = await renderPanel(
      <DockablePanel panelId="panel-mount-stability" defaultPosition="right" isOpen>
        <Child />
      </DockablePanel>
    );

    await flushEffects();
    expect(mountTracker).toHaveBeenCalledTimes(1);
    expect(mountTracker).toHaveBeenCalledWith('mount');

    const dockBottomButtonWhileRight = document.querySelector(
      "[aria-label='Dock panel to bottom']"
    ) as HTMLButtonElement | null;
    expect(dockBottomButtonWhileRight).toBeTruthy();

    await act(async () => {
      dockBottomButtonWhileRight!.click();
      await Promise.resolve();
    });
    await flushEffects();
    expect(getPanelState('panel-mount-stability').position).toBe<DockPosition>('bottom');

    const floatButtonWhileBottom = document.querySelector(
      "[aria-label='Undock panel to floating window']"
    ) as HTMLButtonElement | null;
    expect(floatButtonWhileBottom).toBeTruthy();

    await act(async () => {
      floatButtonWhileBottom!.click();
      await Promise.resolve();
    });
    await flushEffects();
    expect(getPanelState('panel-mount-stability').position).toBe<DockPosition>('floating');

    expect(mountTracker).toHaveBeenCalledTimes(1);
    expect(mountTracker).not.toHaveBeenCalledWith('unmount');

    await unmount();
    expect(mountTracker).toHaveBeenLastCalledWith('unmount');
  });

  it('updates floating position when dragging the panel header', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1400,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 900,
    });
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    const { unmount } = await renderPanel(
      <DockablePanel panelId="panel-drag" defaultPosition="floating" isOpen>
        <div>panel</div>
      </DockablePanel>
    );

    await flushEffects();
    const panelElement = document.querySelector('.dockable-panel') as HTMLDivElement | null;
    expect(panelElement).toBeTruthy();

    Object.defineProperty(panelElement!, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 300,
        top: 180,
        width: 500,
        height: 320,
        right: 800,
        bottom: 500,
      }),
    });

    const header = document.querySelector('.dockable-panel__header') as HTMLDivElement | null;
    expect(header).toBeTruthy();

    await act(async () => {
      header!.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, clientX: 350, clientY: 220 })
      );
    });
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 720, clientY: 520 })
      );
    });
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    await flushEffects();
    const floatingState = getPanelState('panel-drag').floatingPosition;
    expect(floatingState.x).toBeGreaterThan(300);
    expect(floatingState.y).toBeGreaterThan(180);

    rafSpy.mockRestore();
    cafSpy.mockRestore();
    await unmount();
  });

  it('resizes floating panel from the east edge', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1400,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 900,
    });
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    const cafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    const { unmount } = await renderPanel(
      <DockablePanel panelId="panel-floating-resize" defaultPosition="floating" isOpen>
        <div>panel</div>
      </DockablePanel>
    );

    await flushEffects();
    const initialWidth = getPanelState('panel-floating-resize').floatingSize.width;

    const resizeZone = document.querySelector(
      '.dockable-panel__resize-zone--right'
    ) as HTMLDivElement | null;
    expect(resizeZone).toBeTruthy();

    await act(async () => {
      resizeZone!.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, clientX: 800, clientY: 320 })
      );
    });
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 900, clientY: 320 })
      );
    });
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    await flushEffects();
    const width = getPanelState('panel-floating-resize').floatingSize.width;
    expect(width).toBeGreaterThan(initialWidth);

    rafSpy.mockRestore();
    cafSpy.mockRestore();
    await unmount();
  });
  it('closes the panel when the close button is clicked', async () => {
    const Host: React.FC = () => {
      const [open, setOpen] = React.useState(true);
      return (
        <DockablePanel
          panelId="panel-close"
          defaultPosition="right"
          isOpen={open}
          onClose={() => setOpen(false)}
        >
          <div>panel</div>
        </DockablePanel>
      );
    };

    const { unmount } = await renderPanel(<Host />);

    await flushEffects();

    const closeButton = document.querySelector(
      "[aria-label='Close panel']"
    ) as HTMLButtonElement | null;
    expect(closeButton).toBeTruthy();

    await act(async () => {
      closeButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    await flushEffects();
    expect(getPanelState('panel-close').isOpen).toBe(false);

    await unmount();
  });

  it('docks a floating panel to the bottom via the control button', async () => {
    const { unmount } = await renderPanel(
      <DockablePanel panelId="panel-dock-bottom" defaultPosition="floating" isOpen>
        <div>panel</div>
      </DockablePanel>
    );

    await flushEffects();

    const portal = document.querySelector('.dockable-panel-layer') as HTMLDivElement | null;
    expect(portal).toBeTruthy();

    const dockBottomButton = portal!.querySelector(
      "[aria-label='Dock panel to bottom']"
    ) as HTMLButtonElement | null;
    expect(dockBottomButton).toBeTruthy();

    await act(async () => {
      dockBottomButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await Promise.resolve();
    });

    await flushEffects();
    expect(getPanelState('panel-dock-bottom').position).toBe<DockPosition>('bottom');

    await unmount();
  });

  it('falls back to synchronous updates when requestAnimationFrame is unavailable', async () => {
    const originalRAF = window.requestAnimationFrame;
    const originalCAF = window.cancelAnimationFrame;
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      writable: true,
      value: undefined,
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    const { unmount } = await renderPanel(
      <DockablePanel panelId="panel-raf-fallback" defaultPosition="floating" isOpen>
        <div>panel</div>
      </DockablePanel>
    );

    await flushEffects();

    const panelElement = document.querySelector('.dockable-panel') as HTMLDivElement | null;
    expect(panelElement).toBeTruthy();

    Object.defineProperty(panelElement!, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 200, top: 160, width: 400, height: 280, right: 600, bottom: 440 }),
    });

    const header = document.querySelector('.dockable-panel__header') as HTMLDivElement | null;
    expect(header).toBeTruthy();

    await act(async () => {
      header!.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, clientX: 240, clientY: 180 })
      );
    });
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 400, clientY: 340 })
      );
    });
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    const position = getPanelState('panel-raf-fallback').floatingPosition;
    expect(position.x).toBeGreaterThan(200);
    expect(position.y).toBeGreaterThan(160);

    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      writable: true,
      value: originalRAF,
    });
    Object.defineProperty(window, 'cancelAnimationFrame', {
      configurable: true,
      writable: true,
      value: originalCAF,
    });

    await unmount();
  });

  it('resizes a bottom-docked panel when dragging the top handle', async () => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 600,
    });

    const { unmount } = await renderPanel(
      <DockablePanel panelId="panel-bottom-resize" defaultPosition="bottom" isOpen>
        <div>panel</div>
      </DockablePanel>
    );

    await flushEffects();
    const initialHeight = getPanelState('panel-bottom-resize').bottomSize.height;

    const resizeHandle = document.querySelector(
      '.dockable-panel__resize-handle--top'
    ) as HTMLDivElement | null;
    expect(resizeHandle).toBeTruthy();

    await act(async () => {
      resizeHandle!.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, clientX: 400, clientY: 400 })
      );
    });
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 400, clientY: 250 })
      );
    });
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    await flushEffects();
    expect(getPanelState('panel-bottom-resize').bottomSize.height).not.toBe(initialHeight);

    await unmount();
  });

  it('resizes a floating panel from the bottom-right corner', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1400,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 900,
    });

    const { unmount } = await renderPanel(
      <DockablePanel panelId="panel-floating-corner" defaultPosition="floating" isOpen>
        <div>panel</div>
      </DockablePanel>
    );

    await flushEffects();
    const portal = document.querySelector('.dockable-panel-layer') as HTMLDivElement | null;
    expect(portal).toBeTruthy();

    const initialSize = getPanelState('panel-floating-corner').floatingSize;

    const cornerZone = portal!.querySelector(
      '.dockable-panel__resize-zone--bottom-right'
    ) as HTMLDivElement | null;
    expect(cornerZone).toBeTruthy();

    await act(async () => {
      cornerZone!.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, clientX: 800, clientY: 500 })
      );
    });
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 900, clientY: 640 })
      );
    });
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    await flushEffects();
    const updatedSize = getPanelState('panel-floating-corner').floatingSize;
    expect(updatedSize.width).toBeGreaterThan(initialSize.width);
    expect(updatedSize.height).toBeGreaterThan(initialSize.height);

    await unmount();
  });

  it('logs an error and renders nothing when panelId is missing', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { unmount } = await renderPanel(
      <DockablePanel panelId={'' as unknown as string}>
        <div>panel</div>
      </DockablePanel>
    );

    await flushEffects();
    expect(errorSpy).toHaveBeenCalledWith('DockablePanel: panelId prop is required');

    await unmount();
    errorSpy.mockRestore();
  });

  it('closes other panels docked on the same side before docking a new panel', async () => {
    const { unmount } = await renderPanel(
      <div>
        <DockablePanel panelId="panel-side-a" defaultPosition="right" isOpen>
          <div>panel A</div>
        </DockablePanel>
        <DockablePanel panelId="panel-side-b" defaultPosition="floating" isOpen>
          <div>panel B</div>
        </DockablePanel>
      </div>
    );

    await flushEffects();

    const floatingPanel = document.querySelector(
      '.dockable-panel--floating'
    ) as HTMLDivElement | null;
    expect(floatingPanel).toBeTruthy();
    const dockRightButton = floatingPanel?.querySelector(
      'button[aria-label="Dock panel to right side"]'
    ) as HTMLButtonElement | null;
    expect(dockRightButton).toBeTruthy();

    await act(async () => {
      dockRightButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await flushEffects();

    expect(getPanelState('panel-side-a').isOpen).toBe(false);
    expect(getPanelState('panel-side-b').position).toBe('right');
    expect(getPanelState('panel-side-b').isOpen).toBe(true);

    await unmount();
  });

  it('allows multiple floating panels to remain open simultaneously', async () => {
    const { unmount } = await renderPanel(
      <div>
        <DockablePanel panelId="panel-floating-a" defaultPosition="floating" isOpen>
          <div>panel A</div>
        </DockablePanel>
        <DockablePanel panelId="panel-floating-b" defaultPosition="floating" isOpen>
          <div>panel B</div>
        </DockablePanel>
      </div>
    );

    await flushEffects();

    expect(getPanelState('panel-floating-a').isOpen).toBe(true);
    expect(getPanelState('panel-floating-b').isOpen).toBe(true);

    await unmount();
  });

  it('keeps only the most recently opened panel docked on the bottom edge', async () => {
    const { unmount } = await renderPanel(
      <div>
        <DockablePanel panelId="panel-bottom-a" defaultPosition="bottom" isOpen>
          <div>panel A</div>
        </DockablePanel>
        <DockablePanel panelId="panel-bottom-b" defaultPosition="bottom" isOpen>
          <div>panel B</div>
        </DockablePanel>
      </div>
    );

    await flushEffects();

    expect(getPanelState('panel-bottom-a').isOpen).toBe(false);
    expect(getPanelState('panel-bottom-a').position).toBe('bottom');
    expect(getPanelState('panel-bottom-b').isOpen).toBe(true);
    expect(getPanelState('panel-bottom-b').position).toBe('bottom');

    await unmount();
  });

  it('closes an existing bottom-docked panel when a controlled panel opens there', async () => {
    const Host: React.FC<{ diagnosticsOpen: boolean }> = ({ diagnosticsOpen }) => (
      <>
        <DockablePanel panelId="panel-bottom-existing" defaultPosition="bottom" isOpen>
          <div>Existing</div>
        </DockablePanel>
        <DockablePanel
          panelId="panel-bottom-controlled"
          defaultPosition="bottom"
          isOpen={diagnosticsOpen}
        >
          <div>Diagnostics</div>
        </DockablePanel>
      </>
    );

    const { rerender, unmount } = await renderPanel(<Host diagnosticsOpen={false} />);

    await flushEffects();
    expect(getPanelState('panel-bottom-existing').isOpen).toBe(true);
    expect(getPanelState('panel-bottom-controlled').isOpen).toBe(false);

    await rerender(<Host diagnosticsOpen />);
    await flushEffects();

    expect(getPanelState('panel-bottom-existing').isOpen).toBe(false);
    expect(getPanelState('panel-bottom-controlled').isOpen).toBe(true);

    await unmount();
  });

  it('resizes a floating panel from the top edge', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1400,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 900,
    });

    const { unmount } = await renderPanel(
      <DockablePanel panelId="panel-floating-top" defaultPosition="floating" isOpen>
        <div>panel</div>
      </DockablePanel>
    );

    await flushEffects();
    const portal = document.querySelector('.dockable-panel-layer') as HTMLDivElement | null;
    expect(portal).toBeTruthy();

    const initialSize = getPanelState('panel-floating-top').floatingSize;

    const topZone = portal!.querySelector(
      '.dockable-panel__resize-zone--top'
    ) as HTMLDivElement | null;
    expect(topZone).toBeTruthy();

    await act(async () => {
      topZone!.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, clientX: 350, clientY: 200 })
      );
    });
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 350, clientY: 120 })
      );
    });
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    await flushEffects();
    const updatedSize = getPanelState('panel-floating-top').floatingSize;
    expect(updatedSize.height).not.toBe(initialSize.height);

    await unmount();
  });

  it('resizes a floating panel from the left edge', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1400,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 900,
    });

    const { unmount } = await renderPanel(
      <DockablePanel panelId="panel-floating-left" defaultPosition="floating" isOpen>
        <div>panel</div>
      </DockablePanel>
    );

    await flushEffects();
    const portal = document.querySelector('.dockable-panel-layer') as HTMLDivElement | null;
    expect(portal).toBeTruthy();

    const initialSize = getPanelState('panel-floating-left').floatingSize;

    const leftZone = portal!.querySelector(
      '.dockable-panel__resize-zone--left'
    ) as HTMLDivElement | null;
    expect(leftZone).toBeTruthy();

    await act(async () => {
      leftZone!.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, clientX: 200, clientY: 300 })
      );
    });
    await act(async () => {
      document.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 100, clientY: 300 })
      );
    });
    await act(async () => {
      document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });

    await flushEffects();
    const updatedSize = getPanelState('panel-floating-left').floatingSize;
    expect(updatedSize.width).not.toBe(initialSize.width);

    await unmount();
  });
});
