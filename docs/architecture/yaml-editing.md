# YAML Editing, Saving, and Field Ownership

How object YAML edits read, merge, save, and check field ownership across the
backend and object panel. Editor mechanics: [YAML editor](../frontend/yaml-editor.md).

## Ownership

- Save/validate/ownership/merge: `backend/object_yaml_mutation.go`,
  `object_yaml_ownership.go`, `object_yaml_reload_merge.go`
- GVK-strict read and resolution: `backend/object_yaml_by_gvk.go`,
  `object_yaml_resolver.go`
- Field policy (shared Go↔TS contract): `backend/objectyaml/field_policy.go` +
  `field-policy-contract.json`, imported by the frontend as
  `@yaml-field-policy-contract`; `field_policy_test.go` keeps them in sync.
- Edit transaction state machine:
  `frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlTransaction.ts`

## Invariants

1. **Saves are kubectl-edit-style update patches, never server-side apply.**
   The backend builds a two-way merge patch between the editor baseline and
   the edited YAML (strategic merge for scheme-registered kinds, JSON merge
   patch for CRDs) and sends a plain `PATCH` with field manager
   `luxury-yacht-yaml-editor` (an `Update` operation).
2. **resourceVersion is deliberately neutralized.** `PreserveFields` rewrites
   rv in base and desired to the live value so the patch never carries it,
   and the request's `resourceVersion` is not enforced. Delta-only patches
   already merge non-overlapping concurrent edits safely.
3. **Identity is checked, not trusted.** The live UID must match the editor's
   tracked UID; patch preconditions reject changes to `apiVersion`, `kind`,
   `metadata.name`, and `metadata.managedFields`.
4. **The field policy contract is the single source for field handling.**
   `EnforceFieldPolicy`/`PreserveFields` enforce `reject`/`strip`/`preserve`/
   `allow`; the frontend renders the same entries as protected ranges and
   semantic-compare filters. Change Go rules and JSON together.
5. **The ownership check is advisory, dry-run, and fail-open.**
   `CheckObjectYamlOwnership` sends the sanitized draft (without
   `resourceVersion` and `status`, so rv churn cannot surface) as a
   server-side apply dry run (`force=false`); the API server reports per-field
   conflicts with manager names and persists nothing, so no co-ownership is
   recorded. `object_yaml_ownership.go` filters routine managers (the editor's
   own, `kubectl*`). Surviving conflicts open a save anyway / keep editing /
   cancel edit dialog before apply. If the check errors (no SSA, transient
   failure), the save proceeds without a prompt; it must never block saving.
6. **Drift is discovered reactively, not enforced.** The `object-yaml` refresh
   domain is disabled while editing, freezing the snapshot; drift surfaces
   through a failed merge, ownership conflicts on untouched fields, or the
   post-apply diff. Reload & Merge is an in-process three-way merge
   (`overwrite=false`) that never writes; unresolvable overlap returns a
   `MergeConflict` with the live YAML for manual review.
7. **Every save is verified.** The editor re-fetches the live object,
   semantic-compares it with the submission, and shows a diff when
   controllers or concurrent writers changed the stored result.

## Known Gaps (accepted)

- Deleting a field owned by another manager does not warn: SSA dry runs cannot
  express removing an unowned field. Fixing it needs managedFields analysis of
  deleted paths.
- CRD list edits use JSON merge patch, which replaces whole arrays and ignores
  `x-kubernetes-list-type`; only SSA or precise JSON Patch fixes this.
- Concurrent same-field overwrites show only in the post-apply diff.

## Rejected Approaches

- SSA for writes: the editor would co-own every field and break other SSA
  participants.
- Optimistic locking via rv in the patch: status-subresource churn would 409
  nearly every save on active objects. Do not "fix" the missing version check.
- Inline ownership underlines in the editor (implemented and reverted):
  controllers own most fields, so blanket decoration was unreadable. Ownership
  feedback is save-time only.

## Validation

- Backend: `go test ./backend -run 'ObjectYaml|YAMLFieldPolicy' ./backend/objectyaml`
- Frontend: Vitest over `frontend/src/modules/object-panel/components/ObjectPanel/Yaml/`
