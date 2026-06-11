# YAML Editing, Saving, and Field Ownership

How object YAML edits read, merge, save, and check field ownership across the
backend and the object panel. The shared text editor itself is covered by
[../frontend/yaml-editor.md](../frontend/yaml-editor.md).

## Ownership

- Save/validate/ownership/merge endpoints: `backend/object_yaml_mutation.go`,
  `backend/object_yaml_ownership.go`, `backend/object_yaml_reload_merge.go`
- GVK-strict read + resolution: `backend/object_yaml_by_gvk.go`,
  `backend/object_yaml_resolver.go`
- Field policy (shared Go↔TS contract):
  `backend/objectyaml/field_policy.go` +
  `backend/objectyaml/field-policy-contract.json` (frontend imports it via
  `@yaml-field-policy-contract`; the sync test in
  `backend/objectyaml/field_policy_test.go` keeps JSON and Go aligned)
- Edit transaction state machine:
  `frontend/src/modules/object-panel/.../Yaml/yamlTransaction.ts`

## Invariants

1. **Saves are kubectl-edit-style update patches, never server-side apply.**
   The backend builds a two-way merge patch between the editor baseline and
   the edited YAML — strategic merge for scheme-registered kinds, JSON merge
   patch for CRDs — and sends a plain `PATCH` with field manager
   `luxury-yacht-yaml-editor` (recorded as an `Update` operation). Applying
   the whole document via SSA would make the editor co-owner of every field
   and break other SSA participants; do not switch the write path to SSA.
2. **resourceVersion is deliberately neutralized in patches.**
   `PreserveFields` rewrites rv in both base and desired to the live value so
   the patch can never carry it, and the request's `resourceVersion` is not
   enforced. This is intentional: status-subresource writes bump rv
   constantly, so optimistic locking would 409 nearly every save on active
   objects. Delta-only patches already merge non-overlapping concurrent edits
   safely. Do not "fix" the missing version check.
3. **Identity is checked, not trusted.** The live object's UID must match the
   editor's tracked UID; patch preconditions reject changes to `apiVersion`,
   `kind`, `metadata.name`, and `metadata.managedFields`. All requests carry
   full `clusterId` + group/version/kind/namespace/name.
4. **The field policy contract is the single source for field handling.**
   Backend behaviors (`reject`/`strip`/`preserve`/`allow`) are enforced in
   `EnforceFieldPolicy`/`PreserveFields`; the frontend renders the same
   entries as protected ranges and semantic-compare filters. Change the Go
   rules and the JSON together — the sync test fails otherwise.
5. **The ownership check is advisory, dry-run, and fail-open.**
   `CheckObjectYamlOwnership` sends the sanitized draft as a server-side
   apply **dry run** (`force=false`); the API server reports per-field
   conflicts with manager names. Dry run persists nothing, so the check never
   records co-ownership. Conflicts from managers whose ownership is routine
   to take (the editor's own manager, `kubectl*`-prefixed managers) are
   filtered in `object_yaml_ownership.go`. The frontend shows surviving
   conflicts in a confirmation dialog (save anyway / keep editing / cancel
   edit) before calling the apply. If the check errors (no SSA support,
   transient failure), the save proceeds without a prompt — the check must
   never block saving. The intent strips `resourceVersion` and `status` so rv
   churn cannot surface as conflicts.
6. **Drift is discovered reactively, not enforced.** The `object-yaml`
   refresh domain is disabled while editing, so the snapshot freezes; drift
   surfaces through round-trips (a failed merge, ownership-check conflicts on
   untouched fields, the post-apply diff). Reload & Merge is an in-process
   three-way merge (`overwrite=false`) that never writes; unresolvable
   overlap returns a `MergeConflict` with the live YAML for manual review.
7. **Every save is verified after the fact.** The editor re-fetches the live
   object, semantic-compares it with what was submitted, and shows a diff
   when controllers or concurrent writers changed the stored result.

## Known gaps (accepted)

- Deleting a field owned by another manager does not warn — SSA dry runs
  cannot express removing an unowned field. Closing this requires
  managedFields analysis of deleted paths (see git history for the design
  discussion).
- CRD list edits use JSON merge patch, which replaces whole arrays;
  `x-kubernetes-list-type` is not honored. Only SSA or precise JSON Patch
  fixes this.
- Concurrent same-field overwrites are only visible in the post-apply diff.

## Rejected approaches (do not revisit without new evidence)

- **SSA for writes** — co-owns the entire document (see invariant 1).
- **Optimistic locking via rv in the patch** — status churn makes it
  unusable (see invariant 2).
- **Inline ownership underlines in the editor** — implemented and reverted
  (2026-06-11): controllers typically own most fields, so blanket decoration
  made the editor unreadably noisy. Ownership feedback is save-time only.

## Validation

- Backend: `go test ./backend -run 'ObjectYaml|YAMLFieldPolicy' ./backend/objectyaml`
- Frontend: vitest over `frontend/src/modules/object-panel/.../Yaml/`
- Full gate: `mage qc:prerelease`
