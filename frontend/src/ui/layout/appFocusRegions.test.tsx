import React from 'react';
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { KeyboardProvider } from '@ui/shortcuts/context';
import { useContentRegionShiftTabHandoff } from './appFocusRegions';

describe('appFocusRegions', () => {
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
  });

  it('shift-tabs from the first content control back to the selected sidebar item', async () => {
    const Harness = () => {
      const contentRef = React.useRef<HTMLDivElement | null>(null);

      useContentRegionShiftTabHandoff(contentRef, true);

      return (
        <>
          <div className="cluster-tabs-wrapper">
            <div role="tab" tabIndex={0}>
              Cluster tab
            </div>
          </div>
          <div className="app-main">
            <div className="sidebar" tabIndex={0}>
              <div className="sidebar-item active" data-sidebar-focusable="true" tabIndex={-1}>
                Overview
              </div>
            </div>
            <div ref={contentRef} className="content-body">
              <button type="button">First content control</button>
              <button type="button">Second content control</button>
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

    const firstContentButton =
      document.querySelectorAll<HTMLButtonElement>('.content-body button')[0];

    expect(firstContentButton).toBeTruthy();
    firstContentButton.focus();

    await act(async () => {
      firstContentButton.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });

    expect(document.activeElement?.textContent).toBe('Overview');
  });

  it('falls back to the first sidebar item when no item is selected', async () => {
    const Harness = () => {
      const contentRef = React.useRef<HTMLDivElement | null>(null);

      useContentRegionShiftTabHandoff(contentRef, true);

      return (
        <>
          <div className="cluster-tabs-wrapper">
            <div role="tab" tabIndex={0}>
              Cluster tab
            </div>
          </div>
          <div className="app-main">
            <div className="sidebar" tabIndex={0}>
              <div className="sidebar-item" data-sidebar-focusable="true" tabIndex={-1}>
                Overview
              </div>
            </div>
            <div ref={contentRef} className="content-body">
              <button type="button">First content control</button>
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

    const firstContentButton = document.querySelector<HTMLButtonElement>('.content-body button');

    expect(firstContentButton).toBeTruthy();
    firstContentButton?.focus();

    await act(async () => {
      firstContentButton?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Tab',
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        })
      );
      await Promise.resolve();
    });

    expect(document.activeElement?.textContent).toBe('Overview');
  });

  it('does not hijack shift-tab from native tab regions inside content', async () => {
    const Harness = () => {
      const contentRef = React.useRef<HTMLDivElement | null>(null);

      useContentRegionShiftTabHandoff(contentRef, true);

      return (
        <>
          <div className="cluster-tabs-wrapper">
            <div role="tab" tabIndex={0}>
              Cluster tab
            </div>
          </div>
          <div className="app-main">
            <div className="sidebar" tabIndex={0}>
              <div className="sidebar-item active" data-sidebar-focusable="true" tabIndex={-1}>
                Overview
              </div>
            </div>
            <div ref={contentRef} className="content-body">
              <div data-tab-native="true">
                <button type="button">Terminal input</button>
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

    const terminalButton = document.querySelector<HTMLButtonElement>('.content-body button');
    expect(terminalButton).toBeTruthy();
    terminalButton?.focus();

    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    await act(async () => {
      terminalButton?.dispatchEvent(event);
      await Promise.resolve();
    });

    expect(event.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(terminalButton);
  });
});
