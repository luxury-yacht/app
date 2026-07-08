/**
 * frontend/src/ui/modals/OpenClusterModal.test.tsx
 *
 * Tests for the OpenClusterModal shell (open/close + Cancel).
 */
import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import OpenClusterModal from './OpenClusterModal';

describe('OpenClusterModal', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeAll(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
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
  });

  // The modal portals to document.body, so assertions query the document.
  const renderModal = async (props: { isOpen: boolean; onClose: () => void }) => {
    await act(async () => {
      root.render(<OpenClusterModal {...props} />);
      await Promise.resolve();
    });
  };

  it('renders nothing when closed', async () => {
    await renderModal({ isOpen: false, onClose: vi.fn() });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('renders the Open Cluster dialog when open', async () => {
    await renderModal({ isOpen: true, onClose: vi.fn() });
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Open Cluster');
  });

  it('calls onClose when Cancel is clicked', async () => {
    const onClose = vi.fn();
    await renderModal({ isOpen: true, onClose });

    const cancel = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === 'Cancel'
    );
    expect(cancel).toBeTruthy();

    act(() => {
      cancel!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
