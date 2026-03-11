# Phase 3B: valueFrom for Env Vars — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain name/value env var field with a `FormEnvVarField` component supporting valueFrom references (configMapKeyRef, secretKeyRef).

**Architecture:** New `FormEnvVarField` component manages its own list rendering with a per-row source type dropdown (Value/ConfigMap/Secret) that swaps between plain value and nested ref structures. Integrated via `'env-var'` field type dispatched from `GroupListField.renderSubField`, same pattern as `FormEnvFromField`.

**Tech Stack:** React, TypeScript, vitest

**Spec:** `docs/plans/2026-03-10-create-resource-phase3b-design.md`

---

## File Structure

All paths relative to `frontend/src/ui/modals/create-resource/`.

| File | Action | Responsibility |
|------|--------|----------------|
| `FormEnvVarField.tsx` | Create | New component: env var list with source type switching |
| `FormEnvVarField.test.tsx` | Create | Unit tests for the component |
| `formDefinitions/types.ts` | Modify | Add `'env-var'` to field type union |
| `formDefinitions/shared.ts` | Modify | Replace env group-list with `type: 'env-var'` |
| `ResourceForm.tsx` | Modify | Add import + dispatch case for `'env-var'` |
| `ResourceForm.css` | Modify | Add `resource-form-env-var-*` CSS classes |
| `formDefinitions.test.ts` | Modify | Add type assertions for env field |

---

## Chunk 1: Component + Tests

### Task 1: Add `'env-var'` to the field type union

**Files:**
- Modify: `formDefinitions/types.ts:22-38`

- [ ] **Step 1: Add `'env-var'` to the type union**

In `formDefinitions/types.ts`, add `| 'env-var'` after `| 'env-from'` on line 38:

```ts
    | 'probe'
    | 'env-from'
    | 'env-var';
```

- [ ] **Step 2: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (no type errors)

---

### Task 2: Create `FormEnvVarField.test.tsx` with all tests

**Files:**
- Create: `FormEnvVarField.test.tsx`

- [ ] **Step 1: Create the test file with all test cases**

Create `frontend/src/ui/modals/create-resource/FormEnvVarField.test.tsx`:

```tsx
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
    const mockOnChange =
      onChange ?? vi.fn<(newItems: Record<string, unknown>[]) => void>();
    act(() => {
      root.render(
        <FormEnvVarField
          dataFieldKey="env"
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
    render([{
      name: 'CM_VAR',
      valueFrom: { configMapKeyRef: { name: 'my-config', key: 'db-host' } },
    }]);
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
    const valueInput = container.querySelector(
      '[data-field-key="envVarValue-0"] input'
    );
    expect(valueInput).toBeNull();
  });

  it('detects secretKeyRef source and renders ref inputs', () => {
    render([{
      name: 'SECRET_VAR',
      valueFrom: { secretKeyRef: { name: 'my-secret', key: 'password' } },
    }]);
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
    render([{
      name: 'CM_VAR',
      valueFrom: { configMapKeyRef: { name: 'my-cm', key: 'k1' } },
    }], onChange);
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
    render([{
      name: 'S_VAR',
      valueFrom: { secretKeyRef: { name: 'sec', key: 'pw' } },
    }], onChange);
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
    render([{
      name: 'CM',
      valueFrom: { configMapKeyRef: { name: '', key: '' } },
    }], onChange);
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
    render([{
      name: 'CM',
      valueFrom: { configMapKeyRef: { name: 'my-config', key: '' } },
    }], onChange);
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
    render([{
      name: 'SEC',
      valueFrom: { secretKeyRef: { name: '', key: '' } },
    }], onChange);
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
    render([{
      name: 'SEC',
      valueFrom: { secretKeyRef: { name: 'my-secret', key: '' } },
    }], onChange);
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
    render([
      { name: 'A', value: 'a' },
      { name: 'B', valueFrom: { secretKeyRef: { name: 's', key: 'k' } } },
    ], onChange);
    // Remove the first item.
    const removeBtn = container.querySelector(
      '[data-field-key="envVarRemove-0"]'
    ) as HTMLElement;
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/ui/modals/create-resource/FormEnvVarField.test.tsx`
Expected: FAIL — `FormEnvVarField` module does not exist yet.

---

### Task 3: Create `FormEnvVarField.tsx` component

**Files:**
- Create: `FormEnvVarField.tsx`

- [ ] **Step 1: Create the component file**

Create `frontend/src/ui/modals/create-resource/FormEnvVarField.tsx`:

```tsx
/**
 * Env var field editor.
 *
 * Renders a list of env var items, each with a name input, a source type
 * dropdown (Value/ConfigMap/Secret), and dynamic fields depending on the
 * source. Handles the YAML mapping between the flat UI model and the nested
 * valueFrom.configMapKeyRef / valueFrom.secretKeyRef structure.
 */

import React from 'react';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';
import { INPUT_BEHAVIOR_PROPS } from './formUtils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One item in the env array.
 * Uses Record<string, unknown> for the public API to match the dispatch layer's
 * untyped item model. Internally we type-narrow via getSourceType helpers.
 */
type EnvVarItem = Record<string, unknown>;

interface FormEnvVarFieldProps {
  /** data-field-key for the wrapper element. */
  dataFieldKey: string;
  /** Current env items from YAML. */
  items: EnvVarItem[];
  /** Callback when items change. */
  onChange: (newItems: EnvVarItem[]) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SourceType = 'value' | 'configMap' | 'secret';

const sourceTypeOptions = [
  { value: 'value', label: 'Value' },
  { value: 'configMap', label: 'ConfigMap' },
  { value: 'secret', label: 'Secret' },
];

/** Detect the source type of an env var item from its YAML structure. */
function getSourceType(item: EnvVarItem): SourceType {
  const valueFrom = item.valueFrom as Record<string, unknown> | undefined;
  if (valueFrom?.configMapKeyRef) return 'configMap';
  if (valueFrom?.secretKeyRef) return 'secret';
  return 'value';
}

/** Get the ref name from a configMapKeyRef or secretKeyRef. */
function getRefName(item: EnvVarItem): string {
  const valueFrom = item.valueFrom as Record<string, unknown> | undefined;
  const ref = (valueFrom?.configMapKeyRef ?? valueFrom?.secretKeyRef) as
    | { name?: string }
    | undefined;
  return ref?.name ?? '';
}

/** Get the ref key from a configMapKeyRef or secretKeyRef. */
function getRefKey(item: EnvVarItem): string {
  const valueFrom = item.valueFrom as Record<string, unknown> | undefined;
  const ref = (valueFrom?.configMapKeyRef ?? valueFrom?.secretKeyRef) as
    | { key?: string }
    | undefined;
  return ref?.key ?? '';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FormEnvVarField({
  dataFieldKey,
  items,
  onChange,
}: FormEnvVarFieldProps): React.ReactElement {
  /** Update a single item in the list. */
  const updateItem = (index: number, updater: (item: EnvVarItem) => EnvVarItem) => {
    const newItems = items.map((it, i) => (i === index ? updater(it) : it));
    onChange(newItems);
  };

  /** Handle source type change — swap between value / configMapKeyRef / secretKeyRef. */
  const handleSourceTypeChange = (index: number, newType: SourceType) => {
    updateItem(index, (item) => {
      const name = (item.name as string) ?? '';
      if (newType === 'value') {
        return { name, value: '' };
      }
      if (newType === 'configMap') {
        return { name, valueFrom: { configMapKeyRef: { name: '', key: '' } } };
      }
      // secret
      return { name, valueFrom: { secretKeyRef: { name: '', key: '' } } };
    });
  };

  /** Handle env var name input change. */
  const handleNameChange = (index: number, newName: string) => {
    updateItem(index, (item) => ({ ...item, name: newName }));
  };

  /** Handle plain value input change. */
  const handleValueChange = (index: number, newValue: string) => {
    updateItem(index, (item) => ({ ...item, value: newValue }));
  };

  /** Handle ref name input change (ConfigMap name or Secret name). */
  const handleRefNameChange = (index: number, newRefName: string) => {
    updateItem(index, (item) => {
      const sourceType = getSourceType(item);
      const refKey = getRefKey(item);
      if (sourceType === 'configMap') {
        return { ...item, valueFrom: { configMapKeyRef: { name: newRefName, key: refKey } } };
      }
      return { ...item, valueFrom: { secretKeyRef: { name: newRefName, key: refKey } } };
    });
  };

  /** Handle ref key input change. */
  const handleRefKeyChange = (index: number, newRefKey: string) => {
    updateItem(index, (item) => {
      const sourceType = getSourceType(item);
      const refName = getRefName(item);
      if (sourceType === 'configMap') {
        return { ...item, valueFrom: { configMapKeyRef: { name: refName, key: newRefKey } } };
      }
      return { ...item, valueFrom: { secretKeyRef: { name: refName, key: newRefKey } } };
    });
  };

  /** Add a new env var item defaulting to plain value. */
  const handleAdd = () => {
    onChange([...items, { name: '', value: '' }]);
  };

  /** Remove an item by index. */
  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <div data-field-key={dataFieldKey} className="resource-form-env-var">
      {items.map((item, index) => {
        const sourceType = getSourceType(item);
        const envName = (item.name as string) ?? '';
        // 1-based label for accessibility (e.g., "Env var source 1").
        const rowLabel = index + 1;

        return (
          <div key={index} className="resource-form-env-var-row">
            {/* Env var name input */}
            <div
              data-field-key={`envVarName-${index}`}
              className="resource-form-env-var-name"
            >
              <input
                {...INPUT_BEHAVIOR_PROPS}
                className="resource-form-input"
                type="text"
                value={envName}
                onChange={(e) => handleNameChange(index, e.target.value)}
                placeholder="name"
                aria-label={`Env var name ${rowLabel}`}
              />
            </div>

            {/* Source type dropdown */}
            <div className="resource-form-env-var-source">
              <Dropdown
                options={sourceTypeOptions}
                value={sourceType}
                onChange={(val) =>
                  handleSourceTypeChange(index, val as SourceType)
                }
                ariaLabel={`Env var source ${rowLabel}`}
              />
            </div>

            {/* Dynamic fields based on source type */}
            {sourceType === 'value' && (
              <div
                data-field-key={`envVarValue-${index}`}
                className="resource-form-env-var-value"
              >
                <input
                  {...INPUT_BEHAVIOR_PROPS}
                  className="resource-form-input"
                  type="text"
                  value={(item.value as string) ?? ''}
                  onChange={(e) => handleValueChange(index, e.target.value)}
                  placeholder="value"
                  aria-label={`Env var value ${rowLabel}`}
                />
              </div>
            )}

            {(sourceType === 'configMap' || sourceType === 'secret') && (
              <>
                <div
                  data-field-key={`envVarRefName-${index}`}
                  className="resource-form-env-var-ref-name"
                >
                  <input
                    {...INPUT_BEHAVIOR_PROPS}
                    className="resource-form-input"
                    type="text"
                    value={getRefName(item)}
                    onChange={(e) => handleRefNameChange(index, e.target.value)}
                    placeholder={sourceType === 'configMap' ? 'configmap name' : 'secret name'}
                    aria-label={`Env var ref name ${rowLabel}`}
                  />
                </div>
                <div
                  data-field-key={`envVarRefKey-${index}`}
                  className="resource-form-env-var-ref-key"
                >
                  <input
                    {...INPUT_BEHAVIOR_PROPS}
                    className="resource-form-input"
                    type="text"
                    value={getRefKey(item)}
                    onChange={(e) => handleRefKeyChange(index, e.target.value)}
                    placeholder="key"
                    aria-label={`Env var ref key ${rowLabel}`}
                  />
                </div>
              </>
            )}

            {/* Remove button */}
            <button
              data-field-key={`envVarRemove-${index}`}
              type="button"
              className="resource-form-icon-btn"
              onClick={() => handleRemove(index)}
              aria-label={`Remove env var ${rowLabel}`}
            >
              ✕
            </button>
          </div>
        );
      })}

      {/* Add button */}
      <button
        type="button"
        className="resource-form-add-btn"
        onClick={handleAdd}
      >
        Add env var
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/ui/modals/create-resource/FormEnvVarField.test.tsx`
Expected: PASS — all 15 tests green.

---

## Chunk 2: Integration + CSS + Definition Tests

### Task 4: Add CSS classes for `FormEnvVarField`

**Files:**
- Modify: `ResourceForm.css:789` (append after the env-from CSS block)

- [ ] **Step 1: Add the CSS classes**

Append the following after the existing `.resource-form-env-from-prefix` block (after line 788) in `frontend/src/ui/modals/create-resource/ResourceForm.css`:

```css

/* ── Env Var field (env var rows with source switching) ────────────────── */

.resource-form-env-var {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.resource-form-env-var-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
}

.resource-form-env-var-name {
  flex: 0 0 auto;
  width: calc(25ch + 20px);
}

.resource-form-env-var-source {
  flex: 0 0 10rem;
  min-width: 10rem;
}

.resource-form-env-var-source .dropdown {
  display: inline-block;
  width: auto;
}

.resource-form-env-var-source .dropdown-menu {
  width: 100%;
  min-width: 0;
}

.resource-form-env-var-value {
  flex: 1;
  min-width: 0;
}

.resource-form-env-var-ref-name {
  flex: 1;
  min-width: 0;
}

.resource-form-env-var-ref-key {
  flex: 1;
  min-width: 0;
}
```

- [ ] **Step 2: Verify existing tests still pass**

Run: `cd frontend && npx vitest run src/ui/modals/create-resource/FormEnvVarField.test.tsx`
Expected: PASS (CSS changes don't affect test behavior, but confirm nothing broke)

---

### Task 5: Add dispatch case and import in `ResourceForm.tsx`

**Files:**
- Modify: `ResourceForm.tsx:28` (add import)
- Modify: `ResourceForm.tsx:1084` (add case before `default`)

- [ ] **Step 1: Add the import**

In `frontend/src/ui/modals/create-resource/ResourceForm.tsx`, add the import after the existing `FormEnvFromField` import on line 28:

```ts
import { FormEnvVarField } from './FormEnvVarField';
```

So lines 28-29 become:

```ts
import { FormEnvFromField } from './FormEnvFromField';
import { FormEnvVarField } from './FormEnvVarField';
```

- [ ] **Step 2: Add the `'env-var'` case**

In the same file, inside the `renderSubField` closure in `GroupListField`, add the `'env-var'` case immediately after the `'env-from'` case closing brace (after line 1084). Insert before the `default:` case:

```tsx
      case 'env-var': {
        // subValue = getNestedValue(item, subField.path), already computed above.
        const envItems = Array.isArray(subValue) ? (subValue as Record<string, unknown>[]) : [];
        return (
          <FormEnvVarField
            dataFieldKey={subField.key}
            items={envItems}
            onChange={(newItems) => {
              if (newItems.length > 0) {
                handleSubFieldChange(itemIndex, subField, newItems);
              } else {
                // Empty array -> remove the key from YAML entirely.
                const updatedItems = items.map((currentItem, i) => {
                  if (i !== itemIndex) return currentItem;
                  return unsetNestedValue(currentItem, subField.path);
                });
                updateItems(updatedItems);
              }
            }}
          />
        );
      }
```

- [ ] **Step 3: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

---

### Task 6: Update form definition in `shared.ts`

**Files:**
- Modify: `formDefinitions/shared.ts:57-86`

- [ ] **Step 1: Replace the env group-list field with `'env-var'` type**

In `frontend/src/ui/modals/create-resource/formDefinitions/shared.ts`, replace the env field (lines 57-86):

Replace this:

```ts
    {
      key: 'env',
      label: 'Env Vars',
      path: ['env'],
      type: 'group-list',
      leftAlignEmptyActions: true,
      addGhostText: 'Add env var',
      fieldGap: 'wide',
      fields: [
        {
          key: 'name',
          label: 'Name',
          path: ['name'],
          type: 'text',
          placeholder: 'name',
          fieldFlex: '0 0 auto',
          inputWidth: 'calc(25ch + 20px)',
        },
        {
          key: 'value',
          label: 'Value',
          path: ['value'],
          type: 'text',
          placeholder: 'value',
          fieldFlex: '0 0 auto',
          inputWidth: 'calc(25ch + 20px)',
        },
      ],
      defaultValue: { name: '', value: '' },
    },
```

With:

```ts
    // env — individual env vars with optional valueFrom (configMapKeyRef/secretKeyRef).
    // Rendered by FormEnvVarField; handles source type switching internally.
    {
      key: 'env',
      label: 'Env Vars',
      path: ['env'],
      type: 'env-var',
    },
```

- [ ] **Step 2: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

---

### Task 7: Add `formDefinitions.test.ts` assertions

**Files:**
- Modify: `formDefinitions.test.ts:146-151` (add tests near existing env-from assertion)

- [ ] **Step 1: Add env-var type assertions**

In `frontend/src/ui/modals/create-resource/formDefinitions.test.ts`, add the following test immediately after the existing `'has containers with envFrom field of type env-from'` test (after line 151):

```ts
      it('has containers with env field of type env-var', () => {
        const containers = findField(def, 'containers')!;
        const env = findSubField(containers, 'env');
        expect(env).toBeDefined();
        expect(env!.type).toBe('env-var');
      });

      it('has initContainers with env field of type env-var', () => {
        const initContainers = findField(def, 'initContainers')!;
        const env = findSubField(initContainers, 'env');
        expect(env).toBeDefined();
        expect(env!.type).toBe('env-var');
      });
```

- [ ] **Step 2: Run all form definition tests**

Run: `cd frontend && npx vitest run src/ui/modals/create-resource/formDefinitions.test.ts`
Expected: PASS — all existing + 6 new tests (2 per resource type) pass.

---

### Task 8: Run full test suite

- [ ] **Step 1: Run all create-resource tests**

Run: `cd frontend && npx vitest run src/ui/modals/create-resource/`
Expected: PASS — all tests pass including:
- `FormEnvVarField.test.tsx` (15 tests)
- `FormEnvFromField.test.tsx` (12 tests)
- `formDefinitions.test.ts` (67+ tests)
- `ResourceForm.test.tsx` (existing tests)
- All other test files in the directory

- [ ] **Step 2: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Run linting**

Run: `cd frontend && npx eslint src/ui/modals/create-resource/FormEnvVarField.tsx src/ui/modals/create-resource/FormEnvVarField.test.tsx src/ui/modals/create-resource/ResourceForm.tsx src/ui/modals/create-resource/formDefinitions/shared.ts`
Expected: PASS (no lint errors)
