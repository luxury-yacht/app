# YAML Editor Field Policy Plan

## Goal

Make the YAML editor show live Kubernetes objects without treating every visible
field as editable. Users should be able to see server-owned/generated fields in
context, while the app protects those fields from accidental edits and uses one
clear policy for editor protection, backend enforcement, merge behavior, and
post-save diff suppression.

## Problem

The YAML editor currently handles server-owned fields in several separate
places:

- read-only display hides or shows `metadata.managedFields`
- editable drafts may include or omit `managedFields` depending on the toggle
- backend mutation code rejects or strips selected metadata fields for patch and
  merge logic
- frontend post-save comparison strips selected fields before warning about
  live-object drift

Those code paths solve related but different problems, and the policy is not
obvious from one place. The result is confusing behavior: users may see a
post-save warning for harmless controller updates, or may be allowed to type in
fields that Kubernetes owns and the backend rejects anyway.

## Verified Current Behavior

The current app has two different backend behaviors for protected fields:

- `buildKubectlEditPatch` rejects changes to `apiVersion`, `kind`,
  `metadata.name`, and `metadata.managedFields` with precondition checks.
- `sanitizeForUpdate` strips `metadata.managedFields`, `metadata.selfLink`,
  `metadata.uid`, `metadata.creationTimestamp`, `metadata.deletionTimestamp`,
  `metadata.deletionGracePeriodSeconds`, `metadata.generation`, and `status`.
  It also carries the selected `metadata.resourceVersion` forward when present.
- reload/merge keeps the live `metadata.resourceVersion` authoritative even when
  the draft removed or edited it.

That split is the contract decision this plan must resolve: some fields should
produce a loud user-visible rejection, some may be quietly stripped only for
merge/reload bookkeeping, and some must preserve a server-selected value. The
policy must model those distinctions directly.

The frontend also has separate behavior today:

- `sanitizeYamlForSemanticCompare` strips server-owned metadata, `status`, and a
  small generated-annotation allowlist before deciding whether to show a
  post-save diff.
- The managedFields toggle can rebuild YAML text while editing, so changing the
  toggle can replace an active draft.
- `validateYamlDraft` rejects multi-document YAML, so protected range work only
  needs to support one Kubernetes object document.

## Desired Contract

Introduce a central YAML field policy with explicit behavior per path.

Each policy entry should describe:

- YAML path, such as `metadata.managedFields`
- whether the field is visible in read-only mode
- whether the field is visible in edit mode
- whether the field is editable
- whether the field is ignored in post-save semantic comparison
- backend behavior: `reject`, `strip`, `preserve`, or `allow`
- short user-facing explanation for protected fields

Use these policy defaults:

- Protected fields are visible in edit mode when present and are marked
  read-only.
- The managedFields toggle only affects read-only viewing. In edit mode,
  `metadata.managedFields` is always shown as protected when it exists in the
  live object, and the toggle must not rebuild the active draft.
- Protected edit attempts reject the whole editor transaction. Do not partially
  apply a paste, select-all delete, undo, or redo operation that touches a
  protected range.
- Generated annotation protection starts as exact-key matching, not kind-aware
  matching. Add kind constraints later only if exact keys prove too broad.
- `status` is visible and protected in edit mode. Submitted YAML that attempts
  to change `status` should be rejected; merge/reload internals may still strip
  `status` when computing a safe object patch.
- `metadata.resourceVersion` is visible and protected in edit mode with
  `backendBehavior: preserve`. It remains a concurrency/bookkeeping value owned
  by the live object; the backend should preserve the authoritative live or
  baseline value instead of treating submitted edits as desired state.

Initial policy candidates:

- `apiVersion`
- `kind`
- `metadata.name`
- `metadata.namespace` for namespaced resources
- `metadata.managedFields`
- `metadata.resourceVersion`
- `metadata.uid`
- `metadata.creationTimestamp`
- `metadata.deletionTimestamp`
- `metadata.deletionGracePeriodSeconds`
- `metadata.generation`
- `metadata.selfLink`
- `status`
- `metadata.annotations["deployment.kubernetes.io/revision"]`
- `metadata.annotations["deployment.kubernetes.io/desired-replicas"]`
- `metadata.annotations["deployment.kubernetes.io/max-replicas"]`
- `metadata.annotations["kubectl.kubernetes.io/last-applied-configuration"]`

Keep this allowlist conservative. Do not broadly ignore labels, selectors,
owner references, finalizers, Helm annotations, checksum annotations, restart
annotations, or anything under `spec`.

Frontend/backend parity must be enforced. Follow
`docs/architecture/shared-contracts.md`: the policy contract is code-owned by
the backend mutation subsystem, not stored in docs. Use a checked-in JSON policy
contract at `backend/object-yaml-field-policy-contract.json`, beside the current
`backend/object_yaml_*.go` implementation files, that the frontend imports
through `yamlFieldPolicy.ts`. Add a backend contract test that reads the same
JSON and asserts the Go enforcement table matches each entry's backend behavior.

## Design

### 1. Policy Contract And Frontend Module

Add a YAML field policy contract beside the current backend YAML mutation code,
plus a frontend wrapper near the YAML tab:

`backend/object-yaml-field-policy-contract.json`
`frontend/src/modules/object-panel/components/ObjectPanel/Yaml/yamlFieldPolicy.ts`

The TypeScript module should import the JSON policy and export:

- field policy entries
- helpers for semantic comparison stripping
- helpers for read-only/protected editor path matching
- user-facing protected-field messages

Because the contract lives outside `frontend/src`, explicitly support this
single import path in frontend TypeScript/Vite configuration, following the
existing refresh-domain contract precedent. Do not broaden frontend imports to
arbitrary backend code.

Move the post-save ignore list out of `yamlTabUtils.ts` into this policy module.
The save/no-op path must call these helpers so generated-field suppression lives
in one place.

The backend should keep its runtime enforcement in Go, but backend tests must
load the JSON contract and verify the Go table is in parity for every field with
`backendBehavior`. The parity test must be bidirectional: every JSON
`backendBehavior` entry must exist in the Go enforcement table, and every Go
enforced field must exist in the JSON contract so backend-only protected fields
cannot drift from frontend editor protection and semantic comparison.

### 2. YAML AST Path Resolution

Use the existing `yaml` package to parse documents and locate source ranges for
configured paths. The range resolver must handle:

- map keys and scalar values
- nested map paths
- annotation keys containing dots and slashes
- sequence or map subtrees such as `metadata.managedFields`
- whole subtree protection for `status`
- flow-style maps and sequences
- anchors and aliases
- comments adjacent to protected keys

When a protected path exists, protect the complete YAML node range, including the
key line when practical. If source range resolution fails, fall back to backend
enforcement rather than blocking unrelated edits.

Do this as a spike first against representative real objects, including at least
a Deployment with `managedFields` and a Service with dotted/slashed annotation
keys. Confirm the source ranges before committing to the CodeMirror UX.

### 3. CodeMirror Protected Ranges

Add a CodeMirror extension for protected YAML ranges.

The extension should:

- recompute protected ranges from the current document text
- decorate protected ranges with a subtle read-only style
- block transactions that insert/delete/change protected ranges
- allow normal edits outside protected ranges
- surface a clear message when a protected edit is blocked

Transaction behavior:

- transaction filtering must check proposed changes against the pre-transaction
  protected ranges from the old document before accepting the transaction; do not
  rely only on ranges recomputed from the post-change text, because deletes and
  replacements can remove the protected node before it can be found
- select-all delete is rejected if it would delete protected ranges
- whole-object paste/replacement is rejected if it changes protected ranges
- undo and redo are rejected by the same rule if they would change a protected
  range
- cluster/object changes must recompute ranges from the new source text before
  accepting edits

The blocked-edit message should be transient and local to the YAML tab, not a
global app error.

### 4. Edit Mode Behavior

In edit mode:

- show protected fields in the editor when they are present in the live object
- visually mark protected fields as read-only
- block edits to protected ranges
- keep the existing search/copy behavior working
- keep the managedFields toggle meaningful for read-only viewing, but avoid
  using it to mutate an active draft

ManagedFields behavior:

- read-only mode: toggle shows/hides it
- edit mode: always show it as protected when it exists
- do not let the toggle rebuild or replace the user’s active draft

### 5. Backend Enforcement

Frontend protection is UX only. Backend mutation must still enforce protected
fields.

Backend work:

- characterize current `buildKubectlEditPatch`, `sanitizeForUpdate`, and
  reload/merge behavior with tests before refactoring
- keep `apiVersion`, `kind`, `metadata.name`, and protected metadata fields
  guarded by preconditions
- reject submitted changes to `status`
- continue to strip `status` only in merge/reload paths where it is bookkeeping,
  not user intent
- add the JSON policy parity test described above

Do not rely on frontend protected ranges for correctness.

### 6. Semantic Compare

Use the same frontend policy for post-save semantic comparison.

The compare path should:

- strip fields marked `ignoreInSemanticCompare`
- prune empty metadata/annotations maps after stripping
- still warn for meaningful user-controlled changes
- keep the final live YAML visible after save
- avoid rendering ignored protected-field differences in the post-save diff
- render backend-rejected protected changes as validation/action errors instead
  of post-save diffs

## Phases

### Phase 0: Backend Contract Characterization

- [ ] Add backend tests for today's protected metadata/status behavior
- [ ] Cover `buildKubectlEditPatch`, `sanitizeForUpdate`, and reload/merge
      sanitization
- [ ] Add characterization tests for protected metadata/status bypass attempts to
      document today's behavior before refactoring
- [ ] Replace or flip characterization assertions as needed so the final suite
      asserts the desired `reject`, `strip`, and `preserve` behavior rather than
      preserving incomplete current behavior
- [ ] Keep complete cluster/GVK/object identity in all mutation requests

### Phase 1: Centralize Policy

- [ ] Add `backend/object-yaml-field-policy-contract.json` following
      `docs/architecture/shared-contracts.md`
- [ ] Add `yamlFieldPolicy.ts`
- [ ] Add the narrow TypeScript/Vite support needed for that specific backend
      contract JSON import, if the current config does not already allow it
- [ ] Move generated annotation ignore list into the policy module
- [ ] Move semantic compare stripping to policy helpers
- [ ] Add unit tests for policy stripping and empty-map pruning
- [ ] Add `TestYAMLFieldPolicyContract`, a backend contract test that verifies
      Go enforcement and the JSON policy's `backendBehavior` entries match in
      both directions

### Phase 2: Protected Range Prototype

- [ ] Prototype YAML path-to-source-range resolver before integrating CodeMirror
- [ ] Cover metadata scalar fields, annotation keys, `managedFields`, and
      `status`
- [ ] Cover flow style, anchors/aliases, and adjacent comments
- [ ] Add unit tests for range resolution across normal and representative YAML
      formatting cases

### Phase 3: CodeMirror Integration

- [ ] Add protected-range decorations
- [ ] Add transaction filter that blocks protected range edits
- [ ] Add blocked-edit feedback in `YamlTab`
- [ ] Add tests for blocked edits and allowed edits
- [ ] Add tests for select-all delete, whole-object paste, undo/redo, and
      cluster/object switches while editing

### Phase 4: Edit Mode Cleanup

- [ ] Stop rebuilding active drafts when the managedFields toggle changes
- [ ] Implement always-visible protected fields in edit mode
- [ ] Update shortcuts/context-menu tests if protected regions affect native
      copy/select/paste behavior

### Phase 5: Backend Contract Hardening

- [ ] Refactor backend enforcement behind the characterized policy behavior
- [ ] Align backend precondition/error messages with the policy terms
- [ ] Keep the Phase 0 characterization/bypass tests passing after the refactor

### Phase 6: Documentation And Validation

- [ ] Document the YAML editor protected-field behavior in the durable frontend
      docs if this plan is implemented
- [ ] Update release notes for user-visible behavior changes: protected fields
      are visible in edit mode, protected-range edits are blocked with a local
      message, and harmless generated-field drift creates fewer post-save
      warnings
- [ ] Run focused checks:
      `go test ./backend -run 'ObjectYaml|ObjectYAML|YAML|BuildKubectlEditPatch|YAMLFieldPolicyContract'`
- [ ] Run focused frontend checks:
      `npm run test --prefix frontend -- YamlTab yamlTabUtils yamlValidation yamlErrors`
- [ ] Run `npm run typecheck --prefix frontend`
- [ ] Run `mage qc:prerelease`

## Decisions

- Protected fields are visible in edit mode by default.
- Any transaction that touches a protected range is rejected as a whole.
- Generated annotation protection uses exact-key matching for this plan.
- Submitted `status` edits are rejected; merge/reload bookkeeping may strip
  status internally.
- `metadata.resourceVersion` uses preserve behavior: it is shown as protected,
  ignored as user intent, and carried from the authoritative live/baseline object
  where the backend needs it.
- Multi-document YAML remains unsupported by this editor path.

## Completion Criteria

- One policy contract defines YAML field behavior for comparison, editor
  protection, and backend behavior.
- Frontend/backend parity is enforced by test.
- Users can see protected fields in context without accidentally changing them.
- Protected-field edit attempts are blocked clearly in the editor.
- Backend mutation rejects protected-field bypass attempts.
- Harmless generated-field drift does not create noisy post-save warnings.
- Meaningful user-controlled changes still produce warnings/diffs when
  appropriate.
