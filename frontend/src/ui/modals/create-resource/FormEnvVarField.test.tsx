import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormEnvVarField } from './FormEnvVarField';

/**
 * Update a text input's native value so React 19's change tracking picks it up.
 *
 * React 19 installs a per-instance property descriptor on text inputs to track
 * the "last committed value". Directly assigning element.value triggers that
 * custom setter and updates the tracker, causing React to suppress the onChange
 * when the change event fires (tracker value === DOM value -> no-op). Using the
 * prototype setter bypasses the tracker so React sees a real value change.
 *
 * This is the same approach used by FormProbeField.test.tsx and
 * FormEnvFromField.test.tsx in this codebase.
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

describe('FormEnvVarField', () => {
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
    const mockOnChange = onChange ?? vi.fn<(newItems: Record<string, unknown>[]) => void>();
    act(() => {
      root.render(<FormEnvVarField dataFieldKey="env" items={items} onChange={mockOnChange} />);
    });
    return mockOnChange;
  };

  it('renders empty state with add button', () => {
    render([]);
    const addBtn = container.querySelector('button.resource-form-add-btn');
    expect(addBtn).not.toBeNull();
    expect(container.textContent).toContain('Add env var');
  });

  it('renders plain value env var with name and value inputs', () => {
    render([{ name: 'MY_VAR', value: 'hello' }]);
    const nameInput = container.querySelector(
      '[data-field-key="envVarName-0"] input'
    ) as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    expect(nameInput.value).toBe('MY_VAR');
    const valueInput = container.querySelector(
      '[data-field-key="envVarValue-0"] input'
    ) as HTMLInputElement;
    expect(valueInput).not.toBeNull();
    expect(valueInput.value).toBe('hello');
  });

  it('detects configMapKeyRef source and renders ref inputs', () => {
    render([
      {
        name: 'CM_VAR',
        valueFrom: { configMapKeyRef: { name: 'my-config', key: 'db-host' } },
      },
    ]);
    // Source dropdown should show ConfigMap.
    const dropdown = container.querySelector(
      '[data-testid="dropdown-Env var source 1"]'
    ) as HTMLSelectElement;
    expect(dropdown.value).toBe('configMap');
    // Ref name and key inputs.
    const refNameInput = container.querySelector(
      '[data-field-key="envVarRefName-0"] input'
    ) as HTMLInputElement;
    expect(refNameInput.value).toBe('my-config');
    const refKeyInput = container.querySelector(
      '[data-field-key="envVarRefKey-0"] input'
    ) as HTMLInputElement;
    expect(refKeyInput.value).toBe('db-host');
    // No plain value input should be rendered.
    const valueInput = container.querySelector('[data-field-key="envVarValue-0"] input');
    expect(valueInput).toBeNull();
  });

  it('detects secretKeyRef source and renders ref inputs', () => {
    render([
      {
        name: 'SECRET_VAR',
        valueFrom: { secretKeyRef: { name: 'my-secret', key: 'password' } },
      },
    ]);
    const dropdown = container.querySelector(
      '[data-testid="dropdown-Env var source 1"]'
    ) as HTMLSelectElement;
    expect(dropdown.value).toBe('secret');
    const refNameInput = container.querySelector(
      '[data-field-key="envVarRefName-0"] input'
    ) as HTMLInputElement;
    expect(refNameInput.value).toBe('my-secret');
    const refKeyInput = container.querySelector(
      '[data-field-key="envVarRefKey-0"] input'
    ) as HTMLInputElement;
    expect(refKeyInput.value).toBe('password');
  });

  it('source dropdown defaults to Value for plain env vars', () => {
    render([{ name: 'PLAIN', value: 'val' }]);
    const dropdown = container.querySelector(
      '[data-testid="dropdown-Env var source 1"]'
    ) as HTMLSelectElement;
    expect(dropdown.value).toBe('value');
  });

  it('switching Value -> ConfigMap preserves name, clears value, initializes configMapKeyRef', () => {
    const onChange = vi.fn();
    render([{ name: 'MY_VAR', value: 'hello' }], onChange);
    const dropdown = container.querySelector(
      '[data-testid="dropdown-Env var source 1"]'
    ) as HTMLSelectElement;
    act(() => {
      dropdown.value = 'configMap';
      dropdown.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const newItems = onChange.mock.calls[0][0];
    expect(newItems[0].name).toBe('MY_VAR');
    expect(newItems[0].value).toBeUndefined();
    expect(newItems[0].valueFrom).toEqual({
      configMapKeyRef: { name: '', key: '' },
    });
  });

  it('switching ConfigMap -> Secret preserves name, swaps ref structure', () => {
    const onChange = vi.fn();
    render(
      [
        {
          name: 'CM_VAR',
          valueFrom: { configMapKeyRef: { name: 'my-cm', key: 'k1' } },
        },
      ],
      onChange
    );
    const dropdown = container.querySelector(
      '[data-testid="dropdown-Env var source 1"]'
    ) as HTMLSelectElement;
    act(() => {
      dropdown.value = 'secret';
      dropdown.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const newItems = onChange.mock.calls[0][0];
    expect(newItems[0].name).toBe('CM_VAR');
    expect(newItems[0].valueFrom).toEqual({
      secretKeyRef: { name: '', key: '' },
    });
  });

  it('switching Secret -> Value preserves name, clears valueFrom, initializes value', () => {
    const onChange = vi.fn();
    render(
      [
        {
          name: 'S_VAR',
          valueFrom: { secretKeyRef: { name: 'sec', key: 'pw' } },
        },
      ],
      onChange
    );
    const dropdown = container.querySelector(
      '[data-testid="dropdown-Env var source 1"]'
    ) as HTMLSelectElement;
    act(() => {
      dropdown.value = 'value';
      dropdown.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalledTimes(1);
    const newItems = onChange.mock.calls[0][0];
    expect(newItems[0].name).toBe('S_VAR');
    expect(newItems[0].value).toBe('');
    expect(newItems[0].valueFrom).toBeUndefined();
  });

  it('name input updates name field regardless of source type', () => {
    const onChange = vi.fn();
    render([{ name: 'OLD', value: 'v' }], onChange);
    const nameInput = container.querySelector(
      '[data-field-key="envVarName-0"] input'
    ) as HTMLInputElement;
    act(() => {
      setNativeInputValue(nameInput, 'NEW_NAME');
      nameInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    const newItems = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(newItems[0].name).toBe('NEW_NAME');
  });

  it('value input updates value for plain vars', () => {
    const onChange = vi.fn();
    render([{ name: 'V', value: '' }], onChange);
    const valueInput = container.querySelector(
      '[data-field-key="envVarValue-0"] input'
    ) as HTMLInputElement;
    act(() => {
      setNativeInputValue(valueInput, 'new-value');
      valueInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    const newItems = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(newItems[0].value).toBe('new-value');
  });

  it('ConfigMap name/key inputs update correct nested paths', () => {
    const onChange = vi.fn();
    render(
      [
        {
          name: 'CM',
          valueFrom: { configMapKeyRef: { name: '', key: '' } },
        },
      ],
      onChange
    );
    // Update ref name.
    const refNameInput = container.querySelector(
      '[data-field-key="envVarRefName-0"] input'
    ) as HTMLInputElement;
    act(() => {
      setNativeInputValue(refNameInput, 'my-config');
      refNameInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    let newItems = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(newItems[0].valueFrom.configMapKeyRef.name).toBe('my-config');
    // Re-render with updated item, then update ref key.
    onChange.mockClear();
    render(
      [
        {
          name: 'CM',
          valueFrom: { configMapKeyRef: { name: 'my-config', key: '' } },
        },
      ],
      onChange
    );
    const refKeyInput = container.querySelector(
      '[data-field-key="envVarRefKey-0"] input'
    ) as HTMLInputElement;
    act(() => {
      setNativeInputValue(refKeyInput, 'db-host');
      refKeyInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    newItems = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(newItems[0].valueFrom.configMapKeyRef.key).toBe('db-host');
  });

  it('Secret name/key inputs update correct nested paths', () => {
    const onChange = vi.fn();
    render(
      [
        {
          name: 'SEC',
          valueFrom: { secretKeyRef: { name: '', key: '' } },
        },
      ],
      onChange
    );
    // Update ref name.
    const refNameInput = container.querySelector(
      '[data-field-key="envVarRefName-0"] input'
    ) as HTMLInputElement;
    act(() => {
      setNativeInputValue(refNameInput, 'my-secret');
      refNameInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    let newItems = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(newItems[0].valueFrom.secretKeyRef.name).toBe('my-secret');
    // Re-render with updated item, then update ref key.
    onChange.mockClear();
    render(
      [
        {
          name: 'SEC',
          valueFrom: { secretKeyRef: { name: 'my-secret', key: '' } },
        },
      ],
      onChange
    );
    const refKeyInput = container.querySelector(
      '[data-field-key="envVarRefKey-0"] input'
    ) as HTMLInputElement;
    act(() => {
      setNativeInputValue(refKeyInput, 'password');
      refKeyInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    newItems = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(newItems[0].valueFrom.secretKeyRef.key).toBe('password');
  });

  it('add button creates new plain value item', () => {
    const onChange = vi.fn();
    render([], onChange);
    const addBtn = container.querySelector('button.resource-form-add-btn') as HTMLElement;
    act(() => addBtn.click());
    expect(onChange).toHaveBeenCalledTimes(1);
    const newItems = onChange.mock.calls[0][0];
    expect(newItems).toHaveLength(1);
    expect(newItems[0]).toEqual({ name: '', value: '' });
  });

  it('remove button removes item', () => {
    const onChange = vi.fn();
    render(
      [
        { name: 'A', value: 'a' },
        { name: 'B', valueFrom: { secretKeyRef: { name: 's', key: 'k' } } },
      ],
      onChange
    );
    // Remove the first item.
    const removeBtn = container.querySelector('.resource-form-remove-btn') as HTMLElement;
    act(() => removeBtn.click());
    expect(onChange).toHaveBeenCalledTimes(1);
    const newItems = onChange.mock.calls[0][0];
    expect(newItems).toHaveLength(1);
    expect(newItems[0].name).toBe('B');
  });

  it('renders multiple mixed items', () => {
    render([
      { name: 'PLAIN', value: 'hello' },
      { name: 'CM', valueFrom: { configMapKeyRef: { name: 'cm', key: 'k' } } },
      { name: 'SEC', valueFrom: { secretKeyRef: { name: 's', key: 'k' } } },
    ]);
    const rows = container.querySelectorAll('.resource-form-env-var-row');
    expect(rows.length).toBe(3);
  });
});
