# Favorites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users save views (with filters and table state) as favorites for one-click navigation, accessible from a header dropdown menu and the command palette.

**Architecture:** Backend CRUD in Go persistence layer (`persistence.json`), frontend persistence module + React context mirroring the cluster tab order pattern, favorites dropdown component in the header, heart toggle in the GridTableFiltersBar IconBar, and command palette integration.

**Tech Stack:** Go (backend persistence), React/TypeScript (frontend), Wails v2 bindings, existing IconBar/Dropdown components.

**Spec:** `docs/superpowers/specs/2026-04-02-favorites-design.md`

---

## File Map

### Backend (Go)
| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `backend/app_persistence.go` | Add `Favorite` struct, `persistenceFavorites` field, CRUD methods |
| Modify | `backend/app_persistence_test.go` | Tests for favorites CRUD |

### Frontend — Persistence Layer
| Action | File | Responsibility |
|--------|------|---------------|
| Create | `frontend/src/core/persistence/favorites.ts` | Hydrate, cache, persist favorites via Wails RPCs |
| Create | `frontend/src/core/persistence/favorites.test.ts` | Tests for persistence module |

### Frontend — Context
| Action | File | Responsibility |
|--------|------|---------------|
| Create | `frontend/src/core/contexts/FavoritesContext.tsx` | React context: provides favorites list, mutations, currentFavoriteMatch |
| Create | `frontend/src/core/contexts/FavoritesContext.test.tsx` | Tests for context |

### Frontend — Favorites Dropdown (Header)
| Action | File | Responsibility |
|--------|------|---------------|
| Create | `frontend/src/ui/favorites/FavMenuDropdown.tsx` | Dropdown panel with favorite items, hover actions, inline rename, reorder |
| Create | `frontend/src/ui/favorites/FavMenuDropdown.css` | Styles for the dropdown |
| Create | `frontend/src/ui/favorites/FavMenuDropdown.test.tsx` | Tests for dropdown |
| Modify | `frontend/src/ui/layout/AppHeader.tsx` | Add FavMenuDropdown button to controls |

### Frontend — Heart Toggle (Filter Bar)
| Action | File | Responsibility |
|--------|------|---------------|
| Create | `frontend/src/ui/favorites/FavToggle.tsx` | Heart toggle component that reads FavoritesContext, returns IconBarItem |
| Create | `frontend/src/ui/favorites/FavToggle.test.tsx` | Tests for toggle |
| Modify | All view components that build `gridFilters` | Add FavToggle to `preActions` |

### Frontend — Command Palette
| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `frontend/src/ui/command-palette/CommandPalette.tsx` | Add 'Favorites' to CATEGORY_ORDER |
| Modify | `frontend/src/ui/command-palette/CommandPaletteCommands.tsx` | Generate Favorites commands from context |

### Frontend — Provider Wiring
| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `frontend/src/App.tsx` | Add FavoritesContext provider to the tree |

---

## Task 1: Backend Favorites CRUD

**Files:**
- Modify: `backend/app_persistence.go`
- Modify: `backend/app_persistence_test.go`

- [ ] **Step 1: Write failing tests for favorites round-trip**

Add to `backend/app_persistence_test.go`:

```go
func TestAppFavoritesRoundTrip(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	// Initially empty.
	favs, err := app.GetFavorites()
	require.NoError(t, err)
	require.Empty(t, favs)

	// Add a favorite.
	fav := Favorite{
		Name:             "prod / default / Pods",
		ClusterSelection: "/path/config:prod",
		ViewType:         "namespace",
		View:             "pods",
		Namespace:        "default",
		Filters:          &FavoriteFilters{Search: "nginx", Kinds: []string{"Pod"}},
		TableState:       &FavoriteTableState{SortColumn: "name", SortDirection: "asc"},
	}
	added, err := app.AddFavorite(fav)
	require.NoError(t, err)
	require.NotEmpty(t, added.ID)
	require.Equal(t, "prod / default / Pods", added.Name)
	require.Equal(t, 0, added.Order)

	// Get should return it.
	favs, err = app.GetFavorites()
	require.NoError(t, err)
	require.Len(t, favs, 1)
	require.Equal(t, added.ID, favs[0].ID)

	// Update the name.
	added.Name = "Renamed"
	require.NoError(t, app.UpdateFavorite(added))
	favs, err = app.GetFavorites()
	require.NoError(t, err)
	require.Equal(t, "Renamed", favs[0].Name)

	// Delete.
	require.NoError(t, app.DeleteFavorite(added.ID))
	favs, err = app.GetFavorites()
	require.NoError(t, err)
	require.Empty(t, favs)
}

func TestAppFavoritesOrdering(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	a, _ := app.AddFavorite(Favorite{Name: "A", ViewType: "cluster", View: "nodes"})
	b, _ := app.AddFavorite(Favorite{Name: "B", ViewType: "cluster", View: "rbac"})
	c, _ := app.AddFavorite(Favorite{Name: "C", ViewType: "namespace", View: "pods", Namespace: "default"})

	// Reorder: C, A, B
	require.NoError(t, app.SetFavoriteOrder([]string{c.ID, a.ID, b.ID}))

	favs, _ := app.GetFavorites()
	require.Equal(t, "C", favs[0].Name)
	require.Equal(t, 0, favs[0].Order)
	require.Equal(t, "A", favs[1].Name)
	require.Equal(t, 1, favs[1].Order)
	require.Equal(t, "B", favs[2].Name)
	require.Equal(t, 2, favs[2].Order)
}

func TestAppDeleteFavoriteNotFound(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	err := app.DeleteFavorite("nonexistent")
	require.Error(t, err)
}

func TestAppUpdateFavoriteNotFound(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	err := app.UpdateFavorite(Favorite{ID: "nonexistent", Name: "X"})
	require.Error(t, err)
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && go test -run TestAppFavorites -v`
Expected: Compilation errors — `Favorite` type and methods don't exist yet.

- [ ] **Step 3: Add Favorite types and persistence struct field**

Add to `backend/app_persistence.go`:

```go
// Favorite represents a saved view bookmark.
type Favorite struct {
	ID               string              `json:"id"`
	Name             string              `json:"name"`
	ClusterSelection string              `json:"clusterSelection"`
	ViewType         string              `json:"viewType"`
	View             string              `json:"view"`
	Namespace        string              `json:"namespace"`
	Filters          *FavoriteFilters    `json:"filters"`
	TableState       *FavoriteTableState `json:"tableState"`
	Order            int                 `json:"order"`
}

// FavoriteFilters captures the active filter state when a favorite was saved.
type FavoriteFilters struct {
	Search     string   `json:"search"`
	Kinds      []string `json:"kinds"`
	Namespaces []string `json:"namespaces"`
}

// FavoriteTableState captures sort and column visibility when a favorite was saved.
type FavoriteTableState struct {
	SortColumn       string          `json:"sortColumn"`
	SortDirection    string          `json:"sortDirection"`
	ColumnVisibility map[string]bool `json:"columnVisibility"`
}
```

Add `Favorites` field to `persistenceFile`:

```go
type persistenceFile struct {
	SchemaVersion int                    `json:"schemaVersion"`
	UpdatedAt     time.Time              `json:"updatedAt"`
	ClusterTabs   persistenceClusterTabs `json:"clusterTabs"`
	Tables        persistenceTables      `json:"tables"`
	Favorites     []Favorite             `json:"favorites"`
}
```

- [ ] **Step 4: Implement CRUD methods**

Add to `backend/app_persistence.go`:

```go
import "github.com/google/uuid"

// GetFavorites returns all saved favorites sorted by Order.
func (a *App) GetFavorites() ([]Favorite, error) {
	a.persistenceMu.Lock()
	defer a.persistenceMu.Unlock()

	state, err := a.loadPersistenceFile()
	if err != nil {
		return nil, err
	}
	result := make([]Favorite, len(state.Favorites))
	copy(result, state.Favorites)
	return result, nil
}

// AddFavorite appends a new favorite with a generated ID and persists.
func (a *App) AddFavorite(fav Favorite) (Favorite, error) {
	fav.ID = uuid.New().String()
	fav.Name = strings.TrimSpace(fav.Name)

	a.persistenceMu.Lock()
	defer a.persistenceMu.Unlock()

	state, err := a.loadPersistenceFile()
	if err != nil {
		return Favorite{}, err
	}
	fav.Order = len(state.Favorites)
	state.Favorites = append(state.Favorites, fav)
	if err := a.savePersistenceFile(state); err != nil {
		return Favorite{}, err
	}
	return fav, nil
}

// UpdateFavorite replaces the favorite with a matching ID.
func (a *App) UpdateFavorite(fav Favorite) error {
	fav.Name = strings.TrimSpace(fav.Name)

	a.persistenceMu.Lock()
	defer a.persistenceMu.Unlock()

	state, err := a.loadPersistenceFile()
	if err != nil {
		return err
	}
	for i, existing := range state.Favorites {
		if existing.ID == fav.ID {
			fav.Order = existing.Order
			state.Favorites[i] = fav
			return a.savePersistenceFile(state)
		}
	}
	return fmt.Errorf("favorite not found: %s", fav.ID)
}

// DeleteFavorite removes the favorite with the given ID and re-indexes Order.
func (a *App) DeleteFavorite(id string) error {
	a.persistenceMu.Lock()
	defer a.persistenceMu.Unlock()

	state, err := a.loadPersistenceFile()
	if err != nil {
		return err
	}
	found := false
	filtered := make([]Favorite, 0, len(state.Favorites))
	for _, f := range state.Favorites {
		if f.ID == id {
			found = true
			continue
		}
		f.Order = len(filtered)
		filtered = append(filtered, f)
	}
	if !found {
		return fmt.Errorf("favorite not found: %s", id)
	}
	state.Favorites = filtered
	return a.savePersistenceFile(state)
}

// SetFavoriteOrder reorders favorites by the given ID list.
func (a *App) SetFavoriteOrder(ids []string) error {
	a.persistenceMu.Lock()
	defer a.persistenceMu.Unlock()

	state, err := a.loadPersistenceFile()
	if err != nil {
		return err
	}
	byID := make(map[string]*Favorite, len(state.Favorites))
	for i := range state.Favorites {
		byID[state.Favorites[i].ID] = &state.Favorites[i]
	}
	reordered := make([]Favorite, 0, len(state.Favorites))
	seen := make(map[string]bool)
	for i, id := range ids {
		if f, ok := byID[id]; ok && !seen[id] {
			f.Order = i
			reordered = append(reordered, *f)
			seen[id] = true
		}
	}
	// Append any favorites not in the provided list.
	for _, f := range state.Favorites {
		if !seen[f.ID] {
			f.Order = len(reordered)
			reordered = append(reordered, f)
		}
	}
	state.Favorites = reordered
	return a.savePersistenceFile(state)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && go test -run TestAppFavorites -v`
Expected: All 4 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app_persistence.go backend/app_persistence_test.go
git commit -m "feat: add favorites CRUD to persistence layer"
```

---

## Task 2: Frontend Persistence Module

**Files:**
- Create: `frontend/src/core/persistence/favorites.ts`
- Create: `frontend/src/core/persistence/favorites.test.ts`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/core/persistence/favorites.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  hydrateFavorites,
  getFavorites,
  addFavorite,
  updateFavorite,
  deleteFavorite,
  setFavoriteOrder,
  subscribeFavorites,
  resetFavoritesCacheForTesting,
} from './favorites';
import type { Favorite } from './favorites';

const mockFav: Favorite = {
  id: '1',
  name: 'Test',
  clusterSelection: '',
  viewType: 'cluster',
  view: 'nodes',
  namespace: '',
  filters: null,
  tableState: null,
  order: 0,
};

// Stub window.go.backend.App via __storybookGoOverrides pattern.
const goOverrides: Record<string, (...args: unknown[]) => unknown> = {};
(globalThis as any).window = {
  go: {
    backend: {
      App: new Proxy({}, {
        get(_target, method: string) {
          return goOverrides[method] ?? (() => Promise.resolve());
        },
      }),
    },
  },
};

describe('favorites persistence', () => {
  beforeEach(() => {
    resetFavoritesCacheForTesting();
    Object.keys(goOverrides).forEach((k) => delete goOverrides[k]);
  });

  it('hydrates from backend', async () => {
    goOverrides['GetFavorites'] = () => Promise.resolve([mockFav]);
    await hydrateFavorites();
    expect(getFavorites()).toEqual([mockFav]);
  });

  it('returns cached list without re-fetching', async () => {
    goOverrides['GetFavorites'] = vi.fn(() => Promise.resolve([mockFav]));
    await hydrateFavorites();
    await hydrateFavorites();
    expect(goOverrides['GetFavorites']).toHaveBeenCalledTimes(1);
  });

  it('addFavorite calls backend and updates cache', async () => {
    goOverrides['GetFavorites'] = () => Promise.resolve([]);
    goOverrides['AddFavorite'] = (fav: unknown) =>
      Promise.resolve({ ...(fav as Favorite), id: 'new-id' });
    await hydrateFavorites();

    const result = await addFavorite({ ...mockFav, id: '' });
    expect(result.id).toBe('new-id');
    expect(getFavorites()).toHaveLength(1);
  });

  it('deleteFavorite removes from cache', async () => {
    goOverrides['GetFavorites'] = () => Promise.resolve([mockFav]);
    goOverrides['DeleteFavorite'] = () => Promise.resolve();
    await hydrateFavorites();

    await deleteFavorite('1');
    expect(getFavorites()).toHaveLength(0);
  });

  it('emits event on change', async () => {
    goOverrides['GetFavorites'] = () => Promise.resolve([]);
    goOverrides['AddFavorite'] = (fav: unknown) =>
      Promise.resolve({ ...(fav as Favorite), id: 'x' });
    await hydrateFavorites();

    const handler = vi.fn();
    subscribeFavorites(handler);
    await addFavorite(mockFav);
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/core/persistence/favorites.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement favorites persistence module**

Create `frontend/src/core/persistence/favorites.ts`:

```typescript
/**
 * frontend/src/core/persistence/favorites.ts
 *
 * Persistence helpers for favorites backed by the backend store.
 * Follows the same pattern as clusterTabOrder.ts.
 */

import { eventBus } from '@/core/events';

export interface FavoriteFilters {
  search: string;
  kinds: string[];
  namespaces: string[];
}

export interface FavoriteTableState {
  sortColumn: string;
  sortDirection: string;
  columnVisibility: Record<string, boolean>;
}

export interface Favorite {
  id: string;
  name: string;
  clusterSelection: string;
  viewType: string;
  view: string;
  namespace: string;
  filters: FavoriteFilters | null;
  tableState: FavoriteTableState | null;
  order: number;
}

let cachedFavorites: Favorite[] = [];
let hydrated = false;
let hydrationPromise: Promise<void> | null = null;

const getRuntimeApp = () => {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return (window as any)?.go?.backend?.App;
};

const updateCache = (favorites: Favorite[]) => {
  cachedFavorites = favorites;
  eventBus.emit('favorites:changed', cachedFavorites);
};

export const hydrateFavorites = async (options?: { force?: boolean }): Promise<Favorite[]> => {
  if (hydrated && !options?.force) {
    return cachedFavorites;
  }
  if (hydrationPromise && !options?.force) {
    await hydrationPromise;
    return cachedFavorites;
  }

  hydrationPromise = (async () => {
    const runtimeApp = getRuntimeApp();
    if (!runtimeApp || typeof runtimeApp.GetFavorites !== 'function') {
      hydrated = true;
      return;
    }
    try {
      const favs = await runtimeApp.GetFavorites();
      updateCache(Array.isArray(favs) ? favs : []);
    } catch (error) {
      console.error('Failed to hydrate favorites:', error);
    } finally {
      hydrated = true;
    }
  })();

  try {
    await hydrationPromise;
  } finally {
    hydrationPromise = null;
  }
  return cachedFavorites;
};

export const getFavorites = (): Favorite[] => cachedFavorites;

export const addFavorite = async (fav: Favorite): Promise<Favorite> => {
  const runtimeApp = getRuntimeApp();
  const added = await runtimeApp.AddFavorite(fav);
  updateCache([...cachedFavorites, added]);
  return added;
};

export const updateFavorite = async (fav: Favorite): Promise<void> => {
  const runtimeApp = getRuntimeApp();
  await runtimeApp.UpdateFavorite(fav);
  updateCache(cachedFavorites.map((f) => (f.id === fav.id ? { ...fav, order: f.order } : f)));
};

export const deleteFavorite = async (id: string): Promise<void> => {
  const runtimeApp = getRuntimeApp();
  await runtimeApp.DeleteFavorite(id);
  updateCache(cachedFavorites.filter((f) => f.id !== id));
};

export const setFavoriteOrder = async (ids: string[]): Promise<void> => {
  const runtimeApp = getRuntimeApp();
  await runtimeApp.SetFavoriteOrder(ids);
  const byId = new Map(cachedFavorites.map((f) => [f.id, f]));
  const reordered: Favorite[] = [];
  ids.forEach((id, i) => {
    const f = byId.get(id);
    if (f) {
      reordered.push({ ...f, order: i });
    }
  });
  // Append any not in the list.
  cachedFavorites.forEach((f) => {
    if (!ids.includes(f.id)) {
      reordered.push({ ...f, order: reordered.length });
    }
  });
  updateCache(reordered);
};

export const subscribeFavorites = (handler: (favs: Favorite[]) => void): (() => void) => {
  return eventBus.on('favorites:changed', handler);
};

export const resetFavoritesCacheForTesting = (): void => {
  cachedFavorites = [];
  hydrated = false;
  hydrationPromise = null;
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run src/core/persistence/favorites.test.ts`
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/core/persistence/favorites.ts frontend/src/core/persistence/favorites.test.ts
git commit -m "feat: add favorites frontend persistence module"
```

---

## Task 3: FavoritesContext

**Files:**
- Create: `frontend/src/core/contexts/FavoritesContext.tsx`
- Create: `frontend/src/core/contexts/FavoritesContext.test.tsx`
- Modify: `frontend/src/App.tsx`

- [ ] **Step 1: Write failing tests**

Create `frontend/src/core/contexts/FavoritesContext.test.tsx` with tests for:
- `useFavorites()` returns the favorites list from the persistence module
- `currentFavoriteMatch` returns null when no favorite matches
- `currentFavoriteMatch` returns the matching favorite when navigation state matches (cluster + viewType + view + namespace)
- `currentFavoriteMatch` handles generic favorites (empty clusterSelection matches any cluster)

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement FavoritesContext**

Create `frontend/src/core/contexts/FavoritesContext.tsx`:
- Provider hydrates favorites on mount via `hydrateFavorites()`
- Subscribes to `favorites:changed` events to keep state in sync
- Computes `currentFavoriteMatch` by comparing `selectedKubeconfig`, `viewType`, active view, and `selectedNamespace` from existing contexts against the favorites list
- For generic favorites (empty `clusterSelection`), match against viewType + view + namespace only
- Exposes `favorites`, `addFavorite`, `updateFavorite`, `deleteFavorite`, `reorderFavorites`, `currentFavoriteMatch`

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Wire into App.tsx provider tree**

Add `FavoritesProvider` inside `KubernetesProvider` (it needs `useKubeconfig` and `useViewState`):

In `frontend/src/App.tsx`, import `FavoritesProvider` and wrap it around `DockablePanelProvider`:

```tsx
<KubernetesProvider>
  <FavoritesProvider>
    <DockablePanelProvider>
      ...
    </DockablePanelProvider>
  </FavoritesProvider>
</KubernetesProvider>
```

- [ ] **Step 6: Commit**

```bash
git add frontend/src/core/contexts/FavoritesContext.tsx frontend/src/core/contexts/FavoritesContext.test.tsx frontend/src/App.tsx
git commit -m "feat: add FavoritesContext with matching logic"
```

---

## Task 4: Favorites Dropdown (Header)

**Files:**
- Create: `frontend/src/ui/favorites/FavMenuDropdown.tsx`
- Create: `frontend/src/ui/favorites/FavMenuDropdown.css`
- Create: `frontend/src/ui/favorites/FavMenuDropdown.test.tsx`
- Modify: `frontend/src/ui/layout/AppHeader.tsx`

- [ ] **Step 1: Write failing tests**

Tests for:
- Renders the heart button
- Shows dropdown with favorites on click
- Shows empty state when no favorites
- Hover actions (rename, delete, up, down) appear on mouse enter
- Inline rename on double-click: shows input, Enter saves, Escape cancels
- Clicking a favorite calls the navigation handler
- Disabled state for favorites with missing namespace

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement FavMenuDropdown**

Build the dropdown using the prototype in `FavoritesPrototypes.tsx` as reference, but as a real component that reads from `useFavorites()` context. Key behaviors:
- Heart button icon from `FavoriteOutlineIcon` in MenuIcons
- Dropdown panel: dynamic width (max-content, min 200px, max 400px)
- Each row: type icon (dashed circle or pin), name, hover actions overlay
- Hover actions: up, down, rename (pencil), delete (trash) — positioned absolute with gradient fade
- Inline rename: double-click toggles input, Enter saves via `updateFavorite`, Escape reverts
- Up/down arrows call `reorderFavorites` from context
- Click navigates: switch/open cluster tab, set view, set namespace, apply filters
- Disabled items: generic favorites where namespace doesn't exist in active cluster
- Footer with icon legend (dashed circle = any cluster, pin = pinned)

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Add to AppHeader**

In `frontend/src/ui/layout/AppHeader.tsx`, replace the `extraControls` prop usage with the real `FavMenuDropdown` component, placed between `KubeconfigSelector` and the settings button:

```tsx
<KubeconfigSelector />
<FavMenuDropdown />
<button className="settings-button" ...>
```

Remove the `extraControls` prop — it was only for prototyping.

- [ ] **Step 6: Run tests and verify in Storybook**

- [ ] **Step 7: Commit**

```bash
git add frontend/src/ui/favorites/ frontend/src/ui/layout/AppHeader.tsx
git commit -m "feat: add favorites dropdown menu in app header"
```

---

## Task 5: Heart Toggle in Filter Bar

**Files:**
- Create: `frontend/src/ui/favorites/FavToggle.tsx`
- Create: `frontend/src/ui/favorites/FavToggle.test.tsx`
- Modify: View components that build `gridFilters` (BrowseView, all NsView*, all ClusterView*)

- [ ] **Step 1: Write failing tests**

Tests for:
- Returns an `IconBarItem` with outline heart when `currentFavoriteMatch` is null
- Returns an `IconBarItem` with filled heart when `currentFavoriteMatch` is non-null
- Clicking when not favorited shows choice popover ("Save for any cluster" / "Save for this cluster")
- Clicking when favorited shows Update/Remove popover
- "Save for any cluster" calls `addFavorite` with empty `clusterSelection`
- "Save for this cluster" calls `addFavorite` with current `selectedKubeconfig`
- "Update" calls `updateFavorite` with current filters and table state
- "Remove" calls `deleteFavorite`

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement FavToggle**

Create `frontend/src/ui/favorites/FavToggle.tsx`:
- Hook `useFavToggle()` that returns an `IconBarItem` for the heart toggle
- Reads `currentFavoriteMatch` from `useFavorites()`
- Reads current view state from `useViewState()`, `useKubeconfig()`, `useNamespace()`
- On click (not favorited): show small popover with two choices
- On click (favorited): show small popover with Update/Remove
- Auto-generates name from current context name, namespace, and view label
- Captures current filter state and table state (sort + column visibility) from the grid table persistence

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Wire into view components**

Replace the static heart `IconBarItem` in `BrowseView.tsx` `preActions` with `useFavToggle()`. Then add the same to every other view component that builds `gridFilters.options.preActions`:

Views to update (search for `gridFilters` or `filters={{` in each):
- `frontend/src/modules/browse/components/BrowseView.tsx`
- `frontend/src/modules/namespace/components/NsViewWorkloads.tsx`
- `frontend/src/modules/namespace/components/NsViewPods.tsx`
- `frontend/src/modules/namespace/components/NsViewConfig.tsx`
- `frontend/src/modules/namespace/components/NsViewNetwork.tsx`
- `frontend/src/modules/namespace/components/NsViewRBAC.tsx`
- `frontend/src/modules/namespace/components/NsViewStorage.tsx`
- `frontend/src/modules/namespace/components/NsViewAutoscaling.tsx`
- `frontend/src/modules/namespace/components/NsViewQuotas.tsx`
- `frontend/src/modules/namespace/components/NsViewCustom.tsx`
- `frontend/src/modules/namespace/components/NsViewHelm.tsx`
- `frontend/src/modules/namespace/components/NsViewEvents.tsx`
- `frontend/src/modules/cluster/components/ClusterViewNodes.tsx`
- `frontend/src/modules/cluster/components/ClusterViewConfig.tsx`
- `frontend/src/modules/cluster/components/ClusterViewRBAC.tsx`
- `frontend/src/modules/cluster/components/ClusterViewStorage.tsx`
- `frontend/src/modules/cluster/components/ClusterViewCRDs.tsx`
- `frontend/src/modules/cluster/components/ClusterViewCustom.tsx`
- `frontend/src/modules/cluster/components/ClusterViewEvents.tsx`

Each view adds `useFavToggle()` and includes its item in `preActions`.

- [ ] **Step 6: Run tests and verify in app**

- [ ] **Step 7: Commit**

```bash
git add frontend/src/ui/favorites/FavToggle.tsx frontend/src/ui/favorites/FavToggle.test.tsx frontend/src/modules/
git commit -m "feat: add heart toggle to all grid table views"
```

---

## Task 6: Command Palette Integration

**Files:**
- Modify: `frontend/src/ui/command-palette/CommandPalette.tsx`
- Modify: `frontend/src/ui/command-palette/CommandPaletteCommands.tsx`

- [ ] **Step 1: Add 'Favorites' to CATEGORY_ORDER**

In `frontend/src/ui/command-palette/CommandPalette.tsx`, insert `'Favorites'` between `'Navigation'` and `'Namespaces'`:

```typescript
const CATEGORY_ORDER = [
  'Application',
  'Settings',
  'Navigation',
  'Favorites',
  'Namespaces',
  'Kubeconfigs',
  'General',
];
```

- [ ] **Step 2: Generate favorite commands**

In `frontend/src/ui/command-palette/CommandPaletteCommands.tsx`, import `useFavorites` and generate a `Command` for each favorite:

```typescript
import { useFavorites } from '@core/contexts/FavoritesContext';

// Inside useCommandPaletteCommands():
const { favorites } = useFavorites();

const favoriteCommands: Command[] = favorites.map((fav) => ({
  id: `fav-${fav.id}`,
  label: fav.name,
  icon: fav.clusterSelection ? '📌' : '⭕',
  category: 'Favorites',
  action: () => {
    // Navigate to favorite — same logic as FavMenuDropdown click handler.
    // Extract into a shared navigateToFavorite() utility.
  },
  keywords: ['favorite', 'bookmark', fav.view, fav.namespace].filter(Boolean),
}));
```

Add `favoriteCommands` to the returned commands array.

- [ ] **Step 3: Extract shared navigation utility**

Create a shared `navigateToFavorite(fav, contexts)` function in `frontend/src/ui/favorites/navigateToFavorite.ts` that both `FavMenuDropdown` and `CommandPaletteCommands` call. This avoids duplicating navigation logic.

- [ ] **Step 4: Run command palette tests**

Run: `cd frontend && npx vitest run src/ui/command-palette/`
Expected: PASS (existing tests still pass, favorites appear in palette).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/ui/command-palette/ frontend/src/ui/favorites/navigateToFavorite.ts
git commit -m "feat: add favorites to command palette"
```

---

## Task 7: Storybook Cleanup

**Files:**
- Modify: `frontend/src/ui/layout/AppHeader.stories.tsx`
- Modify: `frontend/src/modules/browse/components/BrowseView.stories.tsx`
- Delete: `frontend/src/ui/layout/FavoritesPrototypes.tsx`
- Delete: `frontend/src/ui/layout/SidebarFavoritesPrototype.tsx`
- Modify: `frontend/src/ui/layout/Sidebar.tsx` — remove `favoritesSlot` prop

- [ ] **Step 1: Update AppHeader stories to use real FavMenuDropdown**

Replace the prototype `FavMenuDropdown` import with the real component. Use `SidebarProvidersDecorator` (which now includes `FavoritesProvider`).

- [ ] **Step 2: Update BrowseView stories to use real FavToggle**

The filter bar now gets the heart toggle from the real `BrowseView` code path. Remove the manual `preActions` in the story.

- [ ] **Step 3: Delete prototype files**

Remove `FavoritesPrototypes.tsx`, `SidebarFavoritesPrototype.tsx`, and the `favoritesSlot` prop from `Sidebar.tsx`.

- [ ] **Step 4: Delete CommandPalette stories prototype**

Remove `frontend/src/ui/command-palette/CommandPalette.stories.tsx` (the prototype) or update it to use real components.

- [ ] **Step 5: Verify all stories render**

Run Storybook, click through every story, confirm no errors.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: clean up favorites prototypes, update storybook stories"
```

---

## Task 8: Update Storybook Provider Decorator

**Files:**
- Modify: `frontend/.storybook/decorators/SidebarProvidersDecorator.tsx`
- Modify: `frontend/.storybook/preview.ts`

- [ ] **Step 1: Add FavoritesProvider to SidebarProvidersDecorator**

Wrap inside `KubernetesProvider`, same position as in `App.tsx`.

- [ ] **Step 2: Add GetFavorites stub to preview.ts overrides**

```typescript
GetFavorites: () => Promise.resolve([]),
AddFavorite: (fav: unknown) => Promise.resolve({ ...(fav as any), id: crypto.randomUUID() }),
UpdateFavorite: () => Promise.resolve(),
DeleteFavorite: () => Promise.resolve(),
SetFavoriteOrder: () => Promise.resolve(),
```

- [ ] **Step 3: Verify stories render**

- [ ] **Step 4: Commit**

```bash
git add frontend/.storybook/
git commit -m "chore: add favorites stubs to storybook provider decorator"
```

---

## Task 9: End-to-End Verification

- [ ] **Step 1: Run full backend test suite**

Run: `cd backend && go test ./... -v`
Expected: All tests PASS.

- [ ] **Step 2: Run full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: All tests PASS.

- [ ] **Step 3: Run prerelease QC**

Run: `mage qc:prerelease`
Expected: PASS.

- [ ] **Step 4: Manual smoke test**

In the running app:
1. Open a cluster, navigate to Pods view
2. Click the heart icon in the filter bar → choose "Save for any cluster" → verify dropdown shows it
3. Click the heart icon again → choose "Save for this cluster" → verify dropdown shows both
4. Apply a search filter, click the filled heart → Update → verify filter is saved
5. Open the favorites dropdown → hover an item → verify rename/delete/up/down icons appear
6. Double-click to rename → type new name → press Enter → verify name updates
7. Click a favorite → verify navigation works
8. Open command palette (Cmd+Shift+P) → type "favorite" → verify favorites appear
9. Close the cluster tab → reopen → verify favorites persisted
10. Open a different cluster → verify generic favorite navigates to the view in the new cluster
