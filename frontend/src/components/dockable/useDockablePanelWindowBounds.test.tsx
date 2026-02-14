/**
 * frontend/src/components/dockable/useDockablePanelWindowBounds.test.tsx
 *
 * Test suite for useDockablePanelWindowBounds.
 * Covers key behaviors and edge cases for useDockablePanelWindowBounds.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { useWindowBoundsConstraint } from './useDockablePanelWindowBounds';
import { ZoomProvider } from '@core/contexts/ZoomContext';

vi.mock('@wailsjs/go/backend/App', () => ({
  GetZoomLevel: vi.fn().mockResolvedValue(100),
  SetZoomLevel: vi.fn().mockResolvedValue(undefined),
}));

interface PanelStateOptions {
  position: 'floating' | 'right' | 'bottom';
  size: { width: number; height: number };
  floatingPosition: { x: number; y: number };
}

const Harness: React.FC<{
  panelState: {
    position: 'floating' | 'right' | 'bottom';
    size: { width: number; height: number };
    floatingPosition: { x: number; y: number };
    isOpen: boolean;
    setSize: (size: { width: number; height: number }) => void;
    setFloatingPosition: (pos: { x: number; y: number }) => void;
  };
  options: {
    minWidth: number;
    minHeight: number;
    isResizing: boolean;
    isMaximized: boolean;
  };
}> = ({ panelState, options }) => {
  useWindowBoundsConstraint(panelState, options);
  return null;
};

const renderHarness = async (panelState: any, options: any) => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = ReactDOM.createRoot(host);

  await act(async () => {
    root.render(
      <ZoomProvider>
        <Harness panelState={panelState} options={options} />
      </ZoomProvider>
    );
    await Promise.resolve();
  });

  return {
    host,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
};

describe('useWindowBoundsConstraint', () => {
  const originalInnerWidth = window.innerWidth;
  const originalInnerHeight = window.innerHeight;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
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
    // Clean up all children from body
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
  });

  const createPanelState = (overrides: Partial<PanelStateOptions>) => {
    const defaults: PanelStateOptions = {
      position: 'floating',
      size: { width: 400, height: 300 },
      floatingPosition: { x: 100, y: 100 },
    };
    return {
      ...defaults,
      ...overrides,
      isOpen: true,
      setSize: vi.fn(),
      setFloatingPosition: vi.fn(),
    };
  };

  it('constrains floating size and position within window bounds', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 800,
    });
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 600,
    });

    const panelState = createPanelState({
      position: 'floating',
      size: { width: 900, height: 700 },
      floatingPosition: { x: -20, y: -10 },
    });

    const { unmount } = await renderHarness(panelState, {
      minWidth: 200,
      minHeight: 150,
      isResizing: false,
      isMaximized: false,
    });

    // Flush the debounce timer chain to apply the constraint updates.
    act(() => {
      vi.runAllTimers();
    });

    expect(panelState.setSize).toHaveBeenCalledWith({ width: 700, height: 500 });
    expect(panelState.setFloatingPosition).toHaveBeenCalledWith({ x: 50, y: 50 });

    await unmount();
  });

  it('constrains right-docked width within the available window space', async () => {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 1000,
    });

    const panelState = createPanelState({
      position: 'right',
      size: { width: 1200, height: 320 },
    });

    const { unmount } = await renderHarness(panelState, {
      minWidth: 600,
      minHeight: 150,
      isResizing: false,
      isMaximized: false,
    });

    act(() => {
      vi.runAllTimers();
    });

    // maxWidth = content.width (falls back to window.innerWidth = 1000 in JSDOM)
    expect(panelState.setSize).toHaveBeenCalledWith({ width: 1000, height: 320 });

    await unmount();
  });

  it('constrains bottom-docked height within the available window space', async () => {
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 800,
    });

    const panelState = createPanelState({
      position: 'bottom',
      size: { width: 360, height: 900 },
    });

    const { unmount } = await renderHarness(panelState, {
      minWidth: 200,
      minHeight: 150,
      isResizing: false,
      isMaximized: false,
    });

    act(() => {
      vi.runAllTimers();
    });

    // maxHeight = content.height (falls back to window.innerHeight = 800 in JSDOM)
    expect(panelState.setSize).toHaveBeenCalledWith({ width: 360, height: 800 });

    await unmount();
  });
});
