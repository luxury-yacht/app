# Phase 3A: initContainers & envFrom Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add initContainers sections to Deployment/Job/CronJob and envFrom support inside container cards.

**Architecture:** initContainers reuse the existing `makeContainerSubFields` factory — purely declarative additions to form definitions. envFrom requires a new `FormEnvFromField` component (~100-150 lines) that handles source type switching between ConfigMap/Secret, integrated via a new `'env-from'` field type in the dispatch system.

**Tech Stack:** React, TypeScript, Vitest

**Spec:** `docs/plans/2026-03-10-create-resource-phase3a-design.md`

---

## Chunk 1: initContainers + envFrom

### Task 1: Add `'env-from'` to the field type union

**Files:**
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/types.ts:22-37`

- [ ] **Step 1: Add `'env-from'` to the type union**

In `frontend/src/ui/modals/create-resource/formDefinitions/types.ts`, add `'env-from'` after `'probe'` in the type union (line 37):

```ts
    | 'command-input'
    | 'probe'
    | 'env-from';
```

- [ ] **Step 2: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (no errors)

---

### Task 2: Add envFrom field to shared container sub-fields

**Files:**
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/shared.ts:57-86`

The `env` field in `makeContainerSubFields` spans lines 58-86 (key `'env'`, type `'group-list'`). Add the envFrom field immediately after it.

- [ ] **Step 1: Write the failing test**

In `frontend/src/ui/modals/create-resource/formDefinitions.test.ts`, add a new test inside the existing `describe('shared field coverage across pod-template definitions')` block (after the `'has containers with env, ports, and volumeMounts'` test at line 144):

```ts
      it('has containers with envFrom field of type env-from', () => {
        const containers = findField(def, 'containers')!;
        const envFrom = findSubField(containers, 'envFrom');
        expect(envFrom).toBeDefined();
        expect(envFrom!.type).toBe('env-from');
      });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/ui/modals/create-resource/formDefinitions.test.ts`
Expected: FAIL — `envFrom` sub-field not found

- [ ] **Step 3: Add envFrom field to makeContainerSubFields**

In `frontend/src/ui/modals/create-resource/formDefinitions/shared.ts`, add after the `env` group-list field (after line 86, before the `ports` field):

```ts
    // envFrom — bulk import env vars from ConfigMaps/Secrets.
    // Rendered by FormEnvFromField; handles configMapRef/secretRef switching internally.
    {
      key: 'envFrom',
      label: 'Env From',
      path: ['envFrom'],
      type: 'env-from' as const,
    },
```

Note: `as const` is needed because `'env-from'` must satisfy the union type. If the codebase doesn't use `as const` elsewhere for field types, omit it — the string literal will be inferred correctly from the object literal context.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/ui/modals/create-resource/formDefinitions.test.ts`
Expected: PASS

---

### Task 3: Add initContainers sections to all resource definitions

**Files:**
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/deployment.ts:111-112`
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/job.ts:151-152`
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/cronJob.ts:169-170`
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions.test.ts`

Each resource has a Containers section immediately followed by a Volumes section. Insert the Init Containers section between them.

- [ ] **Step 1: Write the failing tests**

In `frontend/src/ui/modals/create-resource/formDefinitions.test.ts`, add inside the shared coverage `describe` block (after the envFrom test from Task 2):

```ts
      it('has initContainers section with correct path and properties', () => {
        const initContainers = findField(def, 'initContainers')!;
        expect(initContainers).toBeDefined();
        expect(initContainers.type).toBe('group-list');
        expect(initContainers.fullWidth).toBe(true);
        expect(initContainers.itemTitleField).toBe('name');
        expect(initContainers.itemTitleFallback).toBe('Init Container');
      });

      it('initContainers has key sub-fields matching containers', () => {
        const initContainers = findField(def, 'initContainers')!;
        expect(findSubField(initContainers, 'readinessProbe')).toBeDefined();
        expect(findSubField(initContainers, 'livenessProbe')).toBeDefined();
        expect(findSubField(initContainers, 'startupProbe')).toBeDefined();
        expect(findSubField(initContainers, 'env')).toBeDefined();
        expect(findSubField(initContainers, 'ports')).toBeDefined();
        expect(findSubField(initContainers, 'volumeMounts')).toBeDefined();
        expect(findSubField(initContainers, 'envFrom')).toBeDefined();
      });
```

Also add path-specific tests. In the **Deployment-specific** `describe` block (after line 198):

```ts
  it('initContainers uses Deployment path', () => {
    const def = getFormDefinition('Deployment')!;
    const initContainers = findField(def, 'initContainers')!;
    expect(initContainers.path).toEqual(['spec', 'template', 'spec', 'initContainers']);
  });
```

In the **Job-specific** `describe` block (after line 240):

```ts
  it('initContainers uses Job path', () => {
    const def = getFormDefinition('Job')!;
    const initContainers = findField(def, 'initContainers')!;
    expect(initContainers.path).toEqual(['spec', 'template', 'spec', 'initContainers']);
  });
```

In the **CronJob-specific** `describe` block (after line 310):

```ts
  it('initContainers uses CronJob path', () => {
    const def = getFormDefinition('CronJob')!;
    const initContainers = findField(def, 'initContainers')!;
    expect(initContainers.path).toEqual([
      'spec', 'jobTemplate', 'spec', 'template', 'spec', 'initContainers',
    ]);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/ui/modals/create-resource/formDefinitions.test.ts`
Expected: FAIL — `initContainers` field not found

- [ ] **Step 3: Add Init Containers section to deployment.ts**

In `frontend/src/ui/modals/create-resource/formDefinitions/deployment.ts`, insert a new section after the Containers section closing `},` (after line 111) and before the Volumes section:

```ts
    {
      title: 'Init Containers',
      fields: [
        {
          key: 'initContainers',
          label: 'Init Containers',
          path: ['spec', 'template', 'spec', 'initContainers'],
          type: 'group-list',
          fullWidth: true,
          itemTitleField: 'name',
          itemTitleFallback: 'Init Container',
          fields: makeContainerSubFields(volumesPath),
          defaultValue: containerDefaultValue,
        },
      ],
    },
```

- [ ] **Step 4: Add Init Containers section to job.ts**

In `frontend/src/ui/modals/create-resource/formDefinitions/job.ts`, insert after the Containers section closing `},` (after line 151) and before the Volumes section:

```ts
    {
      title: 'Init Containers',
      fields: [
        {
          key: 'initContainers',
          label: 'Init Containers',
          path: [...podSpecPrefix, 'initContainers'],
          type: 'group-list',
          fullWidth: true,
          itemTitleField: 'name',
          itemTitleFallback: 'Init Container',
          fields: makeContainerSubFields(volumesPath),
          defaultValue: containerDefaultValue,
        },
      ],
    },
```

- [ ] **Step 5: Add Init Containers section to cronJob.ts**

In `frontend/src/ui/modals/create-resource/formDefinitions/cronJob.ts`, insert after the Containers section closing `},` (after line 169) and before the Volumes section:

```ts
    {
      title: 'Init Containers',
      fields: [
        {
          key: 'initContainers',
          label: 'Init Containers',
          path: [...podSpecPrefix, 'initContainers'],
          type: 'group-list',
          fullWidth: true,
          itemTitleField: 'name',
          itemTitleFallback: 'Init Container',
          fields: makeContainerSubFields(volumesPath),
          defaultValue: containerDefaultValue,
        },
      ],
    },
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/ui/modals/create-resource/formDefinitions.test.ts`
Expected: PASS

- [ ] **Step 7: Run all existing tests to verify no regressions**

Run: `cd frontend && npx vitest run src/ui/modals/create-resource/`
Expected: All PASS

---

### Task 4: Create FormEnvFromField component

**Files:**
- Create: `frontend/src/ui/modals/create-resource/FormEnvFromField.tsx`
- Create: `frontend/src/ui/modals/create-resource/FormEnvFromField.test.tsx`

**Context:**
- Follow the same prop pattern as `FormVolumeSourceField` (see `FormVolumeSourceField.tsx:277-286`) and `FormProbeField`
- Use `Dropdown` from `@shared/components/dropdowns/Dropdown` for the source type dropdown
- Use CSS classes prefixed `resource-form-env-from-*` (we'll add CSS in this task too)
- The component manages a list of envFrom items internally — each row has a source type dropdown, name input, optional prefix input, and a remove button

**Reference:** Look at how `FormVolumeSourceField.tsx` renders its source type dropdown (lines 331-612) and how `FormProbeField.tsx` structures its JSX.

- [ ] **Step 1: Write the test file**

Create `frontend/src/ui/modals/create-resource/FormEnvFromField.test.tsx`:

```tsx
import { act } from 'react';
import ReactDOM from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FormEnvFromField } from './FormEnvFromField';

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
      nameInput.value = 'new-config';
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
      nameInput.value = 'new-secret';
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
      prefixInput.value = 'MY_PREFIX_';
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
      prefixInput.value = '';
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/ui/modals/create-resource/FormEnvFromField.test.tsx`
Expected: FAIL — module `./FormEnvFromField` not found

- [ ] **Step 3: Write the FormEnvFromField component**

Create `frontend/src/ui/modals/create-resource/FormEnvFromField.tsx`:

```tsx
/**
 * EnvFrom field editor.
 *
 * Renders a list of envFrom items, each with a source type dropdown
 * (ConfigMap/Secret), a name input, an optional prefix input, and
 * a remove button. Handles the YAML mapping between the flat UI model
 * and the nested configMapRef/secretRef structure.
 */

import React from 'react';
import { Dropdown } from '@shared/components/dropdowns/Dropdown';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * One item in the envFrom array.
 * Uses Record<string, unknown> for the public API to match the dispatch layer's
 * untyped item model. Internally we type-narrow via getSourceType/getName.
 */
type EnvFromItem = Record<string, unknown>;

interface FormEnvFromFieldProps {
  /** data-field-key for the wrapper element. */
  dataFieldKey: string;
  /** Current envFrom items from YAML. */
  items: EnvFromItem[];
  /** Callback when items change. */
  onChange: (newItems: EnvFromItem[]) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type SourceType = 'configMap' | 'secret';

const sourceTypeOptions = [
  { value: 'configMap', label: 'ConfigMap' },
  { value: 'secret', label: 'Secret' },
];

/** Detect the source type of an envFrom item. */
function getSourceType(item: EnvFromItem): SourceType {
  if (item.secretRef) return 'secret';
  return 'configMap';
}

/** Get the name value from an envFrom item. */
function getName(item: EnvFromItem): string {
  const ref = (item.secretRef ?? item.configMapRef) as { name?: string } | undefined;
  return ref?.name ?? '';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function FormEnvFromField({
  dataFieldKey,
  items,
  onChange,
}: FormEnvFromFieldProps): React.ReactElement {
  /** Update a single item in the list. */
  const updateItem = (index: number, updater: (item: EnvFromItem) => EnvFromItem) => {
    const newItems = items.map((it, i) => (i === index ? updater(it) : it));
    onChange(newItems);
  };

  /** Handle source type change — swap configMapRef ↔ secretRef, preserve name and prefix. */
  const handleSourceTypeChange = (index: number, newType: SourceType) => {
    updateItem(index, (item) => {
      const name = getName(item);
      const prefix = item.prefix;
      const next: EnvFromItem = {};
      if (newType === 'configMap') {
        next.configMapRef = { name };
      } else {
        next.secretRef = { name };
      }
      if (prefix) next.prefix = prefix;
      return next;
    });
  };

  /** Handle name input change. */
  const handleNameChange = (index: number, newName: string) => {
    updateItem(index, (item) => {
      const sourceType = getSourceType(item);
      const next = { ...item };
      if (sourceType === 'configMap') {
        next.configMapRef = { name: newName };
      } else {
        next.secretRef = { name: newName };
      }
      return next;
    });
  };

  /** Handle prefix input change. */
  const handlePrefixChange = (index: number, newPrefix: string) => {
    updateItem(index, (item) => {
      const next = { ...item };
      if (newPrefix) {
        next.prefix = newPrefix;
      } else {
        delete next.prefix;
      }
      return next;
    });
  };

  /** Add a new envFrom item defaulting to ConfigMap. */
  const handleAdd = () => {
    onChange([...items, { configMapRef: { name: '' } }]);
  };

  /** Remove an item by index. */
  const handleRemove = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <div data-field-key={dataFieldKey} className="resource-form-env-from">
      {items.map((item, index) => {
        const sourceType = getSourceType(item);
        const name = getName(item);
        const prefix = item.prefix ?? '';
        // 1-based label for accessibility (e.g., "Env source type 1").
        const rowLabel = index + 1;

        return (
          <div key={index} className="resource-form-env-from-row">
            {/* Source type dropdown */}
            <div className="resource-form-env-from-source">
              <Dropdown
                options={sourceTypeOptions}
                value={sourceType}
                onChange={(val) =>
                  handleSourceTypeChange(index, val as SourceType)
                }
                ariaLabel={`Env source type ${rowLabel}`}
              />
            </div>

            {/* Name input */}
            <div
              data-field-key={`envFromName-${index}`}
              className="resource-form-env-from-name"
            >
              <input
                className="resource-form-input"
                type="text"
                value={name}
                onChange={(e) => handleNameChange(index, e.target.value)}
                placeholder="name"
                aria-label={`Env source name ${rowLabel}`}
              />
            </div>

            {/* Prefix input */}
            <div
              data-field-key={`envFromPrefix-${index}`}
              className="resource-form-env-from-prefix"
            >
              <input
                className="resource-form-input"
                type="text"
                value={prefix}
                onChange={(e) => handlePrefixChange(index, e.target.value)}
                placeholder="prefix (optional)"
                aria-label={`Env source prefix ${rowLabel}`}
              />
            </div>

            {/* Remove button */}
            <button
              data-field-key={`envFromRemove-${index}`}
              type="button"
              className="resource-form-icon-btn"
              onClick={() => handleRemove(index)}
              aria-label={`Remove env source ${rowLabel}`}
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
        Add env source
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/ui/modals/create-resource/FormEnvFromField.test.tsx`
Expected: All PASS

- [ ] **Step 5: Add CSS for the new component**

In `frontend/src/ui/modals/create-resource/ResourceForm.css`, add at the end of the file (after the existing volume source styles):

```css
/* ── Env From field (envFrom source rows) ─────────────────────────────── */

.resource-form-env-from {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: var(--spacing-xs);
}

.resource-form-env-from-row {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
}

.resource-form-env-from-source {
  flex: 0 0 10rem;
  min-width: 10rem;
}

.resource-form-env-from-source .dropdown {
  display: inline-block;
  width: auto;
}

.resource-form-env-from-source .dropdown-menu {
  width: 100%;
  min-width: 0;
}

.resource-form-env-from-name {
  flex: 1;
  min-width: 0;
}

.resource-form-env-from-prefix {
  flex: 0 0 10rem;
  min-width: 10rem;
}
```

- [ ] **Step 6: Run all tests to verify no regressions**

Run: `cd frontend && npx vitest run src/ui/modals/create-resource/`
Expected: All PASS

---

### Task 5: Wire envFrom into the GroupListField dispatch

**Files:**
- Modify: `frontend/src/ui/modals/create-resource/ResourceForm.tsx:1062-1069`

**Context:**
- The `renderSubField` switch statement in `ResourceForm.tsx` (lines 779-1069) dispatches sub-field types to their renderers
- The `default` case is at line 1062
- Add the `'env-from'` case just before the `default` case
- The pattern follows `volume-source` (lines 921-932): receive the item, call updateItem, pass to component

- [ ] **Step 1: Add the env-from case to renderSubField**

In `frontend/src/ui/modals/create-resource/ResourceForm.tsx`, add an import at the top of the file with the other component imports:

```ts
import { FormEnvFromField } from './FormEnvFromField';
```

Then add a new case before the `default:` case (before line 1062):

```tsx
      case 'env-from': {
        // subValue = getNestedValue(item, subField.path), already computed above.
        const envFromItems = Array.isArray(subValue) ? (subValue as Record<string, unknown>[]) : [];
        return (
          <FormEnvFromField
            dataFieldKey={subField.key}
            items={envFromItems}
            onChange={(newItems) => {
              if (newItems.length > 0) {
                handleSubFieldChange(itemIndex, subField, newItems);
              } else {
                // Empty array → remove the key from YAML entirely.
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

Note: This follows the established pattern — `handleSubFieldChange` for setting values (like all other sub-field cases), and `unsetNestedValue` + `updateItems` for clearing (like `probe`'s `onRemoveProbe` handler at line 911-917). `subValue` is already computed via `getNestedValue(item, subField.path)` earlier in the function.

- [ ] **Step 2: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `cd frontend && npx vitest run src/ui/modals/create-resource/`
Expected: All PASS

---

### Task 6: Final verification

- [ ] **Step 1: Run TypeScript check**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (zero errors)

- [ ] **Step 2: Run all create-resource tests**

Run: `cd frontend && npx vitest run src/ui/modals/create-resource/`
Expected: All PASS

- [ ] **Step 3: Run linting**

Run: `cd frontend && npx eslint src/ui/modals/create-resource/`
Expected: PASS (zero errors)

- [ ] **Step 4: Verify the form definitions test count increased**

The formDefinitions.test.ts should now have additional tests for:
- envFrom field in shared coverage (3 kinds × 1 test = 3 new)
- initContainers section properties (3 kinds × 1 test = 3 new)
- initContainers sub-field matching (3 kinds × 1 test = 3 new)
- initContainers path assertions (3 resource-specific tests)

Total: 12 new formDefinitions tests + 11 new FormEnvFromField tests = 23 new tests
