import { act, type ComponentType } from 'react';
import { createPortal } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '@/utils/errorHandler';
import { withLazyBoundary } from './withLazyBoundary';

vi.mock('@/utils/errorHandler', () => ({ errorHandler: { handle: vi.fn() } }));

function pendingModule() {
  type Module = { default: ComponentType<{ label: string }> };
  let resolve: (value: Module) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const promise = new Promise<Module>((resolveModule, rejectModule) => {
    resolve = resolveModule;
    reject = rejectModule;
  });
  return { load: () => promise, resolve, reject };
}

describe('withLazyBoundary', () => {
  let root: Root;
  let container: HTMLDivElement;
  let portal: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    portal = document.createElement('div');
    document.body.append(container, portal);
    root = createRoot(container);
    vi.clearAllMocks();
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    portal.remove();
  });

  it('keeps pending portal content out of the workspace layout until its module loads', async () => {
    const module = pendingModule();
    const Panel = withLazyBoundary(module.load, null);
    await act(async () => {
      root.render(
        <main>
          <div data-testid="workspace">Workspace</div>
          <Panel label="Object details" />
        </main>
      );
    });
    const workspace = container.querySelector('[data-testid="workspace"]');
    expect(container.querySelector('main')?.childElementCount).toBe(1);
    expect(container.querySelector('.loading-spinner-container')).toBeNull();
    expect(portal.childElementCount).toBe(0);

    await act(async () => {
      module.resolve({ default: ({ label }) => createPortal(<section>{label}</section>, portal) });
    });
    expect(container.querySelector('[data-testid="workspace"]')).toBe(workspace);
    expect(container.querySelector('main')?.childElementCount).toBe(1);
    expect(portal.textContent).toBe('Object details');
  });

  it.each([undefined, 'Loading route…'])(
    'preserves inline loading feedback for route content (%s)',
    async (message) => {
      const module = pendingModule();
      const Route = withLazyBoundary(module.load, message);
      await act(async () => root.render(<Route label="Route content" />));
      expect(container.querySelector('.loading-spinner-container')?.textContent).toBe(
        message ?? 'Loading...'
      );
      await act(async () => module.resolve({ default: ({ label }) => <section>{label}</section> }));
      expect(container.querySelector('.loading-spinner-container')).toBeNull();
      expect(container.textContent).toBe('Route content');
    }
  );

  it('does not mount a panel closed before its module finishes loading', async () => {
    const module = pendingModule();
    const Panel = withLazyBoundary(module.load, null);
    await act(async () => root.render(<Panel label="Closed panel" />));
    await act(async () => root.render(null));
    await act(async () => {
      module.resolve({ default: ({ label }) => createPortal(<section>{label}</section>, portal) });
    });
    expect(container.childElementCount).toBe(0);
    expect(portal.childElementCount).toBe(0);
  });

  it('still reports an import failure when loading feedback is suppressed', async () => {
    const module = pendingModule();
    const Panel = withLazyBoundary(module.load, null);
    await act(async () => root.render(<Panel label="Object details" />));
    const error = new Error('Panel module unavailable');
    await act(async () => module.reject(error));
    expect(errorHandler.handle).toHaveBeenCalledWith(
      error,
      expect.objectContaining({ action: 'componentError' })
    );
    expect(container.querySelector('[data-testid="error-boundary"]')?.textContent).toContain(
      error.message
    );
  });
});
