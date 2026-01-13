# Plan

## Goal
Remove the backend "base" kubeconfig dependency so all cluster tabs are treated equally, while preserving the notion of an active tab for UI focus.

## Scope and Constraints
- No primary/implicit cluster selection in backend behavior.
- All cluster-scoped operations must be explicit (cluster ID/scope required).
- Maintain Wails v2 + existing refresh/orchestrator architecture; no new deps.
- Preserve the current incremental multi-cluster refresh behavior; do not reintroduce refresh subsystem teardown/rebuild on tab open/close.

## Phased Plan

1) Audit and contract definition
- Map every usage of `selectedKubeconfig`/`selectedContext` and every backend API that can run without an explicit cluster scope.
- Define the new request contract: which endpoints require `clusterId` or cluster scope, and what error to return if missing.
- Impact: medium (clear contract to eliminate implicit routing). Effort: medium.

2) Backend: remove implicit base selection paths
- Update refresh subsystem wiring to avoid a "host" subsystem dependence; ensure aggregate handlers can operate without a base selection.
- Make kubeconfig selection storage and client pool fully list-based; deprecate single-selection fallbacks.
- Update any remaining code paths that still read `selectedKubeconfig`/`selectedContext` to require an explicit selection.
- Impact: high (eliminates hidden primary cluster behavior). Effort: high.

3) Backend: API and error handling alignment
- Require cluster scope for domains that are cluster-specific; return a clear 400 when missing.
- Adjust object catalog and refresh cache invalidation to work solely from explicit cluster IDs.
- Update migration logic to convert legacy single selections into the selection list.
- Impact: medium (predictable errors, no silent fallback). Effort: medium.

4) Frontend: always send explicit cluster scopes
- Ensure refresh/manual/streaming requests always include `clusterId` or `clusterId` list, including initial loads.
- Update contexts and scope builders so active/selected tabs explicitly drive every request.
- Impact: high (prevents implicit backend routing). Effort: medium.

5) Tests and docs
- Add/adjust tests to cover "no base" behavior (selection changes, missing scope errors, multi-tab operations).
- Add coverage to ensure opening/closing tabs does not trigger refresh subsystem rebuilds.
- Update `docs/development/multi-cluster-support.md` to reflect explicit scope requirements.
- Impact: medium (confidence + developer clarity). Effort: medium.
