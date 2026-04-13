import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardProvider } from '@ui/shortcuts/context';
import {
  __resetTopLevelAppRegionTrackingForTests,
  useTopLevelAppRegionTracking,
} from '@ui/layout/appFocusRegions';
import { usePanelSurfaceCycling } from './usePanelSurfaceCycling';

const dispatchShortcut = (target: HTMLElement, key: string) => {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key,
      ctrlKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
  );
};

describe('usePanelSurfaceCycling', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = '';
    __resetTopLevelAppRegionTrackingForTests();
  });

  it('cycles from the main app into visible panels and back to the last app region', async () => {
    const focusPanel = vi.fn();
    const setLastFocusedGroupKey = vi.fn();

    const Harness = () => {
      useTopLevelAppRegionTracking(true);
      usePanelSurfaceCycling({
        tabGroups: {
          right: { tabs: ['panel-right'], activeTab: 'panel-right' },
          bottom: { tabs: ['panel-bottom'], activeTab: 'panel-bottom' },
          floating: [],
        },
        focusPanel,
        setLastFocusedGroupKey,
      });

      return (
        <>
          <div data-app-region="header">
            <button type="button">About</button>
          </div>
          <div data-app-region="sidebar">
            <button type="button">Overview</button>
          </div>
          <div data-app-region="content">
            <button type="button">Running</button>
          </div>
          <div className="dockable-panel" data-group-key="right" data-active-panel-id="panel-right">
            <div className="dockable-panel__header">
              <div role="tab" tabIndex={0}>
                Right Panel
              </div>
            </div>
          </div>
          <div
            className="dockable-panel"
            data-group-key="bottom"
            data-active-panel-id="panel-bottom"
          >
            <div className="dockable-panel__header">
              <div role="tab" tabIndex={0}>
                Bottom Panel
              </div>
            </div>
          </div>
        </>
      );
    };

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <Harness />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    const contentButton = document.querySelector<HTMLButtonElement>(
      '[data-app-region="content"] button'
    );
    expect(contentButton).toBeTruthy();

    await act(async () => {
      contentButton!.focus();
      await Promise.resolve();
    });

    await act(async () => {
      dispatchShortcut(contentButton!, 'ArrowRight');
      await Promise.resolve();
    });

    expect(document.activeElement?.textContent).toBe('Right Panel');
    expect(
      (document.activeElement as HTMLElement | null)?.classList.contains(
        'keyboard-programmatic-focus'
      )
    ).toBe(true);
    expect(focusPanel).toHaveBeenLastCalledWith('panel-right');
    expect(setLastFocusedGroupKey).toHaveBeenLastCalledWith('right');

    await act(async () => {
      dispatchShortcut(document.activeElement as HTMLElement, 'ArrowRight');
      await Promise.resolve();
    });

    expect(document.activeElement?.textContent).toBe('Bottom Panel');
    expect(focusPanel).toHaveBeenLastCalledWith('panel-bottom');
    expect(setLastFocusedGroupKey).toHaveBeenLastCalledWith('bottom');

    await act(async () => {
      dispatchShortcut(document.activeElement as HTMLElement, 'ArrowRight');
      await Promise.resolve();
    });

    expect(document.activeElement?.textContent).toBe('Running');
    expect(
      (document.activeElement as HTMLElement | null)?.classList.contains(
        'keyboard-programmatic-focus'
      )
    ).toBe(true);
  });

  it('returns to the last focused top-level app region instead of a generic content fallback', async () => {
    const focusPanel = vi.fn();
    const setLastFocusedGroupKey = vi.fn();

    const Harness = () => {
      useTopLevelAppRegionTracking(true);
      usePanelSurfaceCycling({
        tabGroups: {
          right: { tabs: ['panel-right'], activeTab: 'panel-right' },
          bottom: { tabs: [], activeTab: null },
          floating: [],
        },
        focusPanel,
        setLastFocusedGroupKey,
      });

      return (
        <>
          <div data-app-region="header">
            <button type="button">About</button>
          </div>
          <div data-app-region="sidebar">
            <button type="button">Overview</button>
          </div>
          <div data-app-region="content">
            <button type="button">Running</button>
          </div>
          <div className="dockable-panel" data-group-key="right" data-active-panel-id="panel-right">
            <div className="dockable-panel__header">
              <div role="tab" tabIndex={0}>
                Right Panel
              </div>
            </div>
          </div>
        </>
      );
    };

    await act(async () => {
      root.render(
        <KeyboardProvider>
          <Harness />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    const sidebarButton = document.querySelector<HTMLButtonElement>(
      '[data-app-region="sidebar"] button'
    );
    expect(sidebarButton).toBeTruthy();

    await act(async () => {
      sidebarButton!.focus();
      await Promise.resolve();
    });

    await act(async () => {
      dispatchShortcut(sidebarButton!, 'ArrowRight');
      await Promise.resolve();
    });

    expect(document.activeElement?.textContent).toBe('Right Panel');

    await act(async () => {
      dispatchShortcut(document.activeElement as HTMLElement, 'ArrowRight');
      await Promise.resolve();
    });

    expect(document.activeElement?.textContent).toBe('Overview');
  });
});
