import { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAppZoomFactor } from '@/shared/utils/appZoom';
import { requireValue } from '@/test-utils/requireValue';
import { getZoomAwareViewport, useZoom, ZoomProvider } from './ZoomContext';

const mocks = vi.hoisted(() => ({
  read: vi.fn<() => Promise<number>>(),
  persist: vi.fn<() => Promise<void>>(),
  report: vi.fn(),
  events: new Map<string, () => void>(),
  dispose: vi.fn(),
}));

vi.mock('@/core/app-state-access', () => ({
  readZoomLevel: mocks.read,
  requestAppState: ({ read }: { read: () => Promise<number> }) => read(),
}));
vi.mock('@/core/backend-api', () => ({ SetZoomLevel: mocks.persist }));
vi.mock('@/core/desktop-runtime', () => ({
  onEvent: (name: string, handler: () => void) => {
    mocks.events.set(name, handler);
    return mocks.dispose;
  },
}));
vi.mock('@/utils/errorHandler', () => ({ reportOperationalError: mocks.report }));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe('application zoom', () => {
  let root: Root;
  let host: HTMLDivElement;
  let zoom: ReturnType<typeof useZoom> | undefined;

  function Probe() {
    zoom = useZoom();
    return <span>{zoom.zoomLevel}</span>;
  }

  const render = async () => {
    await act(async () => {
      root.render(
        <StrictMode>
          <ZoomProvider>
            <Probe />
          </ZoomProvider>
        </StrictMode>
      );
    });
    return requireValue(zoom, 'expected the zoom provider to render');
  };

  beforeEach(() => {
    mocks.read.mockResolvedValue(100);
    mocks.persist.mockResolvedValue();
    mocks.events.clear();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    document.body.style.removeProperty('zoom');
    document.documentElement.style.removeProperty('zoom');
    document.documentElement.style.removeProperty('--app-zoom-factor');
  });

  it.each([50, 100, 200])(
    'zooms content to %s%% without scaling native viewport measurements',
    async (level) => {
      mocks.read.mockResolvedValue(level);
      await render();
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
    await render();
    for (const [event, expected] of [
      ['zoom-in', 110],
      ['zoom-out', 100],
      ['zoom-reset', 100],
    ] as const) {
      act(() => mocks.events.get(event)?.());
      expect(document.body.style.zoom).toBe(`${expected}%`);
      expect(mocks.persist).toHaveBeenLastCalledWith(expected);
    }
  });

  it('persists each menu action once, including several actions before a render', async () => {
    await render();
    mocks.persist.mockClear();
    act(() => {
      mocks.events.get('zoom-in')?.();
      mocks.events.get('zoom-in')?.();
      mocks.events.get('zoom-out')?.();
    });
    expect(zoom?.zoomLevel).toBe(110);
    expect(document.body.style.zoom).toBe('110%');
    expect(mocks.persist.mock.calls).toEqual([[110], [120], [110]]);
  });

  it.each(['resolve', 'reject'] as const)(
    'preserves a menu action when the initial settings read later %ss',
    async (outcome) => {
      const load = deferred<number>();
      mocks.read.mockReturnValue(load.promise);
      await render();
      act(() => mocks.events.get('zoom-in')?.());
      await act(async () => {
        if (outcome === 'resolve') {
          load.resolve(150);
        } else {
          load.reject(new Error('delayed load failure'));
        }
      });
      expect(zoom?.zoomLevel).toBe(110);
      expect(document.body.style.zoom).toBe('110%');
      expect(getAppZoomFactor()).toBe(1.1);
    }
  );

  it('ignores settings reads belonging to an unmounted provider', async () => {
    const load = deferred<number>();
    mocks.read.mockReturnValue(load.promise);
    await render();
    act(() => root.render(null));
    document.body.style.zoom = '130%';
    document.documentElement.style.setProperty('--app-zoom-factor', '1.3');
    await act(async () => load.resolve(150));
    expect(document.body.style.zoom).toBe('130%');
    expect(getAppZoomFactor()).toBe(1.3);
  });

  it.each([
    [50, 'zoomOut', 'canZoomOut'],
    [200, 'zoomIn', 'canZoomIn'],
  ] as const)('enforces the %s%% limit', async (level, action, capability) => {
    mocks.read.mockResolvedValue(level);
    const context = await render();
    expect(context[capability]).toBe(false);
    act(() => context[action]());
    expect(document.body.style.zoom).toBe(`${level}%`);
  });

  it('uses 100% for an invalid saved zoom', async () => {
    mocks.read.mockResolvedValue(500);
    expect((await render()).zoomLevel).toBe(100);
    expect(document.body.style.zoom).toBe('100%');
  });

  it('reports a failed load and applies the default zoom', async () => {
    mocks.read.mockRejectedValue(new Error('unavailable'));
    await render();
    expect(document.body.style.zoom).toBe('100%');
    expect(mocks.report).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'loadZoomLevel' })
    );
  });

  it('reports persistence failures', async () => {
    mocks.persist.mockRejectedValue(new Error('unavailable'));
    const context = await render();
    await act(async () => context.zoomIn());
    expect(mocks.report).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ action: 'persistZoomLevel' })
    );
  });

  it('rejects consumers outside a provider', () => {
    expect(() => act(() => root.render(<Probe />))).toThrow(
      'useZoom must be used within ZoomProvider'
    );
  });
});
