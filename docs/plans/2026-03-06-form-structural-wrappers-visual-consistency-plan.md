# Form Structural Wrapper Visual Consistency Plan

**Date:** 2026-03-06  
**Status:** Proposed

## Goal

Extract `FormSectionCard` and `FormFieldRow` into reusable structural wrappers without changing Create Resource form behavior, spacing, alignment, or multi-cluster safety semantics.

## Dependency

- This plan starts only after `2026-03-06-form-component-reuse-plan.md` Phase 0 through Phase 4 are complete and passing all required checks.

## Scope

- Create Resource form wrapper extraction only.
- Frontend-only changes.
- Preserve current YAML behavior, cluster pinning behavior, and control semantics.

## Out of Scope

- Any backend code change.
- Any cross-form rollout to non-Create Resource forms.
- Any redesign, spacing refresh, or style-token changes beyond strict parity fixes.
- Any changes to validation rules, omit-if-empty behavior, or dropdown option semantics.

## Multi-Cluster Guardrails

- Wrappers remain presentation-only and cannot own cluster state or cluster action orchestration.
- `ValidateResourceCreation(clusterId, ...)` and `CreateResource(clusterId, ...)` call paths remain unchanged.
- Namespace options remain scoped to the selected cluster.

## Visual Parity Criteria

- No spacing/alignment movement for existing rows in labels, annotations, env vars, ports, resources, and volumes.
- Add/remove button position and size remain identical in empty and populated states.
- Inline label/input spacing remains identical to current Ports row conventions.
- Container header rows keep current title/action alignment.
- No class-name churn in snapshots except wrapper container names required for extraction.

## Phased Rollout

### Phase 1: `FormFieldRow` Extraction

- [ ] Introduce `FormFieldRow` wrapper with pass-through class hooks.
- [ ] Migrate one low-risk row family first (metadata key/value).
- [ ] Keep DOM structure and classes equivalent where tests depend on selectors.

### Phase 2: `FormSectionCard` Extraction

- [ ] Introduce `FormSectionCard` wrapper with title/action slots.
- [ ] Migrate container and volumes sections.
- [ ] Preserve existing remove/add action placement and header behavior.

### Phase 3: Remaining Row Migration

- [ ] Migrate ports, env vars, resources, and volume-source-specific rows.
- [ ] Remove duplicated row scaffolding after parity checks pass.

## Test Gates (Run Per Phase)

- `npm run typecheck`
- `npm run test -- --run`
- `npm run lint`
- `go test ./...` only if backend files were touched (otherwise record backend unchanged)

## Required Coverage

- Component tests for `FormFieldRow` and `FormSectionCard` render slots and class pass-through.
- Create Resource integration tests asserting unchanged add/remove alignment behavior and row visibility behavior.
- Existing multi-cluster safety integration tests continue passing.

## Rollback Strategy

- If any phase introduces visual drift or behavior regression, revert that phase’s wrapper migration and keep only primitive/composite reuse from the previous plan.
- Keep wrapper components behind local usage boundaries until parity checks pass, so rollback is isolated to migrated sections.

## Acceptance Criteria

- No visual regressions in Create Resource form when compared against pre-extraction behavior.
- No behavior regressions in YAML generation/parsing flow.
- Multi-cluster safety assertions remain passing.
- All phase test gates pass at completion.
