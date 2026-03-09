# CreateResourceModal: File I/O & Cluster Import Design

**Date:** 2026-03-08
**Status:** Approved

## Overview

Add three capabilities to the CreateResourceModal:
1. **Open File** — load a YAML/JSON manifest from disk into the editor
2. **Save / Save As** — write the current editor content to a local file (with file path tracking)
3. **Import from Cluster** — browse objects in connected clusters, fetch their YAML (stripped of server fields), and load into the editor for modification

## Approach

Backend-centric (Approach A): native OS dialogs via Go/Wails, dedicated import picker component, full Open/Save/Save As support.

---

## Backend API

### New File: `backend/object_yaml_file_io.go`

#### `OpenResourceFile() (FileResult, error)`
- Opens native file dialog filtered to `*.yaml`, `*.yml`, `*.json`
- Reads file content, returns `FileResult{Path string, Content string}`
- Returns empty result if cancelled

#### `SaveResourceFile(path string, content string) error`
- Writes content to the given path (for "Save" when file path is known)

#### `SaveResourceFileAs(content string) (string, error)`
- Opens native save dialog filtered to `*.yaml`, `*.yml`, `*.json`
- Writes content to selected path, returns chosen path (or empty if cancelled)

### New File: `backend/object_yaml_import.go`

#### `GetClusterResourceKinds(clusterID string) ([]ResourceKindInfo, error)`
- Queries API server discovery (`ServerGroupsAndResources`)
- Returns `[]ResourceKindInfo{Kind, APIVersion, Namespaced bool, Category string}`
- Sorted and categorized, reuses `resolveGVRStrict` discovery pattern

#### `ListClusterObjectsByKind(clusterID string, kind string, namespace string) ([]ObjectSummary, error)`
- Returns `[]ObjectSummary{Name, Namespace, Kind, APIVersion, CreationTimestamp}`
- Lightweight list for the import picker
- Empty namespace for cluster-scoped resources

#### `GetClusterObjectYAML(clusterID string, kind string, apiVersion string, namespace string, name string) (string, error)`
- Fetches object via dynamic client
- Strips server-managed fields: resourceVersion, uid, creationTimestamp, managedFields, selfLink, generation, deletionTimestamp, deletionGracePeriodSeconds, ownerReferences, status, and the `kubectl.kubernetes.io/last-applied-configuration` annotation
- Extends the stripping logic from `prepareCreationContext` with additional fields needed for clean re-creation
- Returns clean YAML string

---

## Frontend: File I/O

### State Changes in `CreateResourceModal`

- New state: `currentFilePath: string | null` — tracks opened/saved file path

### Context Bar Actions

Three icon buttons added to context bar (right-aligned):

- **Open** (folder-open icon): Calls `OpenResourceFile()`, loads content into editor, stores path, switches to YAML view, resets template to "Custom"
- **Save** (save icon): If `currentFilePath` set, calls `SaveResourceFile(path, content)`. Otherwise behaves as Save As.
- **Save As** (save-plus/download icon): Calls `SaveResourceFileAs(content)`, stores returned path

### Keyboard Shortcuts

- `Cmd+O` — Open
- `Cmd+S` — Save
- `Cmd+Shift+S` — Save As

Registered when modal is open via existing keyboard context system.

### Behavior

- Opening a file replaces editor content (no unsaved-changes warning — modal is for drafting)
- Template dropdown resets to "Custom" or "Imported" after file open
- File path shown as subtle label in context bar when a file is loaded
- Save/Save As always enabled

---

## Frontend: Import from Cluster

### New Component: `ImportResourcePicker`

**File:** `frontend/src/ui/modals/create-resource/ImportResourcePicker.tsx`
**CSS:** `frontend/src/ui/modals/create-resource/ImportResourcePicker.css`

Secondary modal/overlay appearing on top of CreateResourceModal.

### Layout

```
+-------------------------------------------+
|  Import Resource from Cluster        [x]  |
+-------------------------------------------+
|  Cluster: [dropdown]  Kind: [dropdown]    |
|  Namespace: [dropdown]                    |
+-------------------------------------------+
|  [Search by name...]                      |
+-------------------------------------------+
|  | my-deployment         default   |      |
|  | nginx-ingress         ingress   |      |
|  | redis-cache           cache     |      |
|  | ...                             |      |
+-------------------------------------------+
|                      [Cancel]  [Import]   |
+-------------------------------------------+
```

### Flow

1. User clicks "Import" icon in context bar
2. ImportResourcePicker opens as overlay
3. User selects cluster (defaults to current target cluster)
4. User selects resource kind (grouped/categorized dropdown from `GetClusterResourceKinds`)
5. User optionally filters by namespace
6. `ListClusterObjectsByKind` populates object list
7. User selects object, clicks Import (or double-clicks)
8. `GetClusterObjectYAML` fetches cleaned YAML
9. YAML loaded into editor, template resets to "Imported: {kind}/{name}"
10. Picker closes

### Component Details

- Kind dropdown grouped by category (Workloads, Networking, Config, etc.)
- Object list searchable with client-side text filter
- List shows Name and Namespace columns, sorted alphabetically
- Loading/error states for list and fetch operations

---

## Error Handling

| Scenario | Behavior |
|----------|----------|
| File open/save cancelled | No-op, no error |
| File read/write error | Inline error in context bar (red text, auto-dismiss) |
| No clusters connected | Import button disabled, tooltip "Connect to a cluster first" |
| Kind listing fails | Error state in picker with retry |
| Object fetch fails | Error in picker, user can retry or pick another |
| Non-YAML/JSON file | Editor shows raw text; validation catches on create |
| Multi-document YAML | Warning suggesting user keep only one document |

---

## File Summary

### New Files

| File | Purpose |
|------|---------|
| `backend/object_yaml_file_io.go` | Open/Save/SaveAs Go methods |
| `backend/object_yaml_import.go` | Import methods + kind discovery |
| `frontend/src/ui/modals/create-resource/ImportResourcePicker.tsx` | Import picker component |
| `frontend/src/ui/modals/create-resource/ImportResourcePicker.css` | Import picker styles |

### Modified Files

| File | Changes |
|------|---------|
| `frontend/src/ui/modals/CreateResourceModal.tsx` | New state, context bar actions, keyboard shortcuts, import integration |
| `frontend/src/ui/modals/CreateResourceModal.css` | Styles for action buttons, file path display |
