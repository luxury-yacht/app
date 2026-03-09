# Form Fundamentals Fixes

**Goal:** Fix structural issues in the resource creation form system before scaling to more resource types.

**Architecture:** All changes are incremental fixes to the existing definition-driven form renderer. No new components needed; most work is adding properties to `FormFieldDefinition` and wiring them through existing renderers.

**Tech Stack:** React, TypeScript, vitest

---

### Task 1: Add `fullWidth` property to FormFieldDefinition ✅

Replace the hardcoded `field.key === 'containers' || field.key === 'volumes'` check with a definition-driven property.

**Files:**
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/types.ts` — add `fullWidth?: boolean`
- Modify: `frontend/src/ui/modals/create-resource/ResourceForm.tsx:942` — use `field.fullWidth` instead of key check
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/deployment.ts` — set `fullWidth: true` on containers and volumes
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/ingress.ts` — set `fullWidth: true` on rules
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/job.ts` — set `fullWidth: true` on containers
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/cronJob.ts` — set `fullWidth: true` on containers

### Task 2: Add `string-list` field type ✅

The `command` field in Job/CronJob needs to produce a YAML sequence, not a scalar string.

**Files:**
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/types.ts` — add `'string-list'` to the type union
- Modify: `frontend/src/ui/modals/create-resource/ResourceForm.tsx` — add `StringListField` component at top level and in `GroupListField.renderSubField`; add case to `FieldRenderer`
- Modify: `frontend/src/ui/modals/create-resource/NestedGroupListField.tsx` — add `string-list` case in `renderNestedLeafField`
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/job.ts` — change `command` to `type: 'string-list'`
- Modify: `frontend/src/ui/modals/create-resource/formDefinitions/cronJob.ts` — change `command` to `type: 'string-list'`

### Task 3: Add dev warning for unhandled field types ✅

**Files:**
- Modify: `frontend/src/ui/modals/create-resource/ResourceForm.tsx` — add `console.warn` in FieldRenderer, GroupListField.renderSubField, and NestedGroupListField default cases

### Task 4: Wire up `required` field validation ✅

Add a validation helper that checks required fields. Surface validation errors in the modal footer.

**Files:**
- Modify: `frontend/src/ui/modals/create-resource/formUtils.ts` — add `getRequiredFieldErrors()` helper
- Modify: `frontend/src/ui/modals/CreateResourceModal.tsx` — compute and display required field errors
- Modify: `frontend/src/ui/modals/CreateResourceModal.css` — add `.create-resource-required-errors` style

### Task 5: Respect `omitIfEmpty` at top-level fields ✅

**Files:**
- Modify: `frontend/src/ui/modals/create-resource/ResourceForm.tsx` — in `TextField` and `TextareaField` change handlers, check `omitIfEmpty` and call `unsetFieldValue`
- Modify: `frontend/src/ui/modals/create-resource/yamlSync.ts` — add `unsetFieldValue()` helper

### Task 6: Add tests for formUtils ✅

**Files:**
- Create: `frontend/src/ui/modals/create-resource/formUtils.test.ts` — 26 tests covering all utility functions including `getRequiredFieldErrors`

### Task 7: Refactor volume source to data-driven lookup ✅

Refactor `getCurrentVolumeSource` to iterate `VOLUME_SOURCE_ROOT_BY_KEY` instead of hardcoding each source check.

**Files:**
- Modify: `frontend/src/ui/modals/create-resource/FormVolumeSourceField.tsx`
