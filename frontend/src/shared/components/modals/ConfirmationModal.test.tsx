/**
 * frontend/src/components/modals/ConfirmationModal.test.tsx
 *
 * Test suite for ConfirmationModal.
 * Covers key behaviors and edge cases for ConfirmationModal.
 */

import { KeyboardProvider } from '@ui/shortcuts';
import { act } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ConfirmationModal from './ConfirmationModal';

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

  it('initially focuses the non-destructive action', async () => {
    await renderModal({});

    const cancelButton = document.querySelector<HTMLButtonElement>(
      '.confirmation-modal-footer .button.cancel'
    );
    expect(document.activeElement).toBe(cancelButton);
  });

  it('supports escape key and ignores backdrop clicks', async () => {
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
    expect(onCancel).toHaveBeenCalledTimes(1);
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

  it('renders an optional details table with monospace columns', async () => {
    await renderModal({
      detailsTable: {
        columns: [{ header: 'Owner' }, { header: 'Path', monospace: true }],
        rows: [
          ['flux', 'spec.replicas'],
          ['kube-controller-manager', 'spec.strategy.rollingUpdate.maxSurge'],
        ],
      },
      warning: 'Their managers may revert your changes.',
    });

    const headers = Array.from(
      document.querySelectorAll('.confirmation-modal-details-table th')
    ).map((cell) => cell.textContent);
    expect(headers).toEqual(['Owner', 'Path']);

    const rows = Array.from(
      document.querySelectorAll('.confirmation-modal-details-table tbody tr')
    ).map((row) => Array.from(row.querySelectorAll('td')).map((cell) => cell.textContent));
    expect(rows).toEqual([
      ['flux', 'spec.replicas'],
      ['kube-controller-manager', 'spec.strategy.rollingUpdate.maxSurge'],
    ]);

    const firstRowCells = document.querySelectorAll(
      '.confirmation-modal-details-table tbody tr td'
    );
    expect(firstRowCells[0]?.classList.contains('monospace')).toBe(false);
    expect(firstRowCells[1]?.classList.contains('monospace')).toBe(true);
  });

  it('omits the details table when not provided', async () => {
    await renderModal({});
    expect(document.querySelector('.confirmation-modal-details-table')).toBeNull();
  });

  it('renders an optional secondary action on the left of the footer', async () => {
    const onSecondaryAction = vi.fn();
    await renderModal({
      secondaryActionText: 'Discard changes',
      onSecondaryAction,
    });

    const secondaryButton = document.querySelector(
      '.confirmation-modal-footer .confirmation-modal-secondary-action'
    ) as HTMLButtonElement;
    expect(secondaryButton).toBeTruthy();
    expect(secondaryButton.textContent).toBe('Discard changes');

    act(() => {
      secondaryButton.click();
    });
    expect(onSecondaryAction).toHaveBeenCalledTimes(1);
  });

  it('omits the secondary action when not provided', async () => {
    await renderModal({});
    expect(document.querySelector('.confirmation-modal-secondary-action')).toBeNull();
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
