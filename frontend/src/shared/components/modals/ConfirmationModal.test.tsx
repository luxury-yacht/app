/**
 * frontend/src/components/modals/ConfirmationModal.test.tsx
 *
 * Test suite for ConfirmationModal.
 * Covers key behaviors and edge cases for ConfirmationModal.
 */

import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import ConfirmationModal from './ConfirmationModal';
import { KeyboardProvider } from '@ui/shortcuts';

const runtimeMocks = vi.hoisted(() => ({
  eventsOn: vi.fn(),
  eventsOff: vi.fn(),
}));

vi.mock('@wailsjs/runtime/runtime', () => ({
  EventsOn: runtimeMocks.eventsOn,
  EventsOff: runtimeMocks.eventsOff,
}));

describe('ConfirmationModal', () => {
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
    document.body.innerHTML = '';
    runtimeMocks.eventsOn.mockReset();
    runtimeMocks.eventsOff.mockReset();
  });

  const renderModal = async (props: Partial<React.ComponentProps<typeof ConfirmationModal>>) => {
    await act(async () => {
      root.render(
        <KeyboardProvider>
          <ConfirmationModal
            isOpen={true}
            title="Delete resource"
            message="Are you sure?"
            confirmText="Confirm"
            cancelText="Cancel"
            confirmButtonClass="danger"
            onConfirm={vi.fn()}
            onCancel={vi.fn()}
            {...props}
          />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });
  };

  it('does not render when closed', async () => {
    await act(async () => {
      root.render(
        <KeyboardProvider>
          <ConfirmationModal
            isOpen={false}
            title="Hidden"
            message="Should not appear"
            onConfirm={vi.fn()}
            onCancel={vi.fn()}
          />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });

    expect(document.querySelector('.confirmation-modal')).toBeNull();
  });

  it('invokes confirm and cancel callbacks via buttons', async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    await renderModal({ onConfirm, onCancel });

    const confirmButton = document.querySelector(
      '.confirmation-modal-footer .button.danger'
    ) as HTMLButtonElement;
    const cancelButton = document.querySelector(
      '.confirmation-modal-footer .button.cancel'
    ) as HTMLButtonElement;

    act(() => {
      confirmButton.click();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);

    act(() => {
      cancelButton.click();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('supports escape key and backdrop cancellation', async () => {
    const onCancel = vi.fn();
    await renderModal({ onCancel });

    act(() => {
      const escapeEvent = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
      document.dispatchEvent(escapeEvent);
    });
    expect(onCancel).toHaveBeenCalledTimes(1);

    const overlay = document.querySelector('.confirmation-modal-backdrop') as HTMLDivElement;
    const modal = document.querySelector('.confirmation-modal') as HTMLDivElement;
    act(() => {
      modal?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);

    act(() => {
      overlay.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('renders custom button labels and classes', async () => {
    await renderModal({
      confirmText: 'Delete Everything',
      cancelText: 'Never mind',
      confirmButtonClass: 'warning',
    });

    const confirmButton = document.querySelector(
      '.confirmation-modal-footer .button.warning'
    ) as HTMLButtonElement;
    const cancelButton = document.querySelector(
      '.confirmation-modal-footer .button.cancel'
    ) as HTMLButtonElement;

    expect(confirmButton.textContent).toBe('Delete Everything');
    expect(cancelButton.textContent).toBe('Never mind');
  });

  it('returns null when modal is closed', async () => {
    await act(async () => {
      root.render(
        <KeyboardProvider>
          <ConfirmationModal
            isOpen={false}
            title="Hidden"
            message="Hidden"
            onConfirm={vi.fn()}
            onCancel={vi.fn()}
          />
        </KeyboardProvider>
      );
      await Promise.resolve();
    });
    expect(document.querySelector('.confirmation-modal')).toBeNull();
  });
});
