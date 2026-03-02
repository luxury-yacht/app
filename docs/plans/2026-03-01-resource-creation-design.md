# Resource Creation Design

**Date:** 2026-03-01
**Status:** Approved

## Overview

Add the ability to create any Kubernetes resource from within Luxury Yacht via a YAML editor modal, accessible from the command palette. Ships with curated starter templates for common resource types, with full support for freeform YAML and server-side dry-run validation.

## Decisions

- **Any resource via YAML** — not limited to specific kinds
- **Command palette entry** — no dedicated toolbar button
- **Modal dialog** — reuses the existing CodeMirror YAML editor
- **Curated templates** — Deployment, Service, ConfigMap, Secret, Job, CronJob, Ingress; extensible by appending to a Go slice
- **Validate then apply** — two-step soft gate: Validate and Create are independent buttons. Validate is optional (for the user's confidence); Create performs its own server-side validation during the actual create call. No hard gate requiring validation success before Create is enabled.
- **Default to current context** — pre-fill cluster/namespace from sidebar, user can change namespace. Synthetic namespace entries (e.g., "All Namespaces") are excluded from the creation dropdown.
- **Strict GVR resolution** — creation uses strict GVK→GVR resolution only. The kind-only fallback used by the YAML editor (for editing existing resources) is not used for creation; ambiguous resolution fails hard.

## Backend

### New File: `backend/object_yaml_creation.go`

Two new exported methods on `App`, following the existing `ValidateObjectYaml`/`ApplyObjectYaml` pattern.

**Types:**

```go
type ResourceCreationRequest struct {
    YAML      string `json:"yaml"`
    Namespace string `json:"namespace"` // optional override
}

type ResourceCreationResponse struct {
    Name            string `json:"name"`
    Namespace       string `json:"namespace"`
    Kind            string `json:"kind"`
    APIVersion      string `json:"apiVersion"`
    ResourceVersion string `json:"resourceVersion"`
}
```

**Methods:**

- `ValidateResourceCreation(clusterID string, req ResourceCreationRequest)` — parses YAML, resolves GVR via discovery, calls `dynamicClient.Resource(gvr).Create()` with `DryRun: []string{metav1.DryRunAll}`. Returns validation result or structured error.
- `CreateResource(clusterID string, req ResourceCreationRequest)` — same flow without dry-run. Creates the actual resource.

**Key differences from existing mutation code:**

- No `resourceVersion` requirement (new objects don't have one)
- No existing-object GET (nothing to compare against)
- No identity mismatch checks
- Namespace override: if `req.Namespace` is set and the resource is namespaced, override `metadata.namespace` in the YAML before creating
- Strict GVR resolution: uses a dedicated `resolveGVRStrict` function that queries API discovery and CRDs but does NOT fall back to `getGVRForDependencies` kind-only matching. If the exact group/version/kind cannot be resolved, it returns an error. This prevents cross-group collisions (e.g., same Kind in different API groups).
- Reuses existing helpers: `parseYAMLToUnstructured`, `wrapKubernetesError`

**Tests:** `backend/object_yaml_creation_test.go`

### New File: `backend/resources/templates/templates.go`

Curated YAML templates served to the frontend.

```go
type ResourceTemplate struct {
    Name        string `json:"name"`
    Kind        string `json:"kind"`
    APIVersion  string `json:"apiVersion"`
    Category    string `json:"category"`
    Description string `json:"description"`
    YAML        string `json:"yaml"`
}
```

- Templates: Deployment, Service (ClusterIP), ConfigMap, Secret, Job, CronJob, Ingress
- Grouped by category: "Workloads" (Deployment, Job, CronJob), "Networking" (Service, Ingress), "Config" (ConfigMap, Secret)
- `App.GetResourceTemplates()` returns the full list — no cluster dependency
- Templates use placeholder values (`my-deployment`, `my-namespace`) with inline comments
- Adding a new template = appending to the slice. No frontend changes needed.

## Frontend

### New Component: `CreateResourceModal`

**Location:** `frontend/src/ui/modals/CreateResourceModal.tsx` (colocated with AboutModal, SettingsModal, ObjectDiffModal)

**Modal layout (top to bottom):**

1. **Header** — "Create Resource" title, close button
2. **Context bar** — Cluster name displayed prominently. Namespace dropdown pre-filled with the active namespace (editable), excluding synthetic entries like "All Namespaces" (`isSynthetic === true`). If the current `selectedNamespace` is synthetic, default to no selection (user must pick). Hidden for cluster-scoped resources.
3. **Template picker** — Searchable dropdown grouped by category. "Blank" is always first, providing a minimal skeleton (`apiVersion:\nkind:\nmetadata:\n  name:\n`).
4. **YAML editor** — Reuses existing CodeMirror setup from YamlTab. Full-height with syntax highlighting.
5. **Footer** — Validate button (dry-run) and Create button. Validation errors displayed inline with field-level causes.

**Client-side intelligence:**

- As the user types, parse YAML client-side to extract `apiVersion` and `kind`
- Auto-detect namespaced vs cluster-scoped by looking up the parsed `kind` against the catalog's known resource types (already loaded in the frontend). If the kind is not found in the catalog (e.g., user is typing a CRD kind not yet cataloged), show the namespace selector and let the server validate.
- Immediate parse-error feedback for malformed YAML without server round-trip

**State management:**

- Local component state only — no new refresh domain
- Modal is ephemeral: open, edit, create, close

**Wails bindings:**

- `ValidateResourceCreation(clusterId, { yaml, namespace })`
- `CreateResource(clusterId, { yaml, namespace })`
- `GetResourceTemplates()`

### Command Palette Integration

**New command in `CommandPaletteCommands.tsx`:**

- `id: 'create-resource'`
- `label: 'Create Resource'`
- `category: 'Application'`
- `keywords: ['create', 'new', 'resource', 'yaml', 'apply', 'deploy']`
- `action: () => viewState.setIsCreateResourceOpen(true)`

**ViewState addition:**

- New boolean `isCreateResourceOpen`, same pattern as `isAboutOpen`, `isSettingsOpen`, `isObjectDiffOpen`
- `CreateResourceModal` rendered in `AppLayout.tsx` when `isCreateResourceOpen` is true

### Post-Creation Behavior

**Multi-cluster safety:** Capture `clusterId` and `clusterName` at submit time (before the async call begins). All post-creation actions use these captured values, not the current UI context — the user may switch clusters while the create request is in flight.

**Deterministic success sequence:**
1. Create call succeeds → receive response with resource metadata
2. Open the new object in the Object Panel via `openWithObject()` with explicit `clusterId` and `clusterName` from the captured values
3. Close the modal
4. Trigger `refreshOrchestrator.triggerManualRefreshForContext()` with no arguments — refresh whatever the user is currently viewing. The safety-critical multi-cluster pinning is in `openWithObject` (step 2) and the notification (step 5). The refresh is a UX convenience that should always target the current view.
5. Show success notification: "Created Deployment/my-app in namespace default on cluster prod-us-east-1"

## Error Handling & Multi-Cluster Safety

**Multi-cluster guardrails:**

- Modal always displays active cluster name prominently
- Backend methods require `clusterID` as first parameter — no default cluster fallback
- If no cluster is connected, modal shows "No cluster connected" instead of the editor
- `clusterId` and `clusterName` are captured at submit time and pinned through all post-create actions (refresh, object panel open, success notification) — immune to cluster-switch race conditions

**Error categories:**

| Error | Source | Display |
|-------|--------|---------|
| Malformed YAML | Client-side parse | Inline message below editor, immediate |
| Schema violations / missing fields | Server dry-run | Structured field-level causes via `objectYAMLError` |
| `AlreadyExists` | Server create | "A {Kind} named {name} already exists in namespace {ns}" |
| `Forbidden` | Server create | "You don't have permission to create {Kind} in namespace {ns}" |
| `Invalid` | Server create | Field-level causes listed |
| Network / cluster errors | Server | Generic error banner with raw message |

**No permissions system changes** — existing RBAC gating handles `create` verbs. Kubernetes API returns clear `Forbidden` errors.

## Extensibility

- **More templates:** Add to the `templates.go` slice with a `Category` — frontend picks them up automatically via the searchable grouped dropdown
- **Freeform YAML:** Fully supported from day one with the same validation quality as templates
- **Future enhancements:** Form-based creation for specific kinds could layer on top of this modal without replacing it
