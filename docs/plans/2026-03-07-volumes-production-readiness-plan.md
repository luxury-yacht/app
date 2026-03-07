# Volumes Production Readiness Plan

**Date:** 2026-03-07  
**Status:** Completed

## Goal

Ship the Deployment Volumes experience in Create Resource as production-ready for day-to-day use, with explicit validation gates and regression coverage.

## Validated Current State

- Volume source types currently supported in the form renderer: `ConfigMap`, `EmptyDir`, `Host Path`, `PVC`, `Secret`.
  - Verified in `frontend/src/ui/modals/create-resource/ResourceForm.tsx` (`VOLUME_SOURCE_DEFINITIONS`).
- Volume source-specific source roots are mutually exclusive and are cleared when switching source.
  - Verified in `clearOtherVolumeSources` + `handleSourceTypeChange`.
- `ConfigMap`/`Secret` source rows now share the same layout pattern.
- Deployment containers now include `env`, `ports`, `resources`, and `volumeMounts`.
  - Verified in `frontend/src/ui/modals/create-resource/formDefinitions.ts` (Deployment `containers` sub-fields).

## Scope

- Create Resource Deployment form only.
- Frontend-first implementation and tests.
- No redesign beyond current established Create Resource form patterns.

## Out Of Scope

- Adding every Kubernetes volume source in one pass.
- Backend API/template contract changes for this plan.
- Non-Deployment forms.

## Multi-Cluster Guardrails

- Changes in this plan are form-rendering and YAML-serialization only.
- No cluster routing/action orchestration logic is changed.
- Existing pinned-cluster safeguards in Create Resource modal must remain unchanged and passing.

## Production Checklist

### Phase 0: Baseline Gates

- ✅ Capture validated current-state assertions in this plan (no assumption-only items).
- ✅ Keep full gate run green before/after each phase:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test -- --run`
  - `go test ./...` (required repo-wide gate)

### Phase 1: Core Workflow Completeness

- ✅ Add container `volumeMounts` editing support in Deployment form.
- ✅ Use existing reusable form components/patterns (nested list rows, add/remove actions, ghost text).
- ✅ Ensure existing `volumeMounts` from YAML are reflected in form rows.

### Phase 2: Validation Hardening (Current Source Set)

- ✅ Add/confirm source-specific required field behavior remains enforced for:
  - `hostPath.path`
  - `persistentVolumeClaim.claimName`
  - `secret.secretName`
- ✅ Add guard tests for omit-if-unset semantics and empty-state behavior across all supported source types.
- ✅ Add regression tests for source-switch correctness (old source root removed, new source root retained).

### Phase 3: Test Completeness

- ✅ Add explicit tests for Deployment container `volumeMounts` add/remove/edit flow.
- ✅ Add tests for empty-state add-button positioning and ghost text for `volumeMounts`.
- ✅ Keep existing volume source integration tests passing without selector churn.

### Phase 4: Release Readiness

- ✅ Verify no regressions against existing Create Resource behaviors.
- ✅ Confirm no backend changes were required for this plan.
- ✅ Record final gate results in completion update.

## Latest Gate Run (2026-03-07)

- ✅ `npm run typecheck`
- ✅ `npm run lint`
- ✅ `npm run test -- --run`
- ✅ `go test ./...`

## Completion Notes

- Frontend-only changes for this plan.
- Backend implementation is unchanged.

## Acceptance Criteria

- Deployment form supports practical Volumes workflow end-to-end:
  - volume definitions and container mounts can both be edited.
- Existing supported source types (`ConfigMap`, `Secret`, `EmptyDir`, `HostPath`, `PVC`) retain current behavior and tests.
- No multi-cluster behavior regressions.
- All required gates pass.
