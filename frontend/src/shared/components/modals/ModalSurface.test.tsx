import ReactDOM from 'react-dom/client';
import { act } from 'react';
import type { RefObject } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ModalSurface from './ModalSurface';

describe('ModalSurface', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;
  let modalRef: RefObject<HTMLDivElement | null>;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  });

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
    await act(async () => {
      root.render(
        <ModalSurface
          modalRef={modalRef}
          labelledBy="modal-title"
          onClose={onClose}
          closeOnBackdrop={closeOnBackdrop}
        >
          <h2 id="modal-title">Modal title</h2>
        </ModalSurface>
      );
      await Promise.resolve();
    });
    return onClose;
  };

  it('renders a draggable window strip above the modal overlay', async () => {
    await renderSurface();

    const dragRegion = document.querySelector('.modal-window-drag-region') as HTMLDivElement | null;
    expect(dragRegion).toBeTruthy();
    expect(dragRegion?.getAttribute('data-modal-drag-region')).toBe('true');
    expect(dragRegion?.getAttribute('aria-hidden')).toBe('true');
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
});
