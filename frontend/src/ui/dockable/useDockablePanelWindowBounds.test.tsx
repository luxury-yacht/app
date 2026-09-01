/**
 * frontend/src/components/dockable/useDockablePanelWindowBounds.test.tsx
 *
 * Test suite for useDockablePanelWindowBounds.
 * Covers key behaviors and edge cases for useDockablePanelWindowBounds.
 */

import { ZoomProvider } from '@core/contexts/ZoomContext';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWindowBoundsConstraint } from './useDockablePanelWindowBounds';

vi.mock('@core/backend-api', () => ({
  GetZoomLevel: vi.fn().mockResolvedValue(100),
  SetZoomLevel: vi.fn().mockResolvedValue(undefined),
}));

interface PanelStateOptions {
  position: 'floating' | 'right' | 'bottom';
  size: { width: number; height: number };
}

const Harness: React.FC<{
  panelState: {
    position: 'floating' | 'right' | 'bottom';
    size: { width: number; height: number };
    isOpen: boolean;
    setSize: (size: { width: number; height: number }) => void;
  };
  options: {
    minWidth: number;
    isResizing: boolean;
    isMaximized: boolean;
  };
}> = ({ panelState, options }) => {
  useWindowBoundsConstraint(panelState, options);
  return null;
};

const renderHarness = async (
  panelState: React.ComponentProps<typeof Harness>['panelState'],
  options: React.ComponentProps<typeof Harness>['options']
) => {
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
      position: 'right',
      size: { width: 400, height: 300 },
    };
    return {
      ...defaults,
      ...overrides,
      isOpen: true,
      setSize: vi.fn(),
    };
  };

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
