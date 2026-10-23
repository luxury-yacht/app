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
   failure), the failure is reported operationally (no toast) and the save
   proceeds without a prompt; it must never block saving. An identity change
   found by the check comes back as `yamlConflict` and is likewise ignored;
   Apply reports it.
6. **Drift is watched while editing, never enforced.**
   - The tab keeps its `object-yaml` lease while it is active, also while
     editing. Live snapshots never touch the draft or its baseline; only
     editor actions set them.
   - Unsaved edits are the draft against its edit baseline
     (`hasUnsavedYamlEdits`, ignoring the fields the draft leaves out), never
     against the live object, so a change made elsewhere is not an edit.
     They light Save green and Cancel red, and make closing the panel ask
     first.
   - Drift is a new resourceVersion whose content differs from the baseline
     under the field policy's semantic compare. Status, resourceVersion, uid,
     managedFields, and the other server-managed fields are ignored, so
     controller churn is not drift.
   - A drifted object shows a field table (`yamlDriftFields.ts`): each field
     changed outside the editor, with its Original Value (when editing
     began), External Edit (live), and Your Edit (the draft's value, or a
     dash where the draft still holds the original value). Named list items
     are keyed by name. Values are shown in full, never truncated: a long
     value wraps inside its cell, preferring its separators, so both
     options stay in view in a docked panel.
   - A conflict is a field the draft also changed, to a different value. Its
     row offers the external edit and your edit as value chips; clicking
     a value keeps it.
     - The external edit copies the live value into the draft. Your edit
       keeps the draft's value, and restores it after the external edit was
       chosen.
     - A choice holds while the live value is unchanged and the draft still
       holds the chosen value.
     - Save and Merge wait until every conflict has a choice. The notice says
       which fields need one, and the merge button reads "Select values to
       keep" until then.
   - "Merge changes and continue editing" is Reload & Merge, which never
     writes. It applies the draft's own edits (the two-way baseline → draft
     patch, the same family Save sends) to the live object, so a field only
     changed outside the editor keeps its live value.
     - An edit to a field the live object also changed, to a different
       value, returns a `MergeConflict` with the live YAML. This is the field
       table's conflict rule.
     - For each field where your edit was chosen, the merge request's
       baseline carries the live value, so the merge applies your edit
       instead of stopping.
     - Saving without merging also keeps others' changes to fields the draft
       did not edit.
   - A replaced object (a live uid that differs from the baseline's, or an
     `ObjectUIDMismatch` conflict from Apply) offers Copy draft and Edit the
     new object. It offers no merge (the merge refuses a different object),
     and Save is disabled.
   - Conflicts (UID mismatch, merge conflict, failed merge precondition) are
     `yamlConflict` results on the Apply, Merge and ownership-check responses,
     never errors, so the live YAML cannot reach toasts, history, or
     telemetry. Real API rejections stay errors whose status carries the field
     causes.
7. **Every save is verified.** The editor re-fetches the live object,
   semantic-compares it with the submission, and shows a diff when
   controllers or concurrent writers changed the stored result.
   Save, Reload & Merge, and post-save re-read failures are shown in the
   editor and reported through `errorHandler.handleInline`, never as a toast
   that would repeat them.

## Known Gaps (accepted)

- Deleting a field owned by another manager does not warn: SSA dry runs cannot
  express removing an unowned field. Fixing it needs managedFields analysis of
  deleted paths.
- CRD list edits use JSON merge patch, which replaces whole arrays and ignores
  `x-kubernetes-list-type`; only SSA or precise JSON Patch fixes this.
- A same-field change made by someone else during the edit is flagged as
  drift, but saving anyway still writes the draft's value, like kubectl edit.

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
