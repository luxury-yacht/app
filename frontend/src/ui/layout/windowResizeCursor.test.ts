import { afterEach, describe, expect, it } from 'vitest';
import {
  installDirectionalWindowResizeCursor,
  resolveDirectionalWindowResizeCursor,
} from './windowResizeCursor';

const viewport = { width: 800, height: 600 };

describe('frameless window resize cursor', () => {
  afterEach(() => {
    document.body.style.cursor = '';
    delete document.body.dataset.windowResizeCursor;
  });

  it.each([
    ['ew-resize', 1, 300, 'w-resize'],
    ['ew-resize', 799, 300, 'e-resize'],
    ['ns-resize', 400, 1, 'n-resize'],
    ['ns-resize', 400, 599, 's-resize'],
    ['nwse-resize', 1, 1, 'nw-resize'],
    ['nesw-resize', 799, 1, 'ne-resize'],
    ['nesw-resize', 1, 599, 'sw-resize'],
    ['nwse-resize', 799, 599, 'se-resize'],
  ] as const)(
    'maps Wails cursor %s at (%i, %i) to native edge cursor %s',
    (wailsCursor, clientX, clientY, expected) => {
      expect(
        resolveDirectionalWindowResizeCursor({
          wailsCursor,
          clientX,
          clientY,
          ...viewport,
        })
      ).toBe(expected);
    }
  );

  it('projects the active Wails edge onto the document and clears it outside resize regions', () => {
    const cleanup = installDirectionalWindowResizeCursor(window, document);

    document.body.style.cursor = 'ew-resize';
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 1, clientY: 300 }));
    expect(document.body.style.cursor).toBe('w-resize');
    expect(document.body.dataset.windowResizeCursor).toBe('w-resize');

    document.body.style.cursor = '';
    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 400, clientY: 300 }));
    expect(document.body.dataset.windowResizeCursor).toBeUndefined();

    cleanup();
  });

  it('clears the projected cursor when the installer is removed', () => {
    const cleanup = installDirectionalWindowResizeCursor(window, document);
    document.body.style.cursor = 'se-resize';
    document.body.dataset.windowResizeCursor = 'se-resize';

    window.dispatchEvent(new MouseEvent('mousemove', { clientX: 799, clientY: 599 }));

    cleanup();

    expect(document.body.style.cursor).toBe('');
    expect(document.body.dataset.windowResizeCursor).toBeUndefined();
  });
});
