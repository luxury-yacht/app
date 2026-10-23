/**
 * frontend/src/core/contexts/ZoomContext.test.tsx
 *
 * Application zoom: the window opens at the saved zoom level (an invalid or
 * unreadable one falls back to 100%), zooms the body rather than the native
 * viewport, applies and persists every menu zoom action exactly once within
 * the 50%-200% limits, keeps a menu action that beats the saved-level read,
 * and reports load and persistence failures. Runs the shell's own zoom owner
 * (test-utils/appState); the saved level, its persistence, and the native
 * menu's zoom events cross the faked backend boundary.
 */

import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { getAppZoomFactor } from '@/shared/utils/appZoom';
import { installAppStateHarness, type MountedApp } from '@/test-utils/appState/harness';
import { requireValue } from '@/test-utils/requireValue';
import { getZoomAwareViewport, useZoom } from './ZoomContext';

const app = installAppStateHarness();
let view: MountedApp;
let zoom: ReturnType<typeof useZoom> | undefined;

function Probe() {
  zoom = useZoom();
  return null;
}

const current = () => requireValue(zoom, 'zoom owner');

/**
 * Opens the window with `saved` as the persisted zoom level; without it, the
 * read the test answered (or holds) already.
 */
const start = async (saved?: () => number) => {
  if (saved) {
    app.backend.answer('GetZoomLevel', saved);
  }
  app.backend.answer('SetZoomLevel', () => undefined);
  view = await app.render(null);
  await view.show(<Probe />);
};

/** Delivers native menu zoom commands, all before the next render. */
const menu = async (...events: Array<'zoom-in' | 'zoom-out' | 'zoom-reset'>) => {
  await act(async () => {
    for (const event of events) {
      app.events.emit(event);
    }
  });
  await app.settle();
};

const persisted = () => app.backend.calls('SetZoomLevel').map(([level]) => level);

const operationalReports = (action: string) =>
  app.errors.take(
    (record) => record.kinds.includes('operational') && record.context?.action === action
  );

afterEach(() => {
  zoom = undefined;
  document.body.style.removeProperty('zoom');
  document.documentElement.style.removeProperty('zoom');
  document.documentElement.style.removeProperty('--app-zoom-factor');
});

describe('application zoom', () => {
  it.each([50, 100, 200])(
    'zooms content to a saved %s%% without scaling native viewport measurements',
    async (level) => {
      await start(() => level);

      expect(current().zoomLevel).toBe(level);
      expect(document.body.style.zoom).toBe(`${level}%`);
      expect(document.documentElement.style.zoom).toBe('');
      expect(getAppZoomFactor()).toBe(level / 100);
      expect(getZoomAwareViewport(level)).toEqual({
        width: window.innerWidth / (level / 100),
        height: window.innerHeight / (level / 100),
        zoomFactor: level / 100,
      });
    }
  );

  it('applies and persists menu zoom actions and resets', async () => {
    await start(() => 100);

    for (const [event, expected] of [
      ['zoom-in', 110],
      ['zoom-out', 100],
      ['zoom-reset', 100],
    ] as const) {
      await menu(event);
      expect(document.body.style.zoom).toBe(`${expected}%`);
      expect(persisted().slice(-1)).toEqual([expected]);
    }
  });

  it('persists each menu action once, including several actions before a render', async () => {
    await start(() => 100);

    await menu('zoom-in', 'zoom-in', 'zoom-out');

    expect(current().zoomLevel).toBe(110);
    expect(document.body.style.zoom).toBe('110%');
    expect(persisted()).toEqual([110, 120, 110]);
  });

  it.each(['resolves', 'fails'] as const)(
    'keeps a menu action when the saved-level read later %s',
    async (outcome) => {
      const saved = () => {
        if (outcome === 'fails') {
          throw new Error('delayed load failure');
        }
        return 150;
      };
      app.backend.answer('GetZoomLevel', saved);
      const release = app.backend.hold('GetZoomLevel');
      await start();

      await menu('zoom-in');
      await act(async () => release());
      await app.settle();

      expect(current().zoomLevel).toBe(110);
      expect(document.body.style.zoom).toBe('110%');
      expect(getAppZoomFactor()).toBe(1.1);
      // A failed read is still reported; it just no longer decides the zoom.
      expect(operationalReports('loadZoomLevel')).toHaveLength(outcome === 'fails' ? 1 : 0);
    }
  );

  it('ignores a saved-level read that settles after the window unmounts', async () => {
    app.backend.answer('GetZoomLevel', () => 150);
    const release = app.backend.hold('GetZoomLevel');
    await start();

    view.unmount();
    document.body.style.zoom = '130%';
    document.documentElement.style.setProperty('--app-zoom-factor', '1.3');
    await act(async () => release());

    expect(document.body.style.zoom).toBe('130%');
    expect(getAppZoomFactor()).toBe(1.3);
  });

  it.each([
    [50, 'zoom-out', 'canZoomOut'],
    [200, 'zoom-in', 'canZoomIn'],
  ] as const)('stops at the %s%% limit', async (level, event, capability) => {
    await start(() => level);
    expect(current()[capability]).toBe(false);

    await menu(event);

    expect(document.body.style.zoom).toBe(`${level}%`);
  });

  it('uses 100% for an invalid saved zoom', async () => {
    await start(() => 500);

    expect(current().zoomLevel).toBe(100);
    expect(document.body.style.zoom).toBe('100%');
  });

  it('reports a failed load and applies the default zoom', async () => {
    await start(() => {
      throw new Error('unavailable');
    });

    expect(document.body.style.zoom).toBe('100%');
    expect(operationalReports('loadZoomLevel')).toHaveLength(1);
  });

  it('reports a zoom level the backend fails to persist, keeping the applied zoom', async () => {
    await start(() => 100);
    app.backend.answer('SetZoomLevel', () => {
      throw new Error('unavailable');
    });

    await menu('zoom-in');

    expect(document.body.style.zoom).toBe('110%');
    expect(operationalReports('persistZoomLevel')).toHaveLength(1);
  });
});
