# Form Component Reuse Plan

**Date:** 2026-03-06  
**Status:** Proposed

## Goal

Extract the established Create Resource form UI patterns into reusable components that can be used in:

- `CreateResourceModal` form sections
- future guided resource forms with the same interaction model

## Scope

- Refactor only for reuse and consistency
- No behavior or visual regressions
- No backend changes
- **Create Resource form only** in this plan
- Cross-form rollout is explicitly out of scope for this plan and will be tracked separately

## Reuse Candidates (Priority Order)

1. `FormIconActionButton`

- Standardized add/remove icon button variant, sizing, hover styles, hidden placeholder behavior, and a11y labels.

2. `FormEmptyActionRow`

- Shared empty-state row wrapper for add/remove button placement and left/right alignment.

3. `FormGhostAddText`

- Ghost label text shown only in empty states (for example: `Add label`, `Add annotation`, `Add item`, `Add port`).

4. `FormInlineFieldPair`

- Inline label + input pair pattern used by rows like key/value, cpu/memory, and port/protocol.

5. `FormKeyValueListField`

- Reusable key/value editor with optional inline key/value labels and empty-state action behavior.

6. `FormNestedListField`

- Reusable list-of-objects row editor (ports, env vars, similar arrays).

7. `FormTriStateBooleanDropdown`

- Shared `----- / true / false` control with explicit unset handling (omit field in YAML when unset).

8. `FormCompactNumberInput`

- Width-constrained numeric input with shared validation and min/max behavior.

9. `FormContainerResourcesField`

- Requests/limits block with aligned rows and empty-state add behavior.

10. `FormSectionCard` and `FormFieldRow`

- Base structure wrappers for section layout and row-level label/value alignment consistency.

## Multi-Cluster Guardrails

- Extracted form components must remain presentation-focused and must not own cluster selection state, cluster IDs, or resource-action orchestration.
- Cluster safety boundaries stay in Create Resource modal/controller logic.
- Refactor must preserve pinned-cluster behavior for:
  - `ValidateResourceCreation(clusterId, ...)`
  - `CreateResource(clusterId, ...)`
  - object panel open action with explicit `{ clusterId, clusterName }`
- Namespace filtering must remain constrained to the selected target cluster.
- Add regression coverage for cluster switch during in-flight create/validate to confirm pinned cluster behavior is preserved.

## Proposed Component Layers

### Primitives

- `FormIconActionButton`
- `FormGhostAddText`
- `FormEmptyActionRow`
- `FormCompactNumberInput`
- `FormInlineFieldPair`

### Composite Fields

- `FormKeyValueListField`
- `FormNestedListField`
- `FormContainerResourcesField`
- `FormTriStateBooleanDropdown`

## Phased Plan

### Phase 1: Action Primitives

- [ ] Extract `FormIconActionButton`
- [ ] Extract `FormGhostAddText`
- [ ] Extract `FormEmptyActionRow`
- [ ] Replace current inline add/remove implementations in create-resource form

### Phase 2: Core Repeating Fields

- [ ] Extract `FormKeyValueListField`
- [ ] Extract `FormNestedListField`
- [ ] Migrate labels/annotations, ports/env vars, and ConfigMap items

### Phase 3: Specialized Inputs

- [ ] Extract `FormCompactNumberInput`
- [ ] Extract `FormTriStateBooleanDropdown`
- [ ] Replace existing replicas/port/mode/optional usages where applicable

### Phase 4: Resources + Structural Wrappers

- [ ] Extract `FormContainerResourcesField`
- [ ] Extract `FormSectionCard` and `FormFieldRow`
- [ ] Apply wrappers inside Create Resource only, with strict visual parity checks

## Acceptance Criteria

- No UX or behavior regressions in Create Resource form
- Existing tests continue passing
- `npm run typecheck` passes
- `npm run test -- --run` passes
- `npm run lint` passes (or pre-existing non-plan-related failures are explicitly documented before merge)
- Backend verification scope is explicitly tracked:
  - If implementation touches frontend-only files, record backend as unchanged and keep backend checks status as unchanged.
  - If any backend files are touched, run backend verification (at minimum `go test ./...`) before completion.
- Duplicate styling and duplicated action-row markup are materially reduced
- Cluster safety assertions remain valid and explicitly tested

## Required Test Coverage

- Unit/component tests for extracted primitives:
  - icon action button states (visible/hidden/disabled)
  - empty-state row alignment (left/right)
  - ghost text visibility rules
- Component tests for extracted composites:
  - key/value add/remove behavior
  - nested list add/remove behavior
  - resources add/remove behavior
  - tri-state boolean unset behavior (`-----` omits field from YAML)
  - compact number input validation and width classes/props
- Integration tests in `CreateResourceModal` / form flow:
  - cluster ID passed to validate/create remains pinned
  - object panel open retains explicit cluster context
  - namespace list remains cluster-scoped
  - in-flight cluster switch does not redirect action to a new cluster

## Notes

- Keep YAML as source of truth and preserve current omit-if-empty behavior.
- Preserve current multi-cluster-safe flow and existing form semantics.
