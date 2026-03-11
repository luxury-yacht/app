# Phase 3A: Create Resource Form — initContainers & envFrom

**Date:** 2026-03-10
**Scope:** Add initContainers sections to all resource types and envFrom support inside container cards.
**Phase context:** This is Phase 3A of 4 sub-phases. Phase 2 (simple features + shared extraction) is complete. Phase 3B covers valueFrom, 3C securityContext, 3D affinity/tolerations.

---

## initContainers

### Approach

New "Init Containers" form section on each resource type, placed immediately after the "Containers" section. Reuses the existing `makeContainerSubFields(volumesPath)` factory and `containerDefaultValue` from `shared.ts`. Zero new components needed — purely declarative form definitions.

### Form Definitions

Each resource definition gets a new section:

```ts
// Deployment and Job:
{
  title: 'Init Containers',
  fields: [{
    key: 'initContainers',
    label: 'Init Containers',
    path: ['spec', 'template', 'spec', 'initContainers'],
    type: 'group-list',
    fullWidth: true,
    itemTitleField: 'name',
    itemTitleFallback: 'Init Container',
    defaultValue: containerDefaultValue,
    fields: makeContainerSubFields(volumesPath),
  }],
}

// CronJob (deeper nesting):
{
  title: 'Init Containers',
  fields: [{
    key: 'initContainers',
    label: 'Init Containers',
    path: ['spec', 'jobTemplate', 'spec', 'template', 'spec', 'initContainers'],
    type: 'group-list',
    fullWidth: true,
    itemTitleField: 'name',
    itemTitleFallback: 'Init Container',
    defaultValue: containerDefaultValue,
    fields: makeContainerSubFields(volumesPath),
  }],
}
```

### Files Changed

- `deployment.ts` — add Init Containers section after Containers
- `job.ts` — add Init Containers section after Containers
- `cronJob.ts` — add Init Containers section after Containers
- `shared.ts` — no changes needed

---

## envFrom

### Approach

New `env-from` field type with a dedicated `FormEnvFromField` component. Renders inline rows within the container card, adjacent to the existing `env` field. Each row has a source type dropdown, name input, optional prefix input, and remove button.

### YAML Structure

```yaml
containers:
  - name: app
    envFrom:
      - configMapRef:
          name: my-config
        prefix: APP_
      - secretRef:
          name: my-secret
```

The source type dropdown controls whether the name maps to `configMapRef.name` or `secretRef.name`. The `prefix` field is shared between both source types.

### `EnvFromItem` Type

Defined in `FormEnvFromField.tsx` (co-located with the component that uses it):

```ts
type EnvFromItem =
  | { configMapRef: { name: string }; prefix?: string }
  | { secretRef: { name: string }; prefix?: string };
```

### Component: `FormEnvFromField.tsx`

~100-150 lines. Props:

```ts
interface FormEnvFromFieldProps {
  dataFieldKey: string;
  items: EnvFromItem[];
  onChange: (newItems: EnvFromItem[]) => void;
}
```

Behavior:
- **Detects source type** from existing YAML keys (`configMapRef` → ConfigMap, `secretRef` → Secret)
- **Renders each item** as a row: [Source type dropdown] [Name input] [Prefix input] [Remove button]
- **Source type switching** preserves name/prefix values, swaps `configMapRef` ↔ `secretRef`
- **Add button** creates `{ configMapRef: { name: '' } }`
- **Empty list** — when all items removed, onChange returns `[]` and dispatch code deletes the key from YAML

### Dispatch Integration

Add `'env-from'` case to `GroupListField.renderSubField` in `ResourceForm.tsx`. Note: the dispatch reads the value via `item[subField.key]` (like `probe` and `volume-source` do for their respective keys) rather than using `getNestedValue` — the `path` in the field definition is used by the YAML sync layer, not by the sub-field renderer:

```tsx
case 'env-from':
  return (
    <FormEnvFromField
      dataFieldKey={subField.key}
      items={(item[subField.key] as EnvFromItem[]) ?? []}
      onChange={(newItems) => {
        updateItem((prev) => {
          const next = { ...prev };
          if (newItems.length > 0) {
            next[subField.key] = newItems;
          } else {
            delete next[subField.key];
          }
          return next;
        });
      }}
    />
  );
```

### Form Definition

Added to `makeContainerSubFields` in `shared.ts`, after the existing `env` field:

```ts
{
  key: 'envFrom',
  label: 'Env From',
  path: ['envFrom'],
  type: 'env-from',
}
```

This automatically appears in all container cards (Deployment, Job, CronJob) and all init container cards.

### Files Changed

- **Create:** `FormEnvFromField.tsx`
- **Create:** `FormEnvFromField.test.tsx`
- **Modify:** `types.ts` — add `'env-from'` to field type union
- **Modify:** `ResourceForm.tsx` — add `'env-from'` case in `GroupListField.renderSubField`
- **Modify:** `shared.ts` — add envFrom field to `makeContainerSubFields`

---

## Testing

### `FormEnvFromField.test.tsx`

Unit tests for the new component:
- Detects configMap source, renders name input with correct value
- Detects secret source, renders name input with correct value
- Source type switching preserves name/prefix, swaps YAML keys (configMapRef ↔ secretRef)
- Name input updates correct nested key
- Prefix input sets/clears prefix field
- Add button creates new configMap item
- Remove button removes item; removing all items returns empty array
- Renders multiple items correctly

### `formDefinitions.test.ts`

Extend existing test file:
- All resource types (Deployment, Job, CronJob) have an initContainers section
- initContainers uses correct path per resource type (Deployment/Job: `spec.template.spec.initContainers`, CronJob: `spec.jobTemplate.spec.template.spec.initContainers`)
- initContainers has key sub-fields: `readinessProbe`, `livenessProbe`, `startupProbe`, `env`, `ports`, `volumeMounts`, `envFrom`
- initContainers has `fullWidth: true`, `itemTitleField: 'name'`, `itemTitleFallback: 'Init Container'`
- envFrom field exists in both containers and initContainers sub-fields
- envFrom field has type `env-from`

### Existing tests

All existing `ResourceForm.test.tsx`, `FormProbeField.test.tsx`, `FormVolumeSourceField.test.tsx` tests must continue passing.
