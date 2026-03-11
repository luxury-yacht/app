import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormEnvFromField } from './FormEnvFromField';

/**
 * Update a text input's native value so React 19's change tracking picks it up.
 *
 * React 19 installs a per-instance property descriptor on text inputs to track
 * the "last committed value". Directly assigning element.value triggers that
 * custom setter and updates the tracker, causing React to suppress the onChange
 * when the change event fires (tracker value === DOM value → no-op). Using the
 * prototype setter bypasses the tracker so React sees a real value change.
 *
 * This is the same approach used by FormProbeField.test.tsx in this codebase.
 */
const setNativeInputValue = (element: HTMLInputElement, value: string) => {
  const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
  const prototype = Object.getPrototypeOf(element) as HTMLInputElement;
  const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
  if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
    prototypeValueSetter.call(element, value);
    return;
  }
  if (valueSetter) {
    valueSetter.call(element, value);
    return;
  }
  element.value = value;
};

// Mock Dropdown as a simple <select>.
vi.mock('@shared/components/dropdowns/Dropdown', () => ({
  Dropdown: ({
    options,
    value,
    onChange,
    ariaLabel,
  }: {
    options: Array<{ value: string; label: string }>;
    value: string | string[];
    onChange: (next: string | string[]) => void;
    ariaLabel?: string;
  }) => (
    <select
      data-testid={`dropdown-${ariaLabel ?? 'unknown'}`}
      value={Array.isArray(value) ? (value[0] ?? '') : value}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

describe('FormEnvFromField', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  /** Helper to render the component. */
  const render = (
    items: Record<string, unknown>[],
    onChange?: (newItems: Record<string, unknown>[]) => void
  ) => {
    const mockOnChange =
      onChange ?? vi.fn<(newItems: Record<string, unknown>[]) => void>();
    act(() => {
      root.render(
        <FormEnvFromField
          dataFieldKey="envFrom"
          items={items}
          onChange={mockOnChange}
        />
      );
    });
    return mockOnChange;
  };

  it('renders empty state with add button', () => {
    render([]);
    const addBtn = container.querySelector('button.resource-form-add-btn');
    expect(addBtn).not.toBeNull();
    expect(container.textContent).toContain('Add env source');
  });

  it('detects configMap source and renders name input', () => {
    render([{ configMapRef: { name: 'my-config' } }]);
    const nameInput = container.querySelector(
      '[data-field-key="envFromName-0"] input'
    ) as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    expect(nameInput.value).toBe('my-config');
  });

  it('detects secret source and renders name input', () => {
    render([{ secretRef: { name: 'my-secret' } }]);
    const nameInput = container.querySelector(
      '[data-field-key="envFromName-0"] input'
    ) as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    expect(nameInput.value).toBe('my-secret');
    // Source dropdown should show Secret.
    const dropdown = container.querySelector(
      '[data-testid="dropdown-Env source type 1"]'
    ) as HTMLSelectElement;
    expect(dropdown.value).toBe('secret');
  });

  it('renders prefix input with correct value', () => {
    render([{ configMapRef: { name: 'my-config' }, prefix: 'APP_' }]);
    const prefixInput = container.querySelector(
      '[data-field-key="envFromPrefix-0"] input'
    ) as HTMLInputElement;
    expect(prefixInput).not.toBeNull();
    expect(prefixInput.value).toBe('APP_');
  });

  it('source type switching preserves name and prefix', () => {
    const onChange = vi.fn();
    render([{ configMapRef: { name: 'my-config' }, prefix: 'APP_' }], onChange);
    // Switch to Secret.
    const dropdown = container.querySelector(
      '[data-testid="dropdown-Env source type 1"]'
    ) as HTMLSelectElement;
    act(() => {
      dropdown.value = 'secret';
      dropdown.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const newItems = onChange.mock.calls[0][0];
    expect(newItems[0].secretRef).toEqual({ name: 'my-config' });
    expect(newItems[0].configMapRef).toBeUndefined();
    expect(newItems[0].prefix).toBe('APP_');
  });

  it('name input updates correct nested key for configMap', () => {
    const onChange = vi.fn();
    render([{ configMapRef: { name: '' } }], onChange);
    const nameInput = container.querySelector(
      '[data-field-key="envFromName-0"] input'
    ) as HTMLInputElement;
    act(() => {
      setNativeInputValue(nameInput, 'new-config');
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    const newItems = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(newItems[0].configMapRef.name).toBe('new-config');
  });

  it('name input updates correct nested key for secret', () => {
    const onChange = vi.fn();
    render([{ secretRef: { name: '' } }], onChange);
    const nameInput = container.querySelector(
      '[data-field-key="envFromName-0"] input'
    ) as HTMLInputElement;
    act(() => {
      setNativeInputValue(nameInput, 'new-secret');
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    const newItems = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(newItems[0].secretRef.name).toBe('new-secret');
  });

  it('prefix input updates prefix field', () => {
    const onChange = vi.fn();
    render([{ configMapRef: { name: 'cm' } }], onChange);
    const prefixInput = container.querySelector(
      '[data-field-key="envFromPrefix-0"] input'
    ) as HTMLInputElement;
    act(() => {
      setNativeInputValue(prefixInput, 'MY_PREFIX_');
      prefixInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    const newItems = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(newItems[0].prefix).toBe('MY_PREFIX_');
  });

  it('clearing prefix removes the prefix key', () => {
    const onChange = vi.fn();
    render([{ configMapRef: { name: 'cm' }, prefix: 'OLD_' }], onChange);
    const prefixInput = container.querySelector(
      '[data-field-key="envFromPrefix-0"] input'
    ) as HTMLInputElement;
    act(() => {
      setNativeInputValue(prefixInput, '');
      prefixInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    const newItems = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(newItems[0].prefix).toBeUndefined();
  });

  it('add button creates new configMap item', () => {
    const onChange = vi.fn();
    render([], onChange);
    const addBtn = container.querySelector('button.resource-form-add-btn') as HTMLElement;
    act(() => addBtn.click());
    expect(onChange).toHaveBeenCalledTimes(1);
    const newItems = onChange.mock.calls[0][0];
    expect(newItems).toHaveLength(1);
    expect(newItems[0]).toEqual({ configMapRef: { name: '' } });
  });

  it('remove button removes item', () => {
    const onChange = vi.fn();
    render(
      [
        { configMapRef: { name: 'cm1' } },
        { secretRef: { name: 's1' } },
      ],
      onChange
    );
    // Remove the first item.
    const removeBtn = container.querySelector(
      '[data-field-key="envFromRemove-0"]'
    ) as HTMLElement;
    act(() => removeBtn.click());
    expect(onChange).toHaveBeenCalledTimes(1);
    const newItems = onChange.mock.calls[0][0];
    expect(newItems).toHaveLength(1);
    expect(newItems[0].secretRef).toEqual({ name: 's1' });
  });

  it('renders multiple items', () => {
    render([
      { configMapRef: { name: 'cm1' } },
      { secretRef: { name: 's1' }, prefix: 'SEC_' },
    ]);
    // Two rows should be rendered.
    const rows = container.querySelectorAll('.resource-form-env-from-row');
    expect(rows.length).toBe(2);
  });
});
