import type { RefObject } from 'react';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestId } from '@/test-utils/createTestId';
import ModalSurface from './ModalSurface';

describe('ModalSurface', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let modalRef: RefObject<HTMLDivElement | null>;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    modalRef = { current: null };
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = '';
  });

  const renderSurface = async (onClose = vi.fn(), closeOnBackdrop?: boolean) => {
    const titleId = createTestId('modal-title');
    await act(async () => {
      root.render(
        <ModalSurface
          modalRef={modalRef}
          labelledBy={titleId}
          onClose={onClose}
          closeOnBackdrop={closeOnBackdrop}
        >
          <h2 id={titleId}>Modal title</h2>
        </ModalSurface>
      );
      await Promise.resolve();
    });
    return onClose;
  };

  it('marks the body while a modal surface is open', async () => {
    await renderSurface();

    expect(document.body.classList.contains('modal-surface-open')).toBe(true);

    await act(async () => {
      root.render(null);
      await Promise.resolve();
    });

    expect(document.body.classList.contains('modal-surface-open')).toBe(false);
  });

  it('renders a Wails drag region inside the active modal surface', async () => {
    await renderSurface();

    const overlay = document.querySelector('.modal-overlay') as HTMLDivElement | null;
    const backdrop = document.querySelector('.modal-backdrop') as HTMLDivElement | null;
    const dragRegion = document.querySelector('.modal-window-drag-region');

    expect(overlay).toBeTruthy();
    expect(backdrop).toBeTruthy();
    expect(dragRegion).toBeTruthy();
    expect(dragRegion?.parentElement).toBe(overlay);
    expect(backdrop?.parentElement).toBe(overlay);
  });

  it('does not close on backdrop clicks by default', async () => {
    const onClose = await renderSurface();

    const overlay = document.querySelector('.modal-overlay') as HTMLDivElement | null;
    expect(overlay).toBeTruthy();

    act(() => {
      overlay?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('does not close backdrop-close modals from the drag region', async () => {
    const onClose = await renderSurface(vi.fn(), true);

    const dragRegion = document.querySelector('.modal-window-drag-region') as HTMLDivElement | null;
    expect(dragRegion).toBeTruthy();

    act(() => {
      dragRegion?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onClose).not.toHaveBeenCalled();
  });

  it('uses a native backdrop dismiss button when backdrop closing is enabled', async () => {
    const onClose = await renderSurface(vi.fn(), true);
    const dismissButton = document.querySelector<HTMLButtonElement>('.modal-backdrop-dismiss');

    expect(dismissButton?.type).toBe('button');
    act(() => dismissButton?.click());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
