import { ZoomProvider } from '@core/contexts/ZoomContext';
import { KeyboardProvider } from '@ui/shortcuts/context';
import type React from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DockablePanel from './DockablePanel';
import { DockablePanelProvider } from './DockablePanelProvider';
import { createPanelLayoutStore, setActivePanelLayoutStore } from './panelLayoutStore';
import { getAllPanelStates } from './useDockablePanelState';

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
  const content = document.createElement('div');
  content.className = 'content';
  const body = document.createElement('div');
  body.className = 'content-body';
  content.appendChild(body);
  content.getBoundingClientRect = () =>
    DOMRect.fromRect({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });
  document.body.appendChild(content);
};

const renderPanel = async (element: React.ReactElement) => {
  ensureContentElement();
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = ReactDOM.createRoot(host);

  await act(async () => {
    root.render(
      <KeyboardProvider>
        <DockablePanelProvider>
          <ZoomProvider>{element}</ZoomProvider>
        </DockablePanelProvider>
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
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1200 });
    const unmount = await renderPanel(
      <DockablePanel panelId="panel-right" defaultPosition="right" isOpen>
        <div>panel</div>
      </DockablePanel>
    );
    const initialWidth = panelState('panel-right').rightSize.width;
    const handle = document.querySelector<HTMLElement>('[aria-label="Resize panel width"]');

    await act(async () => {
      handle?.dispatchEvent(
        new MouseEvent('mousedown', { bubbles: true, clientX: 700, clientY: 200 })
      );
      await Promise.resolve();
    });
    expect(document.body.classList.contains('dockable-panel-resizing-w')).toBe(true);
    await act(async () => {
      window.dispatchEvent(
        new MouseEvent('mousemove', { bubbles: true, clientX: 620, clientY: 200 })
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
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 });
    const unmount = await renderPanel(
      <DockablePanel panelId="panel-bottom" defaultPosition="bottom" isOpen>
        <div>panel</div>
      </DockablePanel>
    );
    const initialHeight = panelState('panel-bottom').bottomSize.height;
    const handle = document.querySelector<HTMLElement>('[aria-label="Resize panel height"]');

    await act(async () => {
      handle?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
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
});
