# SSRR Consumer Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate frontend consumers from the old `evaluateNamespacePermissions` / `registerNamespaceCapabilityDefinitions` API to the new `queryNamespacePermissions` API, remove dead code, and verify the full system works end-to-end.

**Architecture:** The consumer migration is mechanical — three files change call sites, one file loses ~200 lines of dead SSAR machinery, and several files are deleted entirely. The public API surface (`useUserPermissions`, `useUserPermission`, `getPermissionKey`, `useObjectActions`, `PermissionStatus`) is unchanged, so most view components need zero modifications.

**Tech Stack:** TypeScript, React

**Design doc:** `docs/plans/ssrr-permissions-design.md`

**Depends on:** `docs/plans/ssrr-frontend-store-implementation.md` (Plan 2 — new store must be in place)

---

## File Structure

| File | Responsibility |
|---|---|
| **Modify:** `frontend/src/modules/namespace/contexts/NsResourcesContext.tsx` | Remove SSAR machinery (~200 lines); replace blanket effect with `queryNamespacePermissions` |
| **Modify:** `frontend/src/modules/namespace/contexts/NamespaceContext.tsx` | Swap `evaluateNamespacePermissions` → `queryNamespacePermissions` |
| **Modify:** `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.tsx` | Swap `evaluateNamespacePermissions` → `queryNamespacePermissions` |
| **Delete:** `frontend/src/core/capabilities/actionPlanner.ts` | Dead code (never called from components) |
| **Delete:** `frontend/src/core/capabilities/actionPlanner.test.ts` | Tests for dead code |
| **Modify:** `frontend/src/core/capabilities/index.ts` | Remove re-exports for deleted modules |
| **Modify:** `frontend/src/core/refresh/components/DiagnosticsPanel.tsx` | Multi-cluster key fix + SSRR-specific columns (method, incomplete, ruleCount, fallbackCount) |
| **Verify (no changes):** `NodeMaintenanceTab.tsx`, `useObjectPanelCapabilities.ts`, `ClusterResourcesContext.tsx`, `ClusterResourcesManager.tsx`, all 16+ view components | Confirm unchanged files still work |

---

### Task 1: `NamespaceContext.tsx` — Swap Permission Trigger

**Files:**
- Modify: `frontend/src/modules/namespace/contexts/NamespaceContext.tsx:23,322`

- [ ] **Step 1: Update the import**

At line 23, change:
```typescript
// DELETE:
import { evaluateNamespacePermissions } from '@/core/capabilities';
// ADD:
import { queryNamespacePermissions } from '@/core/capabilities';
```

- [ ] **Step 2: Update the call site**

At line 322, change:
```typescript
// DELETE:
  evaluateNamespacePermissions(namespaceToEvaluate, { clusterId });
// ADD:
  queryNamespacePermissions(namespaceToEvaluate, clusterId ?? null);
```

The `lastEvaluatedNamespaceRef` dedup guard (lines 314-319) and `isAllNamespaces` guard (line 310) remain unchanged.

- [ ] **Step 3: Run existing tests**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run src/modules/namespace/contexts/NamespaceContext.test`
Expected: Tests that mock `evaluateNamespacePermissions` need their mock updated to `queryNamespacePermissions`.

- [ ] **Step 4: Fix test mocks if needed**

Update `vi.mock('@/core/capabilities', ...)` to include `queryNamespacePermissions` instead of `evaluateNamespacePermissions`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/namespace/contexts/NamespaceContext.tsx
git commit -m "refactor(namespace): use queryNamespacePermissions for namespace selection"
```

---

### Task 2: `ObjectPanel.tsx` — Swap Permission Trigger

**Files:**
- Modify: `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.tsx:20,239`

- [ ] **Step 1: Update the import**

At line 20, change:
```typescript
// DELETE:
import { evaluateNamespacePermissions } from '@/core/capabilities';
// ADD:
import { queryNamespacePermissions } from '@/core/capabilities';
```

- [ ] **Step 2: Update the call site**

At line 239, change:
```typescript
// DELETE:
  evaluateNamespacePermissions(namespace, { clusterId: objectData?.clusterId ?? null });
// ADD:
  queryNamespacePermissions(namespace, objectData?.clusterId ?? null);
```

The `lastEvaluatedNamespaceRef` guard remains.

- [ ] **Step 3: Run existing tests**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run src/modules/object-panel/components/ObjectPanel/ObjectPanel.test`
Expected: Update mock for `queryNamespacePermissions`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.tsx
git commit -m "refactor(object-panel): use queryNamespacePermissions for cross-namespace panels"
```

---

### Task 3: `NsResourcesContext.tsx` — Replace Blanket Effect

**Files:**
- Modify: `frontend/src/modules/namespace/contexts/NsResourcesContext.tsx`

This is the largest single change. The blanket `useEffect` at lines 1184-1203 replaces the old machinery and is the sole trigger for namespace permissions.

- [ ] **Step 1: Replace the blanket effect (lines 1184-1203)**

```typescript
// REPLACE lines 1184-1203 with:
useEffect(() => {
  const capabilityNamespace = getCapabilityNamespace(currentNamespace);
  if (!capabilityNamespace) {
    return;
  }
  queryNamespacePermissions(capabilityNamespace, namespaceClusterId ?? null);
}, [currentNamespace, namespaceClusterId]);
```

- [ ] **Step 2: Update imports (lines 30-34)**

Remove the old capability imports:
```typescript
// DELETE lines 30-34:
import {
  DEFAULT_CAPABILITY_TTL_MS,
  evaluateNamespacePermissions,
  registerNamespaceCapabilityDefinitions,
} from '@/core/capabilities';
```

Add the new import:
```typescript
import { queryNamespacePermissions } from '@/core/capabilities';
```

- [ ] **Step 3: Remove the `CapabilityDefinition` type import**

Delete line 44:
```typescript
// DELETE:
import type { CapabilityDefinition } from '@/core/capabilities/catalog';
```

- [ ] **Step 4: Run tests to verify the blanket effect works**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run src/modules/namespace/contexts/NsResourcesContext.test`
Expected: Tests that assert on `evaluateNamespacePermissions` / `registerNamespaceCapabilityDefinitions` calls need mocks updated. The core behavior (namespace change → permission query) should still work.

- [ ] **Step 5: Commit the blanket effect replacement**

```bash
git add frontend/src/modules/namespace/contexts/NsResourcesContext.tsx
git commit -m "refactor(namespace): replace blanket capability effect with queryNamespacePermissions"
```

---

### Task 4: `NsResourcesContext.tsx` — Remove Per-Resource Capability Triggers

**Files:**
- Modify: `frontend/src/modules/namespace/contexts/NsResourcesContext.tsx`

With the blanket effect now driving all namespace permissions via `queryNamespacePermissions`, the per-resource-load/refresh capability registration sites are dead code.

- [ ] **Step 1: Remove capability blocks from `useNamespacePodsResource`**

Remove the capability registration blocks inside `baseLoad` (lines ~420-431) and `refresh` (lines ~439-449) callbacks. These are the blocks guarded by `if (capabilityNamespace)` that call `buildCapabilityDefinitionsForNamespace` + `registerNamespaceCapabilityDefinitions` + `evaluateNamespacePermissions`.

Also remove the `capabilityNamespace` memo that fed them (line ~411):
```typescript
// DELETE:
const capabilityNamespace = getCapabilityNamespace(currentNamespace);
```
(Only if this variable is not used for any other purpose in the function — verify before removing.)

- [ ] **Step 2: Remove capability blocks from `useRefreshBackedResource`**

Remove the capability registration blocks inside `load` (lines ~543-555) and `refresh` (lines ~572-583) callbacks.

Remove the `capabilitySpecs` memo (lines ~532-535) and `capabilityNamespace` memo (line ~536) that fed them.

- [ ] **Step 3: Run tests**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run src/modules/namespace/contexts/NsResourcesContext.test`
Expected: PASS — the blanket effect covers all permissions; per-resource triggers were redundant.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/namespace/contexts/NsResourcesContext.tsx
git commit -m "refactor(namespace): remove per-resource capability registration triggers

The blanket useEffect now handles all namespace permissions via
queryNamespacePermissions. Per-load and per-refresh capability
registration was redundant with the blanket effect."
```

---

### Task 5: `NsResourcesContext.tsx` — Remove Dead Definitions

**Files:**
- Modify: `frontend/src/modules/namespace/contexts/NsResourcesContext.tsx`

- [ ] **Step 1: Remove the old spec definitions**

Delete the following (verify exact line numbers — they may have shifted from prior task edits):

- `NamespaceCapabilitySpec` type definition (lines ~109-115)
- `NAMESPACE_CAPABILITY_SPECS` constant (lines ~117-306) — all ~190 lines
- `PODS_CAPABILITY_SPECS` constant (lines ~309-330)
- `buildCapabilityDefinitionsForNamespace` helper function (lines ~350-370)

- [ ] **Step 2: Verify nothing else references these**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && grep -rn "NAMESPACE_CAPABILITY_SPECS\|PODS_CAPABILITY_SPECS\|buildCapabilityDefinitionsForNamespace\|NamespaceCapabilitySpec" src/`
Expected: Zero results (other than test files that will be updated).

- [ ] **Step 3: Run tests**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run src/modules/namespace/`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/namespace/contexts/NsResourcesContext.tsx
git commit -m "refactor(namespace): remove NAMESPACE_CAPABILITY_SPECS and SSAR helpers

These are replaced by the PermissionSpec lists in permissionSpecs.ts.
~200 lines of dead code removed."
```

---

### Task 6: Remove `actionPlanner.ts`

**Files:**
- Delete: `frontend/src/core/capabilities/actionPlanner.ts`
- Delete: `frontend/src/core/capabilities/actionPlanner.test.ts`
- Modify: `frontend/src/core/capabilities/index.ts`

- [ ] **Step 1: Verify no runtime callers**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && grep -rn "ensureNamespaceActionCapabilities\|actionPlanner" src/ --include="*.ts" --include="*.tsx" | grep -v "test\|\.test\." | grep -v "index.ts"`
Expected: Zero results (only test files and the index.ts re-export).

- [ ] **Step 2: Delete the files**

```bash
rm frontend/src/core/capabilities/actionPlanner.ts
rm frontend/src/core/capabilities/actionPlanner.test.ts
```

- [ ] **Step 3: Remove exports from `index.ts`**

Remove these lines from `frontend/src/core/capabilities/index.ts`:
```typescript
// DELETE:
export { ensureNamespaceActionCapabilities } from './actionPlanner';
export type { CapabilityActionId, RestartableOwnerKind } from './actionPlanner';
```

- [ ] **Step 4: Verify the build**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit`
Expected: No errors referencing the deleted exports.

- [ ] **Step 5: Commit**

```bash
git add -A frontend/src/core/capabilities/
git commit -m "refactor(capabilities): remove dead actionPlanner module

ensureNamespaceActionCapabilities was never called from any component.
Removes ~280 lines of dead code and its test file."
```

---

### Task 7: Feature String Audit

**Files:**
- Verify: `frontend/src/core/refresh/components/diagnostics/diagnosticsPanelConfig.ts`

- [ ] **Step 1: Cross-reference feature strings**

Read `diagnosticsPanelConfig.ts` and list all feature strings in `CLUSTER_FEATURE_MAP` and `NAMESPACE_FEATURE_MAP`. Compare against the `feature` values in `permissionSpecs.ts`:

| diagnosticsPanelConfig.ts | permissionSpecs.ts |
|---|---|
| Check each string | Must match exactly |

- [ ] **Step 2: Fix any mismatches**

If feature strings differ (e.g., `"Namespace workloads"` vs `"workloads"`), update `permissionSpecs.ts` to match the existing strings in `diagnosticsPanelConfig.ts` — the config file is the source of truth for the diagnostics panel filter.

- [ ] **Step 3: Commit if changes needed**

```bash
git add frontend/src/core/capabilities/permissionSpecs.ts
git commit -m "fix(capabilities): align permission spec feature strings with diagnostics config"
```

---

### Task 8: Migrate `DiagnosticsPanel.tsx` — Multi-Cluster Keys + SSRR Columns

**Files:**
- Modify: `frontend/src/core/refresh/components/DiagnosticsPanel.tsx`

Two changes required:

**A. Multi-cluster key fix.** The panel currently rebuilds permission
keys without `clusterId` in two places (`:1500` and `:1574`), causing
key collisions in multi-cluster All Namespaces sessions.

**B. SSRR-specific columns.** The design doc (lines 678, 912) requires
adding `method`, `ssrrIncomplete`, `ssrrRuleCount`, and
`ssarFallbackCount` columns to the capability batch table. The backend
now returns these via `NamespaceDiagnostics` and the frontend store
populates them in `PermissionQueryDiagnostics`. The panel must display
them.

- [ ] **Step 1: Fix the descriptor-index key construction (~line 1500)**

The current code:
```typescript
const key = getPermissionKey(
  descriptor.resourceKind,
  descriptor.verb,
  descriptor.namespace ?? null,
  descriptor.subresource ?? null
);
```

Change to pass `clusterId` from the diagnostics entry:
```typescript
const key = getPermissionKey(
  descriptor.resourceKind,
  descriptor.verb,
  descriptor.namespace ?? null,
  descriptor.subresource ?? null,
  entry.clusterId ?? null
);
```

- [ ] **Step 2: Fix the permission-row key construction (~line 1574)**

The current code:
```typescript
const descriptorKey = getPermissionKey(
  status.descriptor.resourceKind,
  status.descriptor.verb,
  status.descriptor.namespace ?? null,
  status.descriptor.subresource ?? null
);
```

Change to use `status.id` directly (which is already the full
cluster-qualified key) or pass `clusterId`:
```typescript
const descriptorKey = status.id;
```

Using `status.id` is cleaner — it's already the full cluster-qualified
permission key, so the lookup against `capabilityDescriptorIndex` will
match correctly across clusters.

- [ ] **Step 3: Add SSRR-specific columns to the batch diagnostics table**

In the `capabilityBatchRows` `useMemo` (~line 1459), each batch row
is built from a `capabilityDiagnostics` entry. The new
`PermissionQueryDiagnostics` type includes `method`, `ssrrIncomplete`,
`ssrrRuleCount`, and `ssarFallbackCount`. Add these to the row object:

```typescript
// Inside the .map() that builds batch rows, after existing fields:
method: entry.method ?? '—',
ssrrIncomplete: entry.ssrrIncomplete ?? false,
ssrrRuleCount: entry.ssrrRuleCount ?? null,
ssarFallbackCount: entry.ssarFallbackCount ?? null,
```

Then in the batch table's column definitions (search for where
`capabilityBatchRows` is rendered as a table), add columns:

```typescript
{ header: 'Method', accessor: 'method' },           // "ssrr" or "ssar"
{ header: 'Incomplete', accessor: 'ssrrIncomplete' }, // boolean
{ header: 'Rules', accessor: 'ssrrRuleCount' },       // number or null
{ header: 'SSAR Fallback', accessor: 'ssarFallbackCount' }, // number or null
```

These columns surface the SSRR diagnostic metadata that the design doc
requires (design doc lines 678, 912). For SSAR-only batches (cluster-
scoped), `method` is `"ssar"` and the SSRR fields are null/false.

- [ ] **Step 4: Run diagnostics panel tests**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run src/core/refresh/components/DiagnosticsPanel`
Expected: PASS (update snapshot tests if any)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/core/refresh/components/DiagnosticsPanel.tsx
git commit -m "feat(diagnostics): add SSRR columns and multi-cluster key fix

Adds method, ssrrIncomplete, ssrrRuleCount, and ssarFallbackCount
columns to the batch diagnostics table. Fixes multi-cluster key
collision by using entry.clusterId and status.id for lookups."
```

---

### Task 9: Verify Remaining Unchanged Consumers

These files should work without modification. The diagnostics hook
(`useCapabilityDiagnostics`) was rewritten in Plan 2 Task 5 to delegate
to the new store, returning `PermissionQueryDiagnostics[]`.

**Files (verify only, no changes):**
- `frontend/src/modules/object-panel/components/ObjectPanel/Maintenance/NodeMaintenanceTab.tsx`
- `frontend/src/modules/object-panel/components/ObjectPanel/hooks/useObjectPanelCapabilities.ts`
- `frontend/src/modules/cluster/contexts/ClusterResourcesContext.tsx`
- `frontend/src/modules/cluster/components/ClusterResourcesManager.tsx`
- `frontend/src/shared/hooks/useObjectActions.tsx`
- `frontend/src/modules/namespace/components/NsViewCustom.tsx`
- `frontend/src/modules/cluster/components/ClusterViewCustom.tsx`

- [ ] **Step 1: Run the full test suite**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run`
Expected: All tests pass.

- [ ] **Step 2: Verify key invariants**

For each unchanged consumer, verify:
1. `useUserPermissions()` returns a `PermissionMap` — same hook, same return type
2. `useUserPermission()` returns `PermissionStatus | undefined` — same hook
3. `getPermissionKey()` returns the same format (`clusterId|kind|verb|namespace|subresource`)
4. `PermissionStatus.entry.status` is `'loading' | 'ready' | 'error'` — used by `ClusterResourcesContext` and `ClusterResourcesManager`
5. `PermissionStatus.reason` is populated for denials — used by `ClusterResourcesManager.permissionToMessage()`
6. `PermissionStatus.feature` is populated — used by `DiagnosticsPanel` for feature-scoped filtering

---

### Task 10: Run Full QC

- [ ] **Step 1: Run the prerelease QC suite**

Run: `cd /Volumes/git/luxury-yacht/app && mage qc:prerelease`
Expected: All checks pass.

- [ ] **Step 2: Fix any issues**

- [ ] **Step 3: Final commit if fixes needed**

```bash
git add -A
git commit -m "fix: address QC issues from consumer migration"
```

---

## Summary

| Task | What it changes | Risk |
|---|---|---|
| 1 | `NamespaceContext.tsx` — swap import + call | Low (1 import, 1 call) |
| 2 | `ObjectPanel.tsx` — swap import + call | Low (1 import, 1 call) |
| 3 | `NsResourcesContext.tsx` — replace blanket effect | Medium (core trigger path) |
| 4 | `NsResourcesContext.tsx` — remove per-resource triggers | Medium (5 call sites) |
| 5 | `NsResourcesContext.tsx` — remove dead definitions | Low (dead code only) |
| 6 | Remove `actionPlanner.ts` | Low (dead code, verified no callers) |
| 7 | Feature string audit | Low (verification only) |
| 8 | `DiagnosticsPanel.tsx` — multi-cluster key fix + SSRR columns | Medium (correctness + new UI) |
| 9 | Verify remaining unchanged consumers | Low (no code changes) |
| 10 | Full QC | Gate |

**Files unchanged (verified):**
- `NodeMaintenanceTab.tsx` — `useCapabilities` API preserved
- `useObjectPanelCapabilities.ts` — `useCapabilities` + `useUserPermission` preserved
- `ClusterResourcesContext.tsx` — `useUserPermission` + `entry.status` preserved
- `ClusterResourcesManager.tsx` — `permissionToMessage` reads `reason` + `entry.status`
- `useObjectActions.tsx` — pure `permissionMap.get(getPermissionKey(...))` consumer
- All 16+ view components — pure `useUserPermissions()` consumers
