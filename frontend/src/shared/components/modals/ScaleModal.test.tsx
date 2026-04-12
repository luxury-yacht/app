import ReactDOM from 'react-dom/client';
import { act } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ScaleModal from './ScaleModal';

describe('ScaleModal', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  const defaultProps = {
    isOpen: true,
    kind: 'Deployment',
    name: 'api',
    namespace: 'default',
    value: 3,
    loading: false,
    error: null as string | null,
    onCancel: vi.fn(),
    onApply: vi.fn(),
    onValueChange: vi.fn(),
  };

  beforeAll(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    defaultProps.onCancel.mockReset();
    defaultProps.onApply.mockReset();
    defaultProps.onValueChange.mockReset();
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
  });

  const renderModal = async (props?: Partial<typeof defaultProps>) => {
    await act(async () => {
      root.render(<ScaleModal {...defaultProps} {...props} />);
      await Promise.resolve();
    });
  };

  it('does not render when closed', async () => {
    await renderModal({ isOpen: false });

    expect(document.querySelector('.scale-modal')).toBeNull();
  });

  it('renders as a dialog and does not close on overlay click', async () => {
    await renderModal();

    const modal = document.querySelector('.scale-modal');
    const overlay = document.querySelector('.modal-overlay');

    expect(modal).not.toBeNull();
    expect(modal?.getAttribute('role')).toBe('dialog');
    expect(modal?.getAttribute('aria-modal')).toBe('true');
    expect(document.body.textContent).toContain('Scale Deployment');

    act(() => {
      overlay?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(defaultProps.onCancel).not.toHaveBeenCalled();
  });

  it('applies when Enter is pressed after the value has changed', async () => {
    await renderModal();

    await renderModal({ value: 5 });

    const input = document.querySelector('#scale-replicas') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.value).toBe('5');

    await act(async () => {
      input!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      await Promise.resolve();
    });

    expect(defaultProps.onApply).toHaveBeenCalledTimes(1);
  });
});
