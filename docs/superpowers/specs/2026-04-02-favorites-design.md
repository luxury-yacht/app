# Favorites Feature Design

## Overview

Favorites let users save and quickly navigate to specific views with their filters, sort order, and column visibility. Two types exist:

- **Generic favorites** — not tied to a cluster. Opens in whatever cluster is currently active.
- **Cluster-specific favorites** — pinned to a specific cluster. Switches to (or opens) that cluster when activated.

## Access Points

### 1. Favorites Menu (Header)

A heart icon button in the app header toolbar (between the kubeconfig selector and the settings button). Clicking opens a dropdown panel listing all saved favorites.

**Dropdown behavior:**
- Width is dynamic (max-content, min 200px)
- Each item shows its name, with a dashed-circle icon for generic favorites and a pin icon for cluster-specific ones
- Clicking a favorite navigates to it (see Navigation section)
- Hover actions appear on each item: up arrow, down arrow, rename (pencil), delete (trash) — overlaid on the right side of the row with a gradient fade
- Double-click a favorite name to rename inline
- Drag to reorder (supported alongside up/down arrows)
- Disabled state for favorites whose target namespace doesn't exist in the active cluster

### 2. Heart Icon in Filter Bar (Views)

Every grid table view has a heart toggle in the IconBar within the filter bar. The IconBar order is: Reset, Favorite (heart), Separator, [view-specific actions like Load More].

**Heart states:**
- **Outline heart** — current view is not a favorite. Clicking shows a small choice: "Save for any cluster" vs "Save for this cluster". Saves with an auto-generated name.
- **Filled heart** — current view matches an existing favorite (matched by cluster + viewType + view + namespace). Clicking shows a popover with Update and Remove options.

### 3. Command Palette

Favorites appear as a group in the command palette, between Navigation and Namespaces. Searchable like any other command. Uses the same dashed-circle/pin icons.

## Data Model

### Favorite struct (Go, persisted in persistence.json)

```go
type Favorite struct {
    ID               string              `json:"id"`               // UUID
    Name             string              `json:"name"`             // Display name (auto-generated, user-renamable)
    ClusterSelection string              `json:"clusterSelection"` // "path:context" format, empty for generic
    ViewType         string              `json:"viewType"`         // "namespace" or "cluster"
    View             string              `json:"view"`             // NamespaceViewType or ClusterViewType value
    Namespace        string              `json:"namespace"`        // Namespace name (empty for cluster views)
    Filters          *FavoriteFilters    `json:"filters"`          // Active filters
    TableState       *FavoriteTableState `json:"tableState"`       // Sort + column visibility
    Order            int                 `json:"order"`            // Sort position for drag reorder
}

type FavoriteFilters struct {
    Search     string   `json:"search"`
    Kinds      []string `json:"kinds"`
    Namespaces []string `json:"namespaces"`
}

type FavoriteTableState struct {
    SortColumn       string          `json:"sortColumn"`
    SortDirection    string          `json:"sortDirection"` // "asc" or "desc"
    ColumnVisibility map[string]bool `json:"columnVisibility"`
}
```

### Auto-generated name format

- Cluster view: `"{contextName} / {viewLabel}"` (e.g. "production / Nodes")
- Namespace view: `"{contextName} / {namespace} / {viewLabel}"` (e.g. "production / default / Pods")
- Generic: same format but without context name (e.g. "default / Pods")
- With filters: append `" (filtered)"` (e.g. "default / Pods (filtered)")

## Persistence

Stored in `persistence.json` alongside `clusterTabs` and `tables`:

```json
{
  "schemaVersion": 1,
  "favorites": [
    { "id": "...", "name": "Prod CronJobs", "clusterSelection": "/path:prod", ... }
  ],
  "clusterTabs": { ... },
  "tables": { ... }
}
```

Uses existing atomic write infrastructure (`savePersistenceFile()`).

## Backend API

New methods on `*App`, protected by `persistenceMu`:

```go
GetFavorites() []Favorite
AddFavorite(fav Favorite) Favorite       // Generate ID, append, persist, return with ID
UpdateFavorite(fav Favorite) error       // Match by ID, replace, persist
DeleteFavorite(id string) error          // Remove by ID, persist
SetFavoriteOrder(ids []string) error     // Reorder by ID list, persist
```

## Frontend Architecture

### Persistence Layer (`core/persistence/favorites.ts`)

- `hydrateFavorites()` — calls `GetFavorites()` on startup, caches in module state
- `getFavorites()` — returns cached list
- `addFavorite(fav)` / `updateFavorite(fav)` / `deleteFavorite(id)` / `setFavoriteOrder(ids)` — call backend, update cache, emit event
- `subscribeFavorites(handler)` — event bus subscription for reactive updates

### Context (`core/contexts/FavoritesContext.tsx`)

Provides:
- `favorites` — the full list
- `addFavorite`, `updateFavorite`, `deleteFavorite`, `reorderFavorites` — mutations
- `currentFavoriteMatch: Favorite | null` — computed by comparing current navigation state against favorites list (frontend-side matching, no async)

Matching logic compares: `selectedKubeconfig === fav.clusterSelection`, `viewType === fav.viewType`, `activeView === fav.view`, `selectedNamespace === fav.namespace`.

### Navigation (clicking a favorite)

1. If cluster-specific and cluster not open: `setSelectedKubeconfigs([...current, fav.clusterSelection])` then `setActiveKubeconfig(fav.clusterSelection)`
2. If cluster-specific and cluster already open: `setActiveKubeconfig(fav.clusterSelection)`
3. If generic: use the currently active cluster
4. Set view type and active view tab (`setViewType`, `setActiveClusterView` or `setActiveNamespaceTab`)
5. For namespace views: `setSelectedNamespace(fav.namespace)` — for generic favorites, if the namespace doesn't exist in the active cluster, the favorite item is disabled in the dropdown
6. Apply filters via controlled filter state on the grid table
7. Apply table state (sort + column visibility) via grid table persistence layer

For steps 6-7: `FavoritesContext` exposes `activeFavoriteState` that grid tables read to override their initial filter/table state when a favorite is activated. Cleared after first render.

### Rename

- Double-click name in dropdown to rename inline (Enter to save, Escape to cancel)
- Also discoverable via hover pencil icon

### Reorder

- Drag to reorder in the dropdown
- Also via up/down arrow hover icons
- Order persisted via `SetFavoriteOrder`

## Visual Design

### Icons

- **Generic favorite**: Dashed circle icon (applies to any cluster)
- **Cluster-specific favorite**: Pin icon (pinned to a cluster)
- **Favorite toggle in filter bar**: Outline heart (not favorited) / Filled heart (favorited)
- **Favorites menu button in header**: Outline heart

### Filter Bar IconBar

The `GridTableFiltersBar` now renders an `IconBar` with:
- Built-in Reset action (always present)
- `preActions` slot (rendered after Reset — used for the Favorite heart toggle)
- Separator
- `postActions` slot (rendered after separator — used for view-specific actions like Load More)

This replaces the old standalone Reset button.

## Already Implemented

The following changes are already in the codebase on the `favorites` branch:

- `GridTableFiltersBar` refactored to use `IconBar` with `preActions`/`postActions` slots (old Reset button removed)
- `ResetFiltersIcon`, `LoadMoreIcon`, `FavoriteOutlineIcon`, `FavoriteFilledIcon` added to `MenuIcons.tsx`
- `BrowseView` updated to pass Favorite toggle and Load More as IconBar items
- `AppHeader` supports `extraControls` prop for the favorites menu button
- Storybook stories for AppHeader (favorites dropdown), BrowseView (filter bar with heart), CommandPalette (favorites group)
- Storybook provider infrastructure (`SidebarProvidersDecorator`, preview.ts Go stubs, EventsOn disposer fix)
- Pre-existing Load More bug fixed (orchestrator streaming-health bypass for manual fetches, scope key mismatch for paginated catalog fetches)

## Not In Scope

- Favorites in the sidebar (explored and rejected — not enough space)
- Sharing/exporting favorites
- Favorite folders or categories
