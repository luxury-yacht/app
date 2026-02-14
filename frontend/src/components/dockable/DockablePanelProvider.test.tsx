/**
 * frontend/src/components/dockable/DockablePanelProvider.test.tsx
 *
 * Test suite for DockablePanelProvider.
 * Covers key behaviors and edge cases for DockablePanelProvider.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { DockablePanelProvider, useDockablePanelContext } from './DockablePanelProvider';

const render = async (element: React.ReactElement) => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = ReactDOM.createRoot(container);

  await act(async () => {
    root.render(element);
    await Promise.resolve();
  });

  return {
    container,
    unmount: async () => {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    },
  };
};

describe('DockablePanelProvider', () => {
  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    // Create a .content element so the panel host can be appended inside it.
    const contentEl = document.createElement('div');
    contentEl.className = 'content';
    document.body.appendChild(contentEl);
  });

  afterEach(() => {
    // Clean up all children from body
    while (document.body.firstChild) {
      document.body.removeChild(document.body.firstChild);
    }
    document.documentElement.style.removeProperty('--dock-right-offset');
    document.documentElement.style.removeProperty('--dock-bottom-offset');
  });

  it('provides no-op defaults when used without a provider', () => {
    const TestConsumer: React.FC = () => {
      const ctx = useDockablePanelContext();
      expect(ctx.dockedPanels).toEqual({ right: [], bottom: [] });
      expect(ctx.getAdjustedDimensions()).toEqual({ rightOffset: 0, bottomOffset: 0 });
      ctx.registerPanel('test', 'right');
      ctx.unregisterPanel('test');
      return null;
    };

    void render(<TestConsumer />);
  });

  it('tracks registered panels and exposes adjusted dimensions', async () => {
    const contextRef: { current: ReturnType<typeof useDockablePanelContext> | null } = {
      current: null,
    };

    const Consumer: React.FC = () => {
      contextRef.current = useDockablePanelContext();
      return null;
    };

    const { unmount } = await render(
      <DockablePanelProvider>
        <Consumer />
      </DockablePanelProvider>
    );

    const ctx = contextRef.current!;
    expect(ctx.dockedPanels.right).toEqual([]);
    expect(ctx.getAdjustedDimensions()).toEqual({ rightOffset: 0, bottomOffset: 0 });

    await act(async () => {
      ctx.registerPanel('panel-right', 'right');
      await Promise.resolve();
    });
    expect(contextRef.current!.dockedPanels.right).toEqual(['panel-right']);
    expect(contextRef.current!.getAdjustedDimensions()).toEqual({
      rightOffset: 400,
      bottomOffset: 0,
    });
    // CSS variables (--dock-right-offset, --dock-bottom-offset) are set by
    // individual DockablePanel instances, not the provider.

    await act(async () => {
      contextRef.current!.registerPanel('panel-bottom', 'bottom');
      await Promise.resolve();
    });
    expect(contextRef.current!.dockedPanels.bottom).toEqual(['panel-bottom']);
    expect(contextRef.current!.getAdjustedDimensions()).toEqual({
      rightOffset: 400,
      bottomOffset: 300,
    });

    await act(async () => {
      contextRef.current!.unregisterPanel('panel-right');
      await Promise.resolve();
    });
    expect(contextRef.current!.dockedPanels.right).toEqual([]);

    await unmount();
  });

  it('creates a shared host layer inside .content', async () => {
    const { unmount } = await render(
      <DockablePanelProvider>
        <div data-testid="child">content</div>
      </DockablePanelProvider>
    );

    const layer = document.querySelector('.dockable-panel-layer') as HTMLDivElement | null;
    expect(layer).toBeTruthy();
    // The layer should be a child of .content, not document.body
    const contentEl = document.querySelector('.content');
    expect(contentEl?.contains(layer)).toBe(true);

    await unmount();
    expect(document.querySelector('.dockable-panel-layer')).toBeNull();
  });
});
