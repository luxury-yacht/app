# Form Component Reuse Cross-Form Rollout Plan

**Date:** 2026-03-06  
**Status:** Proposed

## Goal

Roll out the extracted reusable form components from Create Resource to other guided resource forms, while preserving behavior, visual consistency, and multi-cluster safety.

## Dependency

- Requires completion of:
  - `docs/plans/2026-03-06-form-component-reuse-plan.md`
  - `docs/plans/2026-03-06-form-structural-wrappers-visual-consistency-plan.md`

## Scope

- Frontend-only rollout to other guided resource forms.
- Reuse existing components instead of duplicating row/action/field logic.
- Keep current UX behavior unless explicitly approved per form.

## Out of Scope

- Any backend changes.
- Any redesign or style-system overhaul.
- Any Kubernetes semantics or validation rule changes beyond strict parity migration.

## Multi-Cluster Guardrails

- Reused components must stay presentation-focused.
- Cluster selection, cluster IDs, and cluster-scoped actions remain in modal/controller layers.
- Existing pinned-cluster guarantees for validate/create/open flows must remain unchanged.
- Namespace and related lookups must remain scoped to the selected cluster.

## Target Components for Rollout

- `FormIconActionButton`
- `FormEmptyActionRow`
- `FormGhostAddText`
- `FormCompactNumberInput`
- `FormTriStateBooleanDropdown`
- `FormKeyValueListField`
- `FormNestedListField`
- `FormContainerResourcesField`
- `FormFieldRow`
- `FormSectionCard`

## Phased Rollout

### Phase 0: Inventory and Risk Gate

- [ ] Identify all non-Create-Resource forms that duplicate extracted patterns.
- [ ] Map each form to candidate reusable components and known edge cases.
- [ ] Confirm no form requires backend contract changes.

### Phase 1: Low-Risk Form Migration

- [ ] Migrate one low-risk form with mostly structural duplication.
- [ ] Preserve all current selectors/labels used by tests.
- [ ] Add or update tests for unchanged behavior and YAML/output parity.

### Phase 2: Medium-Complexity Form Migration

- [ ] Migrate forms using key/value lists, nested lists, and compact number fields.
- [ ] Validate omit-if-empty and tri-state boolean semantics remain unchanged.
- [ ] Verify action-button placement and empty-state behavior parity.

### Phase 3: High-Complexity Form Migration

- [ ] Migrate forms with source-dependent field visibility or resources-style blocks.
- [ ] Ensure conditional rendering logic remains unchanged.
- [ ] Validate unchanged serialization behavior for optional and nested fields.

### Phase 4: Consolidation and Cleanup

- [ ] Remove duplicate helper/render logic superseded by reusable components.
- [ ] Keep API contracts of shared components stable and documented.
- [ ] Confirm no behavior or visual regressions across migrated forms.

## Test Gates (Required Before Each Phase Completion)

- `npm run typecheck`
- `npm run test -- --run`
- `npm run lint`
- `go test ./...` if backend files are touched; otherwise explicitly record backend unchanged.

## Required Coverage

- Component tests for each migrated reusable component usage path.
- Integration tests per migrated form for add/remove/empty-state and serialization behavior.
- Existing multi-cluster safety integration tests remain passing.

## Acceptance Criteria

- Rollout completed for all targeted non-Create-Resource guided forms in scope.
- No visual regressions in migrated forms.
- No behavior regressions in serialization/validation flow.
- Multi-cluster safety checks continue passing.
- All test gates pass at each phase completion.
