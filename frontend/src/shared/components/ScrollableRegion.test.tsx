import { ZoomProvider } from '@core/contexts/ZoomContext';
import { AppRegionNavigation } from '@ui/layout/AppRegionNavigation';
import { KeyboardProvider } from '@ui/shortcuts';
import { act, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
import ScrollableRegion from './ScrollableRegion';

it('tabs into the viewport, leaves scrolling keys native, and skips excluded links', async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const viewportRef = createRef<HTMLElement>();
  try {
    await act(async () => {
      root.render(
        <KeyboardProvider>
          <ZoomProvider>
            <AppRegionNavigation />
            <main data-app-region="content">
              <button type="button">Before logs</button>
              <ScrollableRegion ref={viewportRef} aria-label="Log output">
                <a href="#pod" tabIndex={-1} data-focus-trap-ignore="true">
                  Pod
                </a>
                Log content
              </ScrollableRegion>
              <button type="button">After logs</button>
            </main>
          </ZoomProvider>
        </KeyboardProvider>
      );
    });
    const viewport = requireValue(viewportRef.current, 'log viewport');
    const before = requireValue(container.querySelector('button'), 'before logs');
    const press = async (key: string, shiftKey = false) => {
      const event = new KeyboardEvent('keydown', {
        key,
        shiftKey,
        bubbles: true,
        cancelable: true,
      });
      await act(async () => {
        document.activeElement?.dispatchEvent(event);
      });
      return event;
    };
    expect(viewport.tagName).toBe('SECTION');
    await act(async () => before.focus());
    await press('Tab');
    expect(document.activeElement).toBe(viewport);
    for (const key of [
      'ArrowUp',
      'ArrowDown',
      'ArrowLeft',
      'ArrowRight',
      'PageUp',
      'PageDown',
      'Home',
      'End',
    ]) {
      expect((await press(key)).defaultPrevented, key).toBe(false);
      expect(document.activeElement).toBe(viewport);
    }
    await press('Tab');
    expect(document.activeElement?.textContent).toBe('After logs');
    await press('Tab', true);
    expect(document.activeElement).toBe(viewport);
    await press('Tab', true);
    expect(document.activeElement).toBe(before);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
