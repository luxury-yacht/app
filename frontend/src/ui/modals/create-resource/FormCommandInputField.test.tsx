import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormCommandInputField } from './FormCommandInputField';
import type { FormFieldDefinition } from './formDefinitions';

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

const setNativeInputValue = (element: HTMLInputElement | HTMLTextAreaElement, value: string) => {
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

/** Minimal field definition for tests. */
const testField: FormFieldDefinition = {
  key: 'command',
  label: 'Command',
  path: ['command'],
  type: 'command-input',
  placeholder: '/bin/sh',
};

describe('FormCommandInputField', () => {
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

  it('renders add button when value is undefined and onAdd is provided', () => {
    const onAdd = vi.fn();
    act(() => {
      root.render(
        <FormCommandInputField
          field={testField}
          value={undefined}
          onChange={vi.fn()}
          onAdd={onAdd}
        />
      );
    });
    const addBtn = container.querySelector('button.resource-form-icon-btn') as HTMLElement;
    expect(addBtn).not.toBeNull();
    expect(container.textContent).toContain('Add command');
    act(() => addBtn.click());
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('renders input in command mode with existing value', () => {
    act(() => {
      root.render(
        <FormCommandInputField
          field={testField}
          value={['/bin/sh', '-c', 'echo hello']}
          onChange={vi.fn()}
        />
      );
    });
    const input = container.querySelector('input.resource-form-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    // Should not render a textarea in command mode.
    expect(container.querySelector('textarea')).toBeNull();
  });

  it('commits parsed value on blur in command mode', () => {
    const onChange = vi.fn();
    act(() => {
      root.render(<FormCommandInputField field={testField} value={[]} onChange={onChange} />);
    });
    const input = container.querySelector('input.resource-form-input') as HTMLInputElement;
    act(() => {
      setNativeInputValue(input, 'echo hello');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => {
      // React 18 delegates onBlur via focusout (which bubbles).
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(lastCall).toEqual(['echo', 'hello']);
  });

  it('renders textarea in script mode', () => {
    act(() => {
      root.render(
        <FormCommandInputField
          field={testField}
          value={['#!/bin/bash\necho hello']}
          onChange={vi.fn()}
        />
      );
    });
    // Script mode uses textarea.
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea).not.toBeNull();
  });

  it('mode switching reformats text and calls onChange', () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <FormCommandInputField field={testField} value={['echo', 'hello']} onChange={onChange} />
      );
    });
    // Switch to script mode.
    const modeDropdown = container.querySelector(
      '[data-testid="dropdown-Command input mode"]'
    ) as HTMLSelectElement;
    act(() => {
      modeDropdown.value = 'script';
      modeDropdown.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
  });

  it('resets displayed text when external value changes', () => {
    const onChange = vi.fn();
    const Wrapper = ({ val }: { val: string[] }) => (
      <FormCommandInputField field={testField} value={val} onChange={onChange} />
    );
    act(() => {
      root.render(<Wrapper val={['echo', 'hello']} />);
    });
    const input = container.querySelector('input.resource-form-input') as HTMLInputElement;
    expect(input.value).toContain('echo');
    // Re-render with a different value from outside (e.g., YAML editor change).
    act(() => {
      root.render(<Wrapper val={['ls', '-la']} />);
    });
    const updatedInput = container.querySelector('input.resource-form-input') as HTMLInputElement;
    expect(updatedInput.value).toContain('ls');
  });

  it('renders remove button when onRemove is provided', () => {
    const onRemove = vi.fn();
    act(() => {
      root.render(
        <FormCommandInputField
          field={testField}
          value={['echo']}
          onChange={vi.fn()}
          onRemove={onRemove}
        />
      );
    });
    const removeBtn = container.querySelector('.resource-form-probe-actions button') as HTMLElement;
    expect(removeBtn).not.toBeNull();
    act(() => removeBtn.click());
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('shows error for invalid YAML in raw-yaml mode', () => {
    act(() => {
      root.render(<FormCommandInputField field={testField} value={['item1']} onChange={vi.fn()} />);
    });
    // Switch to raw-yaml mode.
    const modeDropdown = container.querySelector(
      '[data-testid="dropdown-Command input mode"]'
    ) as HTMLSelectElement;
    act(() => {
      modeDropdown.value = 'raw-yaml';
      modeDropdown.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    // Enter invalid YAML and blur.
    act(() => {
      setNativeInputValue(textarea, '{ invalid: [');
      textarea.dispatchEvent(new Event('input', { bubbles: true }));
      textarea.dispatchEvent(new Event('change', { bubbles: true }));
    });
    act(() => {
      // React 18 delegates onBlur via focusout (which bubbles).
      textarea.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    const errorSpan = container.querySelector('.resource-form-command-input-error');
    expect(errorSpan).not.toBeNull();
    expect(errorSpan!.textContent).toContain('Invalid YAML');
  });
});
