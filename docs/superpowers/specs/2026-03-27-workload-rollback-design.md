# Workload Rollback Feature — Design Spec

## Overview

Add a rollback action for Deployments, StatefulSets, and DaemonSets. Users can view the full revision history, see a diff of each revision against the current state, and roll back to any previous revision.

## Backend

### New File: `backend/workload_rollback.go`

Two new public methods on the `App` struct, exposed to the frontend via Wails binding.

#### `GetRevisionHistory(clusterID, namespace, name, workloadKind string) ([]RevisionEntry, error)`

Returns revisions sorted by revision number descending (most recent first).

```go
type RevisionEntry struct {
    Revision    int64  `json:"revision"`
    CreatedAt   string `json:"createdAt"`   // RFC3339 timestamp
    ChangeCause string `json:"changeCause"` // kubernetes.io/change-cause annotation, may be empty
    Current     bool   `json:"current"`     // true for the active revision
    PodTemplate string `json:"podTemplate"` // serialized YAML of the pod template spec
}
```

**Per-kind retrieval:**

- **Deployments**: List ReplicaSets in the namespace, filter by owner reference matching the Deployment UID. Revision number comes from the `deployment.kubernetes.io/revision` annotation. Pod template from each ReplicaSet's `.spec.template`. The current revision is identified by matching the Deployment's own revision annotation.
- **StatefulSets / DaemonSets**: List ControllerRevisions in the namespace, filter by owner reference. Revision number from `.revision` field. Pod template extracted from `.data` (contains the serialized workload spec). Current revision identified by matching the workload's `status.currentRevision` (StatefulSet) or comparing the ControllerRevision hash to the workload's `status.observedGeneration`/template hash (DaemonSet).

The backend normalizes both retrieval paths into the same `RevisionEntry` shape.

#### `RollbackWorkload(clusterID, namespace, name, workloadKind string, toRevision int64) error`

Performs rollback by patching the workload's pod template to match the target revision's pod template. This is the same mechanism as `kubectl rollout undo --to-revision=N`.

**Steps:**
1. Call `GetRevisionHistory` to find the target revision's pod template.
2. Deserialize the target pod template.
3. Patch the workload's `.spec.template` with the target revision's template using `StrategicMergePatchType`.
4. Log the action.

**Error cases:**
- Unsupported workload kind
- Target revision not found
- Nil Kubernetes client
- Patch failure

### New File: `backend/workload_rollback_test.go`

Tests using `k8s.io/client-go/kubernetes/fake`:

- `TestGetRevisionHistory` — each kind (Deployment via ReplicaSets, StatefulSet/DaemonSet via ControllerRevisions). Verifies ordering, current flag, pod template content.
- Edge cases: no revisions, single revision, unsupported kind, nil client.
- `TestRollbackWorkload` — verifies pod template patch applied correctly for each kind. Error on unsupported kind, invalid revision.

Target: 80%+ coverage.

## Frontend: Shared Diff Components

### Extraction from ObjectDiffModal

The diff rendering logic is currently inline in `ui/modals/ObjectDiffModal.tsx` (1,515 lines). Extract reusable pieces into a new shared location.

#### New Directory: `shared/components/diff/`

**`DiffViewer.tsx`** — Reusable side-by-side diff display component.

Props:
- `lines: DisplayDiffLine[]` — merged diff output
- `leftLabel?: string` — column header for left side
- `rightLabel?: string` — column header for right side
- `leftMutedLines?: Set<number>` — line numbers to dim on left
- `rightMutedLines?: Set<number>` — line numbers to dim on right
- `showDiffOnly?: boolean` — external control for diff-only toggle
- `onShowDiffOnlyChange?: (value: boolean) => void` — callback for toggle changes
- `className?: string` — additional CSS class

Features carried over from ObjectDiffModal:
- Line expand/collapse toggles for wrapped text (overflow detection via `scrollWidth > clientWidth`)
- ResizeObserver-based truncation recomputation
- Selection side tracking (left/right)
- Muted metadata line styling

**`diffUtils.ts`** — Shared utilities extracted from ObjectDiffModal:
- `DisplayDiffLine` type (extends `DiffLine` with `leftType`/`rightType`)
- `TruncationMap` type
- `mergeDiffLines()` function
- `areTruncationMapsEqual()` function

**`DiffViewer.css`** — Diff-table-specific styles extracted from `ObjectDiffModal.css`:
- `.object-diff-row`, `.object-diff-cell`, `.object-diff-cell-left`, `.object-diff-cell-right`
- `.object-diff-cell-added`, `.object-diff-cell-removed`, `.object-diff-cell-muted`, `.object-diff-cell-context`
- `.object-diff-line-text`, `.object-diff-line-gutter`, `.object-diff-line-number`
- `.object-diff-expand-toggle`
- `.object-diff-table`, `.selection-left`, `.selection-right`

CSS class names are preserved to avoid renaming across the codebase.

**`DiffViewer.test.tsx`** — Tests:
- Renders diff lines with correct added/removed/context styling
- Expand/collapse toggles work
- Show-diff-only filters context lines
- Muted lines get dimmed class

#### ObjectDiffModal Refactor

After extraction, `ObjectDiffModal.tsx` imports `DiffViewer` and `diffUtils` from the shared location. The modal retains:
- Object selection panels (cluster/namespace/kind/object cascading dropdowns)
- YAML fetching and snapshot logic
- Modal chrome (open/close animations, focus trap, keyboard shortcuts)
- Column headers with change-age indicators

`ObjectDiffModal.css` retains modal-specific layout styles (selectors, column headers). Diff-table styles move to `DiffViewer.css`.

No behavioral change — purely mechanical extraction.

#### Existing Files That Stay Put

- `modules/object-panel/components/ObjectPanel/Yaml/yamlDiff.ts` — LCS diff algorithm. Already importable, not tightly coupled to the modal.
- `ui/modals/objectDiffUtils.ts` — YAML sanitization/masking. Already importable.

## Frontend: Rollback Modal

### New File: `shared/components/modals/RollbackModal.tsx`

#### Props

```typescript
interface RollbackModalProps {
  isOpen: boolean;
  onClose: () => void;
  clusterId: string;
  namespace: string;
  name: string;
  kind: string; // "Deployment" | "StatefulSet" | "DaemonSet"
}
```

#### Layout

- **Header**: "Rollback {Kind} — {name}" + close button
- **Body** — split layout:
  - **Left panel: Revision list** — scrollable list of revisions
    - Each entry shows: revision number, "current" badge on active revision, formatted age (e.g. "2 hours ago"), change-cause annotation (if present)
    - Current revision is disabled/unselectable
    - Most recent non-current revision is selected by default
    - Clicking a revision selects it and updates the diff panel
  - **Right panel: Diff viewer** — shared `DiffViewer` component showing the diff between the selected revision's pod template and the current revision's pod template
    - Diff collapsed by default on all except the most recent non-current revision (which is auto-selected, so its diff is visible on load)
    - When user clicks a different revision, that revision's diff expands (previous collapses)
- **Footer**: "Rollback to Revision {N}" button + "Cancel" button

#### Data Flow

1. Modal opens -> calls `GetRevisionHistory(clusterId, namespace, name, kind)` via Wails binding
2. Shows loading spinner while fetching
3. On success: renders revision list, auto-selects most recent non-current revision, computes diff for that revision
4. Diff computed client-side: `computeLineDiff(sanitizeYamlForDiff(currentPodTemplate), sanitizeYamlForDiff(selectedPodTemplate))` — left side = current (what you have), right side = selected revision (what you'd roll back to)
5. User clicks "Rollback to Revision N" -> confirmation dialog ("Are you sure you want to rollback {Kind} {name} to revision {N}? This will update the pod template to match the selected revision.") -> calls `RollbackWorkload` -> closes modal on success
6. Error states: fetch failure shows error message in modal body; rollback failure shows error in confirmation dialog

#### Edge Cases

- Single revision (only current): show message "No previous revisions available for rollback" with disabled rollback button
- Empty revision list: same handling
- Revision with no change-cause: omit the line, don't show placeholder text

### New File: `shared/components/modals/RollbackModal.css`

Styles for the rollback modal layout:
- Split panel layout (revision list left, diff right)
- Revision list entry styles (selected state, current badge, disabled state)
- Reuses existing modal framework from `modals.css`
- Reuses diff styles from shared `DiffViewer.css`

### New File: `shared/components/modals/RollbackModal.test.tsx`

Tests:
- Renders loading state while fetching history
- Renders revision list with correct entries, current badge, default selection
- Selecting a revision updates the diff panel
- Confirmation flow: click rollback -> confirmation prompt -> calls RollbackWorkload -> closes on success
- Error state for GetRevisionHistory failure
- Error state for RollbackWorkload failure
- Disabled rollback when only current revision exists

## Frontend: Action Integration

### `shared/hooks/useObjectActions.tsx`

- New constant: `export const ROLLBACKABLE_KINDS = ['Deployment', 'StatefulSet', 'DaemonSet']`
- New field in `ObjectActionHandlers`: `onRollback?: () => void`
- New field in `BuildObjectActionsOptions.permissions`: `rollback?: PermissionStatus | null`
- New icon import: `RollbackIcon` from `shared/components/icons/MenuIcons`
- Menu item: "Rollback" with `RollbackIcon`, positioned after Restart and before Scale
- Permission: `patch` verb on the workload kind (same as restart — rollback patches the pod template)
- `useObjectActions` hook: fetch rollback permission from permission map using `getPermissionKey(normalizedKind, 'patch', namespace, null, clusterId)`

### `shared/components/icons/MenuIcons.tsx`

New `RollbackIcon` SVG — a circular arrow / undo-style icon to visually distinguish from restart.

### `modules/namespace/components/NsViewWorkloads.tsx`

- Add state: `const [rollbackTarget, setRollbackTarget] = useState<WorkloadData | null>(null)`
- Add `onRollback` handler in `getContextMenuItems`: `onRollback: () => setRollbackTarget(row)`
- Add rollback permission lookup in `getContextMenuItems` (reuses same `patch` permission already fetched for restart)
- Render `<RollbackModal>` conditionally when `rollbackTarget` is set

### Object Panel Actions (`modules/object-panel/`)

- Add rollback handler in `useObjectPanelActions` following the same pattern as restart
- Wire to RollbackModal

### Capability System (`core/capabilities/actionPlanner.ts`)

- Register `'core.nodes.workload.rollback'` action for Deployment, StatefulSet, DaemonSet with `patch` verb

## File Summary

### New Files
| File | Purpose |
|------|---------|
| `backend/workload_rollback.go` | GetRevisionHistory + RollbackWorkload |
| `backend/workload_rollback_test.go` | Backend tests |
| `frontend/src/shared/components/diff/DiffViewer.tsx` | Reusable diff display component |
| `frontend/src/shared/components/diff/DiffViewer.css` | Diff table styles (extracted) |
| `frontend/src/shared/components/diff/DiffViewer.test.tsx` | Diff viewer tests |
| `frontend/src/shared/components/diff/diffUtils.ts` | Shared diff utilities (extracted) |
| `frontend/src/shared/components/modals/RollbackModal.tsx` | Rollback modal component |
| `frontend/src/shared/components/modals/RollbackModal.css` | Rollback modal styles |
| `frontend/src/shared/components/modals/RollbackModal.test.tsx` | Rollback modal tests |

### Modified Files
| File | Change |
|------|--------|
| `frontend/src/ui/modals/ObjectDiffModal.tsx` | Import DiffViewer + diffUtils from shared, remove inlined logic |
| `frontend/src/ui/modals/ObjectDiffModal.css` | Remove diff-table styles (moved to DiffViewer.css) |
| `frontend/src/shared/hooks/useObjectActions.tsx` | Add ROLLBACKABLE_KINDS, onRollback handler, rollback permission |
| `frontend/src/shared/components/icons/MenuIcons.tsx` | Add RollbackIcon |
| `frontend/src/modules/namespace/components/NsViewWorkloads.tsx` | Wire rollback action + modal |
| `frontend/src/core/capabilities/actionPlanner.ts` | Register rollback capability |
| `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelActions.ts` | Wire rollback action + modal |
