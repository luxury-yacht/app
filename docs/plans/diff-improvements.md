# Diff Improvements

This document captures a practical plan for improving large YAML diffs across the app. The
immediate trigger is the object diff modal, but the same frontend diff utility also powers the
YAML editor tab and rollback modal, and the backend has a separate diff path for YAML mutation
preview.

## Summary

The current line diff implementation uses a full dynamic-programming LCS matrix. That is simple and
correct, but it is `O(n*m)` in both time and memory. The object diff modal also pays a separate
rendering cost because `DiffViewer` mounts every row and measures truncation against rendered DOM.

This plan is intentionally phased. The first phase only switches the object diff modal so the new
path can be tested in isolation. Later phases virtualize the viewer and then migrate the other diff
surfaces.

The core decisions are:

- object diff phase 1 is frontend-only and does not add a new dependency
- phase 1 uses a local Myers-style line diff in TypeScript
- the backend remains responsible for retrieving and normalizing YAML, not calculating object diffs
- the initial target is `10k` lines per side for the object diff modal
- phase 1 enforces separate shared budgets for:
  - maximum lines per side
  - deterministic compute work
  - maximum renderable rows
- phase 1 shows a general “too large” warning when the active mode exceeds budget
- phase 1 preserves the current `Full View` and `Diffs Only` modes
- phase 2 virtualizes `DiffViewer`
- YAML tab diff, rollback diff, and backend mutation diff remain in scope for later phases

## Current State

### Frontend diff computation

`computeLineDiff` in `frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlDiff.ts`
builds a full `(leftLines + 1) x (rightLines + 1)` matrix. This affects:

- `frontend/src/ui/modals/ObjectDiffModal.tsx`
- `frontend/src/modules/object-panel/components/ObjectPanel/Yaml/YamlTab.tsx`
- `frontend/src/shared/components/modals/RollbackModal.tsx`

The current frontend cap protects computation, not rendering quality.

### Backend diff computation

`computeDiffLines` in `backend/object_yaml_mutation.go` uses the same full-matrix approach, but with
a different limit and different truncation rule. That means the app currently has inconsistent diff
behavior depending on the feature entry point. This backend path is not part of phase 1, but it is
part of the later cleanup scope.

### Frontend rendering

`frontend/src/shared/components/diff/DiffViewer.tsx` mounts one DOM row per merged diff row and
runs truncation measurement against rendered line nodes. For very large diffs, this becomes costly
even if the diff algorithm itself is fast enough.

### Identity and multi-cluster constraints

No part of this work should loosen object identity requirements. Object diff selection and YAML
fetching must remain cluster-aware and continue to use canonical object identity with:

- `clusterId`
- `group`
- `version`
- `kind`

This plan changes diff computation and rendering only. It does not change the selection or lookup
contracts.

## Goals

- Support materially larger YAML diffs without freezing the desktop UI.
- Remove the current frontend/backend inconsistency around magic limits.
- Keep diff behavior deterministic and easy to test.
- Preserve current line-numbered side-by-side presentation.
- Keep existing object identity and multi-cluster behavior intact.

## Non-Goals

- Structural YAML diffing in the first pass.
- Rewriting the object diff modal UX.
- Replacing the side-by-side viewer with a text editor component.
- Eliminating all limits. Some budget will still be needed for worst-case inputs.

## Technical Direction

### Shared diff module

Phase 1 introduces a shared frontend diff module that is owned separately from the current
`yamlDiff.ts` object-panel utility. The object diff modal moves to this new module immediately.
Other diff surfaces can migrate later.

That module should define:

- the shared line-diff output contract used by the object diff modal
- named budgets rather than a single magic line limit
- object-diff-specific policy values for phase 1

The named budgets should be:

- `maxLinesPerSide`
- `maxComputeWork`
- `maxRenderableRows`

### Algorithm choice

Phase 1 uses a local Myers-style line diff in TypeScript.

That is the right choice for this phase because:

- it addresses the current LCS memory and time costs
- it keeps behavior deterministic
- it avoids adapting a third-party API into the app’s line-numbered contract
- it lets the app enforce its own work budget directly

The compute guard should be based on actual algorithm work or iteration count, not wall-clock time
and not a coarse `leftLines * rightLines` proxy.

### Budget policy

Phase 1 enforces all three budget types for the object diff modal:

- input budget: reject objects above `10k` lines per side
- compute budget: stop deterministic Myers work when `maxComputeWork` is exceeded
- render budget: reject the active mode when its actual row count exceeds `maxRenderableRows`

The render budget applies to the current mode’s row count. That means:

- `Diffs Only` can succeed when `Full View` is too large
- `Full View` still renders all context rows when it fits within budget
- the modal does not auto-switch modes when one mode is too large

When any budget is exceeded, the object diff modal should show a general “too large” warning.

### Rendering direction

Phase 1 keeps the current viewer behavior but adds render-budget enforcement before mounting a huge
diff. Phase 2 then virtualizes `DiffViewer` so large successful diffs do not mount one DOM row per
line.

The viewer work must preserve:

- left and right line numbering
- the existing `Full View` and `Diffs Only` modes
- expand/collapse behavior
- side selection and triple-click copy behavior

## Phase Checklist

### Phase 1: Object Diff Modal

- [ ] Add a new shared frontend diff module for the object diff path.
- [ ] Define named budgets in that module:
  - `maxLinesPerSide`
  - `maxComputeWork`
  - `maxRenderableRows`
- [ ] Set the initial object diff target to `10k` lines per side.
- [ ] Implement a local Myers-style line diff in TypeScript.
- [ ] Enforce deterministic compute-budget failure based on actual Myers work.
- [ ] Enforce render-budget failure based on the current mode’s actual row count.
- [ ] Switch `ObjectDiffModal` to the new shared diff path.
- [ ] Remove `ObjectDiffModal` reliance on the old `MAX_DIFF_LINES` constant.
- [ ] Keep both `Full View` and `Diffs Only` modes intact.
- [ ] Keep `Full View` rendering full context when it fits within budget.
- [ ] Show the general “too large” warning when the active mode exceeds any budget.
- [ ] Do not auto-switch from `Full View` to `Diffs Only`.
- [ ] Add broad tests early, including large fixtures for successful and rejected cases.

Phase 1 deliverable:

- object diff modal runs on the new frontend-owned diff path
- object diff budget handling is cleaned up and explicit
- large object diffs can be tested against the new algorithm and warning contract

### Phase 2: `DiffViewer` Virtualization

- [ ] Virtualize `DiffViewer` rows.
- [ ] Keep row identity stable so expand/collapse and copy behavior do not jitter.
- [ ] Limit truncation measurement to mounted rows.
- [ ] Re-test `Full View` and `Diffs Only` behavior against the virtualized viewer.
- [ ] Re-test side selection and triple-click copy behavior.
- [ ] Re-test muted lines and line-number rendering.
- [ ] Revisit `maxRenderableRows` after virtualization lands.

Phase 2 deliverable:

- large successful diffs no longer mount one DOM row per rendered line
- rendering cost is tied to the viewport window instead of total diff size

### Phase 3: Migrate Other Frontend Diff Surfaces

- [ ] Move YAML tab diff to the shared frontend diff module.
- [ ] Move rollback diff to the shared frontend diff module.
- [ ] Align warning behavior and budget handling across those surfaces.
- [ ] Keep any surface-specific UI differences out of the shared algorithm/budget code.

Phase 3 deliverable:

- object diff, YAML tab diff, and rollback diff share one frontend diff path

### Phase 4: Backend Mutation Diff Cleanup

- [ ] Revisit `backend/object_yaml_mutation.go`.
- [ ] Reduce backend ownership of diff generation where practical.
- [ ] Prefer backend retrieval/normalization of comparable YAML payloads over backend-owned diff
  lines for UI presentation.
- [ ] Align backend mutation-preview behavior with the frontend-owned diff direction.

Phase 4 deliverable:

- backend diff behavior no longer diverges from frontend diff behavior by accident

### Phase 5: Readability and Follow-up Tuning

- [ ] Evaluate whether Myers output is still too noisy for large YAMLs with reordering.
- [ ] Consider patience or histogram anchoring only if real examples justify it.
- [ ] Consider collapsed unchanged regions only after the virtualized baseline is stable.
- [ ] Tune shared budgets using real large Kubernetes resource fixtures.

Phase 5 deliverable:

- readability and limits are tuned on top of the new stable baseline rather than guessed up front

## Testing Plan

### Frontend

Add or extend tests for:

- the new shared diff module
  - identical input
  - insertions and deletions
  - large mostly-equal YAMLs
  - large one-sided additions
  - compute-budget signaling
  - render-budget signaling based on current mode
- `DiffViewer.tsx`
  - virtualization window behavior
  - diff-only filtering
  - selection-side switching
  - expand/collapse
  - muted-line rendering
- `ObjectDiffModal.tsx`
  - large diff warning state
  - successful rendering within the new budgets
  - `Full View` too large while `Diffs Only` fits
  - no automatic mode switching on budget failure
- `RollbackModal.tsx` and YAML tab
  - migration coverage in later phases

### Backend

Add or extend tests for:

- `backend/object_yaml_mutation.go`
  - later-phase cleanup coverage once backend diff ownership is revised

### Manual validation

Before shipping, validate with real resources that are known to be large:

- large CRDs
- Deployments or StatefulSets with large env/config sections
- ConfigMaps with many keys
- objects with muted/ignored metadata fields in object diff

## Risks

### Myers implementation complexity

Myers is more complex than the current matrix implementation. The mitigation is to keep the public
result contract unchanged and drive the replacement with strong fixture coverage.

### UI regressions in copy/selection behavior

`DiffViewer` currently has custom selection-side and triple-click behavior. Virtualization can break
that if row identity is not stable. This should be treated as a first-class regression target.

### Inconsistent frontend/backend behavior

If frontend and backend switch at different times, users may still see conflicting limits. The
phases above allow staggered work, but the final rollout should not stop before behavior is aligned.

## Decision Summary

- Phase 1 is object diff modal only.
- Phase 1 includes both algorithm replacement and object-diff budget cleanup.
- The initial implementation uses a local TypeScript Myers diff, not a new dependency.
- The backend remains responsible for object YAML retrieval and normalization, not object diff
  calculation.
- The initial target is `10k` lines per side.
- Budgeting is split into named input, compute, and render budgets.
- Compute budget uses deterministic algorithm work, not wall-clock time.
- Render budget is enforced in phase 1 before virtualization exists.
- The render budget applies to the active mode’s actual row count.
- `Full View` and `Diffs Only` remain available.
- The modal shows a general “too large” warning when the active mode exceeds budget.
- The modal does not auto-switch modes on budget failure.
- Virtualization is explicitly deferred to a later phase.
- YAML tab diff, rollback diff, and backend mutation diff stay in scope, but after object diff.
