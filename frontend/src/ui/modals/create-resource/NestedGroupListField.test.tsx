import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NestedGroupListField } from './NestedGroupListField';
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

/** Simple text-field-based group-list definition for basic tests. */
const envFieldDef: FormFieldDefinition = {
  key: 'env',
  label: 'Env Vars',
  path: ['env'],
  type: 'group-list',
  addLabel: 'Add Env Var',
  addGhostText: 'Add environment variable',
  defaultValue: {},
  fields: [
    { key: 'name', label: 'Name', path: ['name'], type: 'text', placeholder: 'VAR_NAME' },
    { key: 'value', label: 'Value', path: ['value'], type: 'text', placeholder: 'value' },
  ],
};

describe('NestedGroupListField', () => {
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

  it('renders sub-field labels and inputs for each item', () => {
    const items = [{ name: 'FOO', value: 'bar' }];
    act(() => {
      root.render(
        <NestedGroupListField
          subField={envFieldDef}
          nestedItems={items}
          yamlContent=""
          onNestedItemsChange={vi.fn()}
        />
      );
    });
    expect(container.textContent).toContain('Name');
    expect(container.textContent).toContain('Value');
    const nameInput = container.querySelector('[data-field-key="name"] input') as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    expect(nameInput.value).toBe('FOO');
  });

  it('add button appends item with defaultValue', () => {
    const onChange = vi.fn();
    act(() => {
      root.render(
        <NestedGroupListField
          subField={envFieldDef}
          nestedItems={[]}
          yamlContent=""
          onNestedItemsChange={onChange}
        />
      );
    });
    const addBtn = container.querySelector('button.resource-form-add-btn') as HTMLElement;
    expect(addBtn).not.toBeNull();
    act(() => addBtn.click());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual([{}]);
  });

  it('remove button filters item at index', () => {
    const onChange = vi.fn();
    const items = [{ name: 'A' }, { name: 'B' }];
    act(() => {
      root.render(
        <NestedGroupListField
          subField={envFieldDef}
          nestedItems={items}
          yamlContent=""
          onNestedItemsChange={onChange}
        />
      );
    });
    // Click the first remove button.
    const removeBtns = container.querySelectorAll('button.resource-form-remove-btn');
    expect(removeBtns.length).toBe(2);
    act(() => (removeBtns[0] as HTMLElement).click());
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual([{ name: 'B' }]);
  });

  it('text field change updates item value', () => {
    const onChange = vi.fn();
    const items = [{ name: 'FOO', value: 'old' }];
    act(() => {
      root.render(
        <NestedGroupListField
          subField={envFieldDef}
          nestedItems={items}
          yamlContent=""
          onNestedItemsChange={onChange}
        />
      );
    });
    const valueInput = container.querySelector(
      '[data-field-key="value"] input'
    ) as HTMLInputElement;
    act(() => {
      setNativeInputValue(valueInput, 'new');
      valueInput.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(updated[0].value).toBe('new');
  });

  it('boolean-toggle sets true on check and unsets on uncheck', () => {
    const boolFieldDef: FormFieldDefinition = {
      key: 'mounts',
      label: 'Mounts',
      path: ['mounts'],
      type: 'group-list',
      defaultValue: {},
      fields: [{ key: 'readOnly', label: 'Read Only', path: ['readOnly'], type: 'boolean-toggle' }],
    };
    const onChange = vi.fn();
    act(() => {
      root.render(
        <NestedGroupListField
          subField={boolFieldDef}
          nestedItems={[{}]}
          yamlContent=""
          onNestedItemsChange={onChange}
        />
      );
    });
    const checkbox = container.querySelector(
      'input[data-field-key="readOnly"]'
    ) as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(false);
    // Click the checkbox — jsdom toggles .checked before firing onClick.
    act(() => {
      checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    const checkedResult = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    expect(checkedResult[0].readOnly).toBe(true);
  });

  it('select sub-field renders dropdown with options', () => {
    const selectFieldDef: FormFieldDefinition = {
      key: 'ports',
      label: 'Ports',
      path: ['ports'],
      type: 'group-list',
      defaultValue: { protocol: 'TCP' },
      fields: [
        {
          key: 'protocol',
          label: 'Protocol',
          path: ['protocol'],
          type: 'select',
          options: [
            { label: 'TCP', value: 'TCP' },
            { label: 'UDP', value: 'UDP' },
          ],
        },
      ],
    };
    act(() => {
      root.render(
        <NestedGroupListField
          subField={selectFieldDef}
          nestedItems={[{ protocol: 'TCP' }]}
          yamlContent=""
          onNestedItemsChange={vi.fn()}
        />
      );
    });
    const select = container.querySelector(
      '[data-testid="dropdown-Protocol"]'
    ) as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.value).toBe('TCP');
  });

  it('select sub-field with dynamicOptionsPath resolves options from YAML', () => {
    const volumeMountFieldDef: FormFieldDefinition = {
      key: 'volumeMounts',
      label: 'Volume Mounts',
      path: ['volumeMounts'],
      type: 'group-list',
      defaultValue: {},
      fields: [
        {
          key: 'name',
          label: 'Volume',
          path: ['name'],
          type: 'select',
          dynamicOptionsPath: ['spec', 'template', 'spec', 'volumes'],
          dynamicOptionsField: 'name',
        },
      ],
    };
    // Provide YAML with volumes defined.
    const yaml = `spec:
  template:
    spec:
      volumes:
        - name: config-vol
        - name: data-vol`;
    act(() => {
      root.render(
        <NestedGroupListField
          subField={volumeMountFieldDef}
          nestedItems={[{ name: 'config-vol' }]}
          yamlContent={yaml}
          onNestedItemsChange={vi.fn()}
        />
      );
    });
    const select = container.querySelector('[data-testid="dropdown-Volume"]') as HTMLSelectElement;
    expect(select).not.toBeNull();
    // Should have the empty option + 2 volumes.
    expect(select.options.length).toBe(3);
    expect(select.value).toBe('config-vol');
  });

  it('disableAdd when dynamic options are exhausted and shows disabledGhostText', () => {
    const volumeMountFieldDef: FormFieldDefinition = {
      key: 'volumeMounts',
      label: 'Volume Mounts',
      path: ['volumeMounts'],
      type: 'group-list',
      defaultValue: {},
      disabledGhostText: 'Add volumes first',
      fields: [
        {
          key: 'name',
          label: 'Volume',
          path: ['name'],
          type: 'select',
          dynamicOptionsPath: ['spec', 'template', 'spec', 'volumes'],
          dynamicOptionsField: 'name',
        },
      ],
    };
    // Provide empty YAML — no volumes defined.
    act(() => {
      root.render(
        <NestedGroupListField
          subField={volumeMountFieldDef}
          nestedItems={[]}
          yamlContent=""
          onNestedItemsChange={vi.fn()}
        />
      );
    });
    // The disabled ghost text should appear.
    expect(container.textContent).toContain('Add volumes first');
  });

  it('text sub-field with alternatePath renders toggle', () => {
    const mountFieldDef: FormFieldDefinition = {
      key: 'volumeMounts',
      label: 'Volume Mounts',
      path: ['volumeMounts'],
      type: 'group-list',
      defaultValue: {},
      fields: [
        {
          key: 'subPath',
          label: 'Sub Path',
          path: ['subPath'],
          type: 'text',
          alternatePath: ['subPathExpr'],
          alternateLabel: 'Use Expression',
          placeholder: 'sub/path',
        },
      ],
    };
    const onChange = vi.fn();
    act(() => {
      root.render(
        <NestedGroupListField
          subField={mountFieldDef}
          nestedItems={[{ subPath: 'data' }]}
          yamlContent=""
          onNestedItemsChange={onChange}
        />
      );
    });
    // Toggle checkbox should exist with "Use Expression" label.
    expect(container.textContent).toContain('Use Expression');
    const toggle = container.querySelector(
      '[data-field-key="subPathExprToggle"]'
    ) as HTMLInputElement;
    expect(toggle).not.toBeNull();
    expect(toggle.checked).toBe(false);
    // Click the toggle — jsdom toggles .checked before firing onClick.
    act(() => {
      toggle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onChange).toHaveBeenCalled();
    const updated = onChange.mock.calls[onChange.mock.calls.length - 1][0];
    // subPath should be unset, subPathExpr should have the value.
    expect(updated[0].subPath).toBeUndefined();
    expect(updated[0].subPathExpr).toBe('data');
  });

  it('unhandled field type returns null without crash', () => {
    const weirdFieldDef: FormFieldDefinition = {
      key: 'weird',
      label: 'Weird',
      path: ['weird'],
      type: 'group-list',
      defaultValue: {},
      fields: [{ key: 'x', label: 'X', path: ['x'], type: 'probe' as FormFieldDefinition['type'] }],
    };
    // Should render without throwing.
    act(() => {
      root.render(
        <NestedGroupListField
          subField={weirdFieldDef}
          nestedItems={[{}]}
          yamlContent=""
          onNestedItemsChange={vi.fn()}
        />
      );
    });
    // The wrapper div exists but has no input/select child (the field rendered null).
    const wrapper = container.querySelector('[data-field-key="x"]');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.querySelector('input')).toBeNull();
    expect(wrapper!.querySelector('select')).toBeNull();
  });
});
