# Phase 1: Create Resource Form — Bugs + Tests

**Date:** 2026-03-10
**Scope:** Fix 5 bugs (1 reclassified) and add unit tests for 4 untested components.
**Phase context:** This is Phase 1 of 3. Phase 2 covers simple missing features, Phase 3 covers complex features (envFrom/valueFrom, securityContext, affinity/tolerations, initContainers).

---

## Bug Fixes

### Bug 1: `name` field not marked `required: true`

Add `required: true` to the `metadata.name` field in all 7 form definitions: deployment, job, cronJob, service, configMap, ingress, secret.

Disable the Create button when `requiredFieldErrors.length > 0 && showingForm` in `CreateResourceModal.tsx`. Currently the errors display in the footer but the button remains clickable.

**Files:** `frontend/src/ui/modals/create-resource/formDefinitions/{deployment,job,cronJob,service,configMap,ingress,secret}.ts`, `frontend/src/ui/modals/CreateResourceModal.tsx`

### Bug 2: `env` only supports literal values — reclassified

Reclassified as a Phase 3 feature. The current form correctly handles literal env vars. Adding `valueFrom` (secretKeyRef, configMapKeyRef, fieldRef) requires a new compound sub-field type in `NestedGroupListField` with conditional rendering, which is Phase 3 scope.

No code changes in Phase 1.

### Bug 3: `restartPolicy` allows invalid values for Deployments

Remove `OnFailure` and `Never` from the deployment `restartPolicy` options, keeping only `Always`. Job and CronJob definitions already correctly offer only `Never`/`OnFailure`.

**Files:** `frontend/src/ui/modals/create-resource/formDefinitions/deployment.ts`

### Bug 4: `serviceAccountName` mirrors to deprecated `serviceAccount`

Remove the `mirrorPaths` entry from the `serviceAccountName` field in deployment.ts. The `serviceAccount` field was deprecated in Kubernetes 1.0 and removed in 1.24. Nothing reads it from the form.

**Files:** `frontend/src/ui/modals/create-resource/formDefinitions/deployment.ts`

### Bug 5: Port protocol missing SCTP

Add `{ label: 'SCTP', value: 'SCTP' }` to the protocol options in both `deployment.ts` (container ports) and `service.ts` (service ports).

**Files:** `frontend/src/ui/modals/create-resource/formDefinitions/deployment.ts`, `frontend/src/ui/modals/create-resource/formDefinitions/service.ts`

---

## Test Coverage

All tests follow existing project conventions: `vitest`, `ReactDOM.createRoot` + `act`, `Dropdown` mocked as native `<select>`, `setNativeInputValue` helper for input changes.

### FormProbeField.test.tsx (new file)

1. Empty state renders add button, no editor fields
2. Clicking add calls `onProbeChange` with default HTTP GET probe (`{ httpGet: { path: '/' } }`)
3. Type detection picks correct type from probe object keys
4. Type switching preserves timing fields, removes old type key, initializes new type
5. HTTP GET fields (path, port, scheme) — scheme dropdown omits HTTP from YAML, writes HTTPS
6. TCP Socket port parsing — numeric strings become numbers, named ports stay strings
7. Exec command — commits on blur/Enter via `shellTokenize`
8. gRPC fields (port, service)
9. Timing/threshold fields — parsed as non-negative integers, empty clears field
10. Remove probe calls `onRemoveProbe`

### FormVolumeSourceField.test.tsx (new file)

ResourceForm.test.tsx already covers integration paths (PVC, Secret, EmptyDir, HostPath switching and field rendering). Unit tests fill the gaps:

1. `getCurrentVolumeSource` detection logic for each source type
2. `clearOtherVolumeSources` — switching types removes old source keys
3. ConfigMap items add/remove/field-change via `makeSourceItemsHandlers`
4. Selecting the same source type is a no-op
5. `aria-required` on secret source name input

### NestedGroupListField.test.tsx (new file)

1. Renders sub-field labels and inputs for each item
2. Add row appends item with `defaultValue`
3. Remove row filters item at index
4. Field change — non-empty sets value, empty omits value
5. Select sub-field with `dynamicOptionsPath` resolves options from YAML
6. `disableAdd` when dynamic options exhausted, shows `disabledGhostText`
7. Boolean-toggle sub-field — check sets true, uncheck unsets
8. Text sub-field with `alternatePath` — toggle switches between paths
9. Unhandled field type returns null without crash

### FormCommandInputField.test.tsx (new file)

1. No value + `onAdd` renders add button, clicking calls `onAdd`
2. Command mode renders `<input>`, commits on blur/Enter
3. Script mode renders `<textarea>`
4. Raw-yaml mode renders `<textarea>`, invalid YAML shows error
5. Mode switching reformats text and calls `onChange`
6. External value change resets displayed text
7. Remove button calls `onRemove`
