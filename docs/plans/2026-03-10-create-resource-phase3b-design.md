# Phase 3B: Create Resource Form — valueFrom for Env Vars

**Date:** 2026-03-10
**Scope:** Replace the plain name/value env var field with a dedicated component supporting valueFrom references (configMapKeyRef, secretKeyRef).
**Phase context:** This is Phase 3B of 4 sub-phases. Phase 3A (initContainers + envFrom) is complete. Phase 3C covers securityContext, 3D affinity/tolerations.

---

## Overview

Currently, the `env` field in container sub-fields is a nested group-list with two text sub-fields (`name` and `value`). This only supports plain value env vars. Kubernetes also supports `valueFrom` references — loading a value from a specific ConfigMap key or Secret key.

This phase replaces the nested group-list with a dedicated `FormEnvVarField` component that handles all three source types.

**Scope:** configMapKeyRef and secretKeyRef only. fieldRef and resourceFieldRef are excluded (rare, different field shape, can be added later). The `optional` boolean on refs is also excluded (YAGNI).

---

## FormEnvVarField Component

### UI Layout

Each row: `[Name input] [Source dropdown: Value/ConfigMap/Secret] [dynamic fields]`

- **Value** (default): single text input for the value
- **ConfigMap**: two text inputs — ConfigMap name + key
- **Secret**: two text inputs — Secret name + key

### YAML Mapping

```yaml
env:
  - name: PLAIN_VAR
    value: "hello"
  - name: CM_VAR
    valueFrom:
      configMapKeyRef:
        name: my-config
        key: db-host
  - name: SECRET_VAR
    valueFrom:
      secretKeyRef:
        name: my-secret
        key: password
```

### Source Type Detection

From existing YAML items:
- Has `valueFrom.configMapKeyRef` → ConfigMap
- Has `valueFrom.secretKeyRef` → Secret
- Otherwise → Value (plain)

### Source Type Switching

Preserves the `name` field, clears old value/valueFrom, initializes new structure:
- To Value: `{ name, value: '' }`
- To ConfigMap: `{ name, valueFrom: { configMapKeyRef: { name: '', key: '' } } }`
- To Secret: `{ name, valueFrom: { secretKeyRef: { name: '', key: '' } } }`

### Props

```ts
type EnvVarItem = Record<string, unknown>;

interface FormEnvVarFieldProps {
  dataFieldKey: string;
  items: EnvVarItem[];
  onChange: (newItems: EnvVarItem[]) => void;
}
```

Uses `Record<string, unknown>` for dispatch layer compatibility, same as `FormEnvFromField`.

### Default New Item

`{ name: '', value: '' }` — plain value, same behavior as current.

### Component Size

~150-200 lines. Follows the same patterns as `FormEnvFromField`: internal list management, source type detection helpers, Dropdown for source switching.

---

## Integration

### Type System

Add `'env-var'` to the field type union in `types.ts`.

### Form Definition Change

In `shared.ts`, the env field changes from a nested group-list to the new type:

```ts
// Before (actual shared.ts):
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
      key: 'name', label: 'Name', path: ['name'], type: 'text',
      placeholder: 'name', fieldFlex: '0 0 auto', inputWidth: 'calc(25ch + 20px)',
    },
    {
      key: 'value', label: 'Value', path: ['value'], type: 'text',
      placeholder: 'value', fieldFlex: '0 0 auto', inputWidth: 'calc(25ch + 20px)',
    },
  ],
  defaultValue: { name: '', value: '' },
}

// After:
{
  key: 'env',
  label: 'Env Vars',
  path: ['env'],
  type: 'env-var',
}
```

The `fields`, `defaultValue`, `addGhostText`, etc. are no longer needed — `FormEnvVarField` manages its own list rendering internally.

### Dispatch

Add `'env-var'` case inside the inner `renderSubField` closure in `GroupListField`, immediately after the existing `'env-from'` case in `ResourceForm.tsx`:

```tsx
case 'env-var': {
  const envItems = Array.isArray(subValue) ? (subValue as Record<string, unknown>[]) : [];
  return (
    <FormEnvVarField
      dataFieldKey={subField.key}
      items={envItems}
      onChange={(newItems) => {
        if (newItems.length > 0) {
          handleSubFieldChange(itemIndex, subField, newItems);
        } else {
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

### Dispatch Scope

Like `'env-from'`, `'env-var'` is only dispatched as a sub-field inside `GroupListField` — no top-level `renderField` case needed.

### Backwards Compatibility

Existing YAML with plain `name`/`value` env vars renders identically — the source dropdown defaults to "Value" and the value input shows the existing value. No migration needed.

---

## Files Changed

- **Create:** `FormEnvVarField.tsx` (~150-200 lines)
- **Create:** `FormEnvVarField.test.tsx`
- **Modify:** `formDefinitions/types.ts` — add `'env-var'` to field type union
- **Modify:** `formDefinitions/shared.ts` — change env field from `'group-list'` to `'env-var'`, remove sub-fields
- **Modify:** `ResourceForm.tsx` — add `import { FormEnvVarField }` and `'env-var'` case inside `renderSubField` in `GroupListField`
- **Modify:** `ResourceForm.css` — add env-var CSS classes (see below)

All paths relative to `frontend/src/ui/modals/create-resource/`.

### CSS Classes

Following the same pattern as `resource-form-env-from-*`:

```css
.resource-form-env-var          /* flex column container, gap: var(--spacing-xs) */
.resource-form-env-var-row      /* flex row, align-items: center, gap: var(--spacing-xs) */
.resource-form-env-var-name     /* flex: 0 0 auto, input for env var name */
.resource-form-env-var-source   /* flex: 0 0 10rem, min-width: 10rem, dropdown for source type */
.resource-form-env-var-source .dropdown        /* display: inline-block, width: auto */
.resource-form-env-var-source .dropdown-menu   /* width: 100%, min-width: 0 */
.resource-form-env-var-value    /* flex: 1, min-width: 0, input for plain value */
.resource-form-env-var-ref-name /* flex: 1, min-width: 0, input for ConfigMap/Secret name */
.resource-form-env-var-ref-key  /* flex: 1, min-width: 0, input for ConfigMap/Secret key */
```

---

## Testing

### `FormEnvVarField.test.tsx`

Unit tests for the new component:
- Renders empty state with add button
- Renders plain value env var (name + value inputs)
- Detects configMapKeyRef source, renders ConfigMap name + key inputs
- Detects secretKeyRef source, renders Secret name + key inputs
- Source dropdown defaults to "Value" for plain env vars
- Switching Value → ConfigMap preserves name, clears value, initializes configMapKeyRef
- Switching ConfigMap → Secret preserves name, swaps ref structure
- Switching Secret → Value preserves name, clears valueFrom, initializes value
- Name input updates name field regardless of source type
- Value input updates value for plain vars
- ConfigMap name/key inputs update correct nested paths
- Secret name/key inputs update correct nested paths
- Add button creates new plain value item `{ name: '', value: '' }`
- Remove button removes item
- Renders multiple mixed items (plain + configMap + secret)

### Test Infrastructure

Tests must use the `setNativeInputValue` helper (copy from `FormEnvFromField.test.tsx`) to trigger React 19 controlled input change events. Mock `Dropdown` as `<select>` per established pattern.

### `formDefinitions.test.ts`

- env field has type `'env-var'` in containers sub-fields across all resource types (Deployment, Job, CronJob)
- env field has type `'env-var'` in initContainers sub-fields across all resource types (Deployment, Job, CronJob)

Note: the existing `'has containers with env, ports, and volumeMounts'` test only checks `.toBeDefined()` and requires no change.

### Existing Tests

All existing `ResourceForm.test.tsx`, `FormProbeField.test.tsx`, `FormVolumeSourceField.test.tsx`, `FormEnvFromField.test.tsx` tests must continue passing.
