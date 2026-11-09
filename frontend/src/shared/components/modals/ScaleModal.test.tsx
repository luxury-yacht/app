import { KeyboardProvider } from '@ui/shortcuts';
import { act, useState } from 'react';
import * as ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { requireValue } from '@/test-utils/requireValue';
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
    onScaleToZero: vi.fn(),
    onValueChange: vi.fn(),
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
    defaultProps.onCancel.mockReset();
    defaultProps.onApply.mockReset();
    defaultProps.onScaleToZero.mockReset();
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
      root.render(
        <KeyboardProvider>
          <ScaleModal {...defaultProps} {...props} />
        </KeyboardProvider>
      );
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

    const input = document.querySelector('[id$="-scale-replicas"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    expect(input?.value).toBe('5');

    await act(async () => {
      requireValue(input, 'expected test value in ScaleModal.test.tsx').dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      );
      await Promise.resolve();
    });

    expect(defaultProps.onApply).toHaveBeenCalledTimes(1);
  });

  it('applies scale to zero from the secondary action', async () => {
    await renderModal();

    const zeroButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Scale to 0'
    );
    expect(zeroButton).toBeTruthy();

    act(() => {
      zeroButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(defaultProps.onScaleToZero).toHaveBeenCalledTimes(1);
    expect(defaultProps.onApply).not.toHaveBeenCalled();
  });

  it('disables scale to zero when already at zero', async () => {
    await renderModal({ value: 0 });

    const zeroButton = Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (button) => button.textContent === 'Scale to 0'
    );

    expect(zeroButton?.disabled).toBe(true);
  });

  it('cancels on Escape through the keyboard surface manager', async () => {
    await renderModal();

    const input = document.querySelector('[id$="-scale-replicas"]') as HTMLInputElement | null;
    expect(input).not.toBeNull();
    input?.focus();

    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await Promise.resolve();
    });

    expect(defaultProps.onCancel).toHaveBeenCalledTimes(1);
  });

  describe('replica field', () => {
    function ControlledScaleModal({ initial }: Readonly<{ initial: number }>) {
      const [value, setValue] = useState(initial);
      return <ScaleModal {...defaultProps} value={value} onValueChange={setValue} />;
    }

    const renderControlled = async (initial: number) => {
      await act(async () => {
        root.render(
          <KeyboardProvider>
            <ControlledScaleModal initial={initial} />
          </KeyboardProvider>
        );
        await Promise.resolve();
      });
    };

    const replicaInput = () =>
      requireValue(
        document.querySelector<HTMLInputElement>('[id$="-scale-replicas"]'),
        'replica input'
      );
    const stepButton = (label: 'Decrease replicas' | 'Increase replicas') =>
      requireValue(document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`), label);
    const scaleButton = () =>
      requireValue(
        Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
          (button) => button.textContent === 'Scale'
        ),
        'Scale button'
      );
    const click = async (button: HTMLButtonElement) => {
      await act(async () => {
        button.click();
        await Promise.resolve();
      });
    };
    const typeReplicas = async (text: string) => {
      const input = replicaInput();
      await act(async () => {
        requireValue(
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set,
          'value setter'
        ).call(input, text);
        input.dispatchEvent(new Event('input', { bubbles: true }));
        await Promise.resolve();
      });
    };
    const blurReplicas = async () => {
      await act(async () => {
        replicaInput().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        await Promise.resolve();
      });
    };
    const pressEnter = async () => {
      await act(async () => {
        replicaInput().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await Promise.resolve();
      });
    };

    it('steps the count up and down with the + and - buttons', async () => {
      await renderControlled(3);

      await click(stepButton('Increase replicas'));
      expect(replicaInput().value).toBe('4');

      await click(stepButton('Decrease replicas'));
      await click(stepButton('Decrease replicas'));
      expect(replicaInput().value).toBe('2');
    });

    it('stops at zero', async () => {
      await renderControlled(1);

      await click(stepButton('Decrease replicas'));

      expect(replicaInput().value).toBe('0');
      expect(stepButton('Decrease replicas').disabled).toBe(true);
    });

    it('stops at the highest replica count the app applies', async () => {
      await renderControlled(9998);

      await click(stepButton('Increase replicas'));

      expect(replicaInput().value).toBe('9999');
      expect(stepButton('Increase replicas').disabled).toBe(true);
    });

    it('still accepts a typed count', async () => {
      await renderControlled(3);

      await typeReplicas('12');

      expect(replicaInput().value).toBe('12');
      await pressEnter();
      expect(defaultProps.onApply).toHaveBeenCalledTimes(1);
    });

    it.each([
      ['letters', '1a2', '12'],
      ['a minus sign', '-5', '5'],
      ['a decimal point', '1.5', '15'],
      ['leading zeros', '007', '7'],
      ['a count above the limit', '99999', '9999'],
    ])('shows only a valid count when given %s', async (_label, typed, shown) => {
      await renderControlled(3);

      await typeReplicas(typed);

      expect(replicaInput().value).toBe(shown);
    });

    it('cannot apply while the field is empty', async () => {
      await renderControlled(3);
      await typeReplicas('5');

      await typeReplicas('');

      expect(replicaInput().value).toBe('');
      expect(scaleButton().disabled).toBe(true);
      await pressEnter();
      expect(defaultProps.onApply).not.toHaveBeenCalled();
    });

    it('returns an emptied field to the last valid count instead of zero', async () => {
      await renderControlled(3);
      await typeReplicas('5');
      await typeReplicas('');

      await blurReplicas();

      expect(replicaInput().value).toBe('5');
      expect(scaleButton().disabled).toBe(false);
    });
  });
});
