# Themes System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add named, saveable themes with cluster pattern matching that auto-apply when switching clusters.

**Architecture:** Themes are stored as an ordered array in the existing `settings.json` preferences. The backend provides CRUD + pattern matching APIs. The frontend adds a theme table to Settings with drag-to-reorder, inline editing, and auto-matching on cluster switch.

**Tech Stack:** Go (backend, `filepath.Match` for globs, `github.com/google/uuid`), React/TypeScript (frontend), native HTML5 drag-and-drop, Vitest + Go `testing`/`testify`.

**Design doc:** `docs/plans/2026-02-12-themes-design.md`

---

### Task 1: Add Theme Type to Backend

**Files:**
- Modify: `backend/resources/types/types.go` (after ThemeInfo struct, ~line 53)
- Modify: `backend/app_settings.go` (settingsPreferences struct, ~line 32)

**Step 1: Add Theme struct to types.go**

Add after the `ThemeInfo` struct (~line 53):

```go
// Theme represents a saved color theme with optional cluster pattern matching.
// Themes are ordered; when matching clusters, the first match wins.
type Theme struct {
	ID             string `json:"id"`             // UUID
	Name           string `json:"name"`           // Display name, e.g. "Danger Red"
	ClusterPattern string `json:"clusterPattern"` // Glob pattern matched against context name, e.g. "prod*"; empty = no auto-match

	PaletteHueLight        int    `json:"paletteHueLight"`        // 0-360
	PaletteSaturationLight int    `json:"paletteSaturationLight"` // 0-100
	PaletteBrightnessLight int    `json:"paletteBrightnessLight"` // -50 to +50
	PaletteHueDark         int    `json:"paletteHueDark"`         // 0-360
	PaletteSaturationDark  int    `json:"paletteSaturationDark"`  // 0-100
	PaletteBrightnessDark  int    `json:"paletteBrightnessDark"`  // -50 to +50

	AccentColorLight string `json:"accentColorLight,omitempty"` // Hex "#rrggbb" or empty for default
	AccentColorDark  string `json:"accentColorDark,omitempty"`  // Hex "#rrggbb" or empty for default
}
```

**Step 2: Add Themes field to settingsPreferences**

In `backend/app_settings.go`, add to the `settingsPreferences` struct (after `AccentColorDark`, ~line 51):

```go
	// Saved theme library. Order matters: first match wins for cluster pattern matching.
	Themes []types.Theme `json:"themes,omitempty"`
```

**Step 3: Add Themes field to AppSettings**

In `backend/resources/types/types.go`, add to the `AppSettings` struct (after `AccentColorDark`, ~line 46):

```go
	Themes []Theme `json:"themes"` // Saved theme library
```

**Step 4: Wire Themes into GetAppSettings**

In `backend/app_settings.go`, in the `GetAppSettings()` method (~line 387), add `Themes` to the returned `AppSettings` struct. Find where the struct literal is built and add:

```go
		Themes:                           settings.Preferences.Themes,
```

**Step 5: Verify it compiles**

Run: `cd /Volumes/git/luxury-yacht/app && go build ./...`
Expected: Clean build, no errors.

**Step 6: Commit**

```
feat: add Theme type and settings persistence field
```

---

### Task 2: Backend CRUD Methods

**Files:**
- Modify: `backend/app_settings.go` (add methods after SetAccentColor, ~line 623)
- Create: `backend/app_settings_themes_test.go`

**Step 1: Write failing tests**

Create `backend/app_settings_themes_test.go`. Use the existing test patterns (standard `testing` + `testify`). Test:

- `TestGetThemes_Empty` — returns empty slice when no themes saved
- `TestSaveTheme_Create` — saving a theme with new ID adds it to the list
- `TestSaveTheme_Update` — saving a theme with existing ID updates it in place
- `TestDeleteTheme` — removes a theme by ID
- `TestDeleteTheme_NotFound` — returns error for unknown ID
- `TestReorderThemes` — reorders themes by ID list
- `TestReorderThemes_InvalidIDs` — returns error if IDs don't match

Note: These tests need to call the methods on an `App` instance. Check how existing tests in the backend set up the `App` struct — look at test helpers or direct struct initialization. The tests will need a temp directory for the settings file. Use `t.TempDir()`.

**Step 2: Run tests to verify they fail**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/ -run TestGetThemes -v && go test ./backend/ -run TestSaveTheme -v && go test ./backend/ -run TestDeleteTheme -v && go test ./backend/ -run TestReorderThemes -v`
Expected: FAIL — methods don't exist yet.

**Step 3: Implement GetThemes**

In `backend/app_settings.go`, add:

```go
// GetThemes returns the saved theme library.
func (a *App) GetThemes() ([]types.Theme, error) {
	settings, err := a.loadSettingsFile()
	if err != nil {
		return nil, fmt.Errorf("loading settings: %w", err)
	}
	if settings.Preferences.Themes == nil {
		return []types.Theme{}, nil
	}
	return settings.Preferences.Themes, nil
}
```

**Step 4: Implement SaveTheme (upsert)**

```go
// SaveTheme creates or updates a theme in the library. If a theme with the
// same ID exists it is updated in place; otherwise the theme is appended.
func (a *App) SaveTheme(theme types.Theme) error {
	if theme.ID == "" {
		return fmt.Errorf("theme ID is required")
	}
	if theme.Name == "" {
		return fmt.Errorf("theme name is required")
	}

	settings, err := a.loadSettingsFile()
	if err != nil {
		return fmt.Errorf("loading settings: %w", err)
	}

	// Upsert: update existing or append new.
	found := false
	for i, t := range settings.Preferences.Themes {
		if t.ID == theme.ID {
			settings.Preferences.Themes[i] = theme
			found = true
			break
		}
	}
	if !found {
		settings.Preferences.Themes = append(settings.Preferences.Themes, theme)
	}

	return a.saveSettingsFile(settings)
}
```

**Step 5: Implement DeleteTheme**

```go
// DeleteTheme removes a theme from the library by ID.
func (a *App) DeleteTheme(id string) error {
	settings, err := a.loadSettingsFile()
	if err != nil {
		return fmt.Errorf("loading settings: %w", err)
	}

	idx := -1
	for i, t := range settings.Preferences.Themes {
		if t.ID == id {
			idx = i
			break
		}
	}
	if idx == -1 {
		return fmt.Errorf("theme not found: %s", id)
	}

	settings.Preferences.Themes = append(
		settings.Preferences.Themes[:idx],
		settings.Preferences.Themes[idx+1:]...,
	)

	return a.saveSettingsFile(settings)
}
```

**Step 6: Implement ReorderThemes**

```go
// ReorderThemes sets the theme ordering. The ids slice must contain exactly the
// same IDs as the current theme list (first-match priority depends on order).
func (a *App) ReorderThemes(ids []string) error {
	settings, err := a.loadSettingsFile()
	if err != nil {
		return fmt.Errorf("loading settings: %w", err)
	}

	if len(ids) != len(settings.Preferences.Themes) {
		return fmt.Errorf("id count mismatch: got %d, have %d themes", len(ids), len(settings.Preferences.Themes))
	}

	// Build lookup map.
	byID := make(map[string]types.Theme, len(settings.Preferences.Themes))
	for _, t := range settings.Preferences.Themes {
		byID[t.ID] = t
	}

	reordered := make([]types.Theme, 0, len(ids))
	for _, id := range ids {
		t, ok := byID[id]
		if !ok {
			return fmt.Errorf("unknown theme ID: %s", id)
		}
		reordered = append(reordered, t)
	}

	settings.Preferences.Themes = reordered
	return a.saveSettingsFile(settings)
}
```

**Step 7: Run tests to verify they pass**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/ -run "TestGetThemes|TestSaveTheme|TestDeleteTheme|TestReorderThemes" -v`
Expected: All PASS.

**Step 8: Commit**

```
feat: add theme CRUD backend methods with tests
```

---

### Task 3: Backend ApplyTheme and MatchThemeForCluster

**Files:**
- Modify: `backend/app_settings.go` (add methods)
- Modify: `backend/app_settings_themes_test.go` (add tests)

**Step 1: Write failing tests**

Add to `backend/app_settings_themes_test.go`:

- `TestApplyTheme` — applying a theme copies its palette values into active settings fields
- `TestApplyTheme_NotFound` — returns error for unknown ID
- `TestMatchThemeForCluster_Match` — returns first matching theme for a context name
- `TestMatchThemeForCluster_NoMatch` — returns nil when no patterns match
- `TestMatchThemeForCluster_FirstMatchWins` — when multiple patterns match, returns the first one in list order
- `TestMatchThemeForCluster_EmptyPattern` — themes with empty pattern are skipped
- `TestMatchThemeForCluster_Wildcards` — tests `*dev*`, `stg-?`, `prod*` patterns

**Step 2: Run tests to verify they fail**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/ -run "TestApplyTheme|TestMatchTheme" -v`
Expected: FAIL.

**Step 3: Implement ApplyTheme**

```go
// ApplyTheme loads a saved theme by ID and copies its palette values into the
// active settings fields, then persists. The frontend re-reads settings to
// pick up the changes.
func (a *App) ApplyTheme(id string) error {
	settings, err := a.loadSettingsFile()
	if err != nil {
		return fmt.Errorf("loading settings: %w", err)
	}

	var theme *types.Theme
	for i, t := range settings.Preferences.Themes {
		if t.ID == id {
			theme = &settings.Preferences.Themes[i]
			break
		}
	}
	if theme == nil {
		return fmt.Errorf("theme not found: %s", id)
	}

	// Copy theme values into active palette fields.
	settings.Preferences.PaletteHueLight = theme.PaletteHueLight
	settings.Preferences.PaletteSaturationLight = theme.PaletteSaturationLight
	settings.Preferences.PaletteBrightnessLight = theme.PaletteBrightnessLight
	settings.Preferences.PaletteHueDark = theme.PaletteHueDark
	settings.Preferences.PaletteSaturationDark = theme.PaletteSaturationDark
	settings.Preferences.PaletteBrightnessDark = theme.PaletteBrightnessDark
	settings.Preferences.AccentColorLight = theme.AccentColorLight
	settings.Preferences.AccentColorDark = theme.AccentColorDark

	return a.saveSettingsFile(settings)
}
```

**Step 4: Implement MatchThemeForCluster**

```go
// MatchThemeForCluster returns the first saved theme whose ClusterPattern
// matches the given context name using filepath.Match glob rules (* and ?).
// Returns nil if no theme matches.
func (a *App) MatchThemeForCluster(contextName string) (*types.Theme, error) {
	settings, err := a.loadSettingsFile()
	if err != nil {
		return nil, fmt.Errorf("loading settings: %w", err)
	}

	for _, t := range settings.Preferences.Themes {
		if t.ClusterPattern == "" {
			continue
		}
		matched, err := filepath.Match(t.ClusterPattern, contextName)
		if err != nil {
			// Invalid pattern — skip rather than fail.
			continue
		}
		if matched {
			result := t // copy
			return &result, nil
		}
	}

	return nil, nil
}
```

Add `"path/filepath"` to imports if not already present.

**Step 5: Run tests to verify they pass**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/ -run "TestApplyTheme|TestMatchTheme" -v`
Expected: All PASS.

**Step 6: Commit**

```
feat: add ApplyTheme and MatchThemeForCluster backend methods
```

---

### Task 4: Frontend — Wails Bindings and appPreferences Integration

**Files:**
- Modify: `frontend/src/core/settings/appPreferences.ts` (add theme functions)

**Step 1: Check that Wails auto-generates bindings**

After the backend changes, run `cd /Volumes/git/luxury-yacht/app && wails generate module` (or however bindings are generated — check the project). The new methods (`GetThemes`, `SaveTheme`, `DeleteTheme`, `ReorderThemes`, `ApplyTheme`, `MatchThemeForCluster`) should appear in `frontend/wailsjs/go/backend/App.js` and `.d.ts`.

If bindings are auto-generated on build, run: `cd /Volumes/git/luxury-yacht/app && wails build` or equivalent dev command.

**Step 2: Add theme helpers to appPreferences.ts**

Add imports for the new Wails bindings at the top of `frontend/src/core/settings/appPreferences.ts` and add wrapper functions:

```typescript
import {
  GetThemes,
  SaveTheme,
  DeleteTheme,
  ReorderThemes,
  ApplyTheme,
  MatchThemeForCluster,
} from '@wailsjs/go/backend/App';

// Theme library helpers — thin wrappers around backend calls.
export async function getThemes() {
  return GetThemes();
}

export async function saveTheme(theme: types.Theme) {
  return SaveTheme(theme);
}

export async function deleteTheme(id: string) {
  return DeleteTheme(id);
}

export async function reorderThemes(ids: string[]) {
  return ReorderThemes(ids);
}

export async function applyTheme(id: string) {
  return ApplyTheme(id);
}

export async function matchThemeForCluster(contextName: string) {
  return MatchThemeForCluster(contextName);
}
```

**Step 3: Verify frontend compiles**

Run the frontend dev build to ensure no TypeScript errors.

**Step 4: Commit**

```
feat: add theme Wails bindings and appPreferences helpers
```

---

### Task 5: Frontend — Editable Palette Values (Inline Number Editing)

**Files:**
- Modify: `frontend/src/components/content/Settings.tsx` (~lines 423-490, the slider value spans)
- Modify: `frontend/src/components/content/Settings.css`

**Step 1: Add inline editing state for palette values**

In `Settings.tsx`, add state alongside existing accent hex editing state (~line 82):

```typescript
// Inline editing state for palette slider values
const [editingPaletteField, setEditingPaletteField] = useState<
  'hue' | 'saturation' | 'brightness' | null
>(null);
const [paletteDraft, setPaletteDraft] = useState('');
const paletteInputRef = useRef<HTMLInputElement>(null);
```

**Step 2: Add handlers for palette value inline editing**

Add handler functions (near the existing accent hex handlers, ~line 267):

```typescript
// Palette value inline editing handlers — same pattern as accent hex editing.
const handlePaletteValueClick = (field: 'hue' | 'saturation' | 'brightness') => {
  const current =
    field === 'hue' ? paletteHue : field === 'saturation' ? paletteSaturation : paletteBrightness;
  setPaletteDraft(String(current));
  setEditingPaletteField(field);
};

const handlePaletteValueCommit = () => {
  if (!editingPaletteField) return;
  const parsed = parseInt(paletteDraft, 10);
  if (isNaN(parsed)) {
    setEditingPaletteField(null);
    return;
  }
  if (editingPaletteField === 'hue') {
    handlePaletteHueChange(Math.max(0, Math.min(360, parsed)));
  } else if (editingPaletteField === 'saturation') {
    handlePaletteSaturationChange(Math.max(0, Math.min(100, parsed)));
  } else if (editingPaletteField === 'brightness') {
    handlePaletteBrightnessChange(Math.max(-50, Math.min(50, parsed)));
  }
  setEditingPaletteField(null);
};

const handlePaletteValueCancel = () => {
  setEditingPaletteField(null);
};
```

**Step 3: Add useEffect to focus the input when editing starts**

```typescript
useEffect(() => {
  if (editingPaletteField && paletteInputRef.current) {
    paletteInputRef.current.focus();
    paletteInputRef.current.select();
  }
}, [editingPaletteField]);
```

**Step 4: Replace static value spans with click-to-edit**

Create a helper to render an editable palette value (to avoid repeating for all 3 fields):

```typescript
const renderEditableValue = (
  field: 'hue' | 'saturation' | 'brightness',
  value: number,
  suffix: string
) => {
  if (editingPaletteField === field) {
    return (
      <input
        ref={paletteInputRef}
        className="palette-slider-value palette-hex-input"
        value={paletteDraft}
        onChange={(e) => setPaletteDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            handlePaletteValueCommit();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            handlePaletteValueCancel();
          } else {
            e.stopPropagation();
          }
        }}
        onBlur={handlePaletteValueCancel}
        maxLength={4}
        spellCheck={false}
      />
    );
  }
  return (
    <span
      className="palette-slider-value palette-hex-clickable"
      onClick={() => handlePaletteValueClick(field)}
      title="Click to edit value"
    >
      {value > 0 && field === 'brightness' ? '+' : ''}
      {value}
      {suffix}
    </span>
  );
};
```

**Step 5: Replace the three value spans in JSX**

Replace the hue value span (`{paletteHue}°`, ~line 433):
```tsx
{renderEditableValue('hue', paletteHue, '\u00B0')}
```

Replace the saturation value span (`{paletteSaturation}%`, ~line 457):
```tsx
{renderEditableValue('saturation', paletteSaturation, '%')}
```

Replace the brightness value span (~lines 478-481):
```tsx
{renderEditableValue('brightness', paletteBrightness, '')}
```

**Step 6: Verify in browser**

Run the app. Click on hue/saturation/brightness values — they should become editable inputs. Enter commits, Escape cancels, slider updates in sync.

**Step 7: Commit**

```
feat: make palette slider values clickable/editable inline
```

---

### Task 6: Frontend — Saved Themes Table UI

**Files:**
- Modify: `frontend/src/components/content/Settings.tsx`
- Modify: `frontend/src/components/content/Settings.css`

This is the largest frontend task. It adds the theme table below the palette controls.

**Step 1: Add theme state to Settings component**

Near the top of the component, add:

```typescript
// Saved themes state
const [themes, setThemes] = useState<types.Theme[]>([]);
const [themesLoading, setThemesLoading] = useState(false);
// Editing state: null = not editing, string = theme ID being edited, 'new' = creating new
const [editingThemeId, setEditingThemeId] = useState<string | null>(null);
const [themeDraft, setThemeDraft] = useState({ name: '', clusterPattern: '' });
// Drag reorder state
const [draggingThemeId, setDraggingThemeId] = useState<string | null>(null);
const [dropTargetThemeId, setDropTargetThemeId] = useState<string | null>(null);
// Delete confirmation
const [deleteConfirmThemeId, setDeleteConfirmThemeId] = useState<string | null>(null);
```

**Step 2: Load themes on mount**

Add to the existing `useEffect` that loads settings, or create a new one:

```typescript
// Load saved themes.
useEffect(() => {
  const loadThemes = async () => {
    setThemesLoading(true);
    try {
      const result = await getThemes();
      setThemes(result || []);
    } catch (error) {
      errorHandler.handle(error, { action: 'loadThemes' });
    } finally {
      setThemesLoading(false);
    }
  };
  loadThemes();
}, []);
```

Import `getThemes`, `saveTheme`, `deleteTheme`, `reorderThemes` from `appPreferences`.

**Step 3: Add theme action handlers**

```typescript
// Save current palette as a new theme.
const handleSaveCurrentAsTheme = () => {
  setEditingThemeId('new');
  setThemeDraft({ name: '', clusterPattern: '' });
};

// Start editing an existing theme's name/pattern.
const handleEditTheme = (theme: types.Theme) => {
  setEditingThemeId(theme.id);
  setThemeDraft({ name: theme.name, clusterPattern: theme.clusterPattern });
};

// Commit theme edit (save name/pattern changes or create new).
const handleThemeSave = async () => {
  if (!themeDraft.name.trim()) return;

  try {
    if (editingThemeId === 'new') {
      // Create new theme from current palette values.
      const newTheme: types.Theme = {
        id: crypto.randomUUID(),
        name: themeDraft.name.trim(),
        clusterPattern: themeDraft.clusterPattern.trim(),
        paletteHueLight: paletteHue,
        paletteSaturationLight: paletteSaturation,
        paletteBrightnessLight: paletteBrightness,
        paletteHueDark: paletteHue,
        paletteSaturationDark: paletteSaturation,
        paletteBrightnessDark: paletteBrightness,
        accentColorLight: resolvedTheme === 'light' ? accentColor : '',
        accentColorDark: resolvedTheme === 'dark' ? accentColor : '',
      };
      await saveTheme(newTheme);
    } else if (editingThemeId) {
      // Update name/pattern of existing theme.
      const existing = themes.find((t) => t.id === editingThemeId);
      if (existing) {
        await saveTheme({
          ...existing,
          name: themeDraft.name.trim(),
          clusterPattern: themeDraft.clusterPattern.trim(),
        });
      }
    }
    // Reload themes list.
    const result = await getThemes();
    setThemes(result || []);
    setEditingThemeId(null);
  } catch (error) {
    errorHandler.handle(error, { action: 'saveTheme' });
  }
};

// Cancel editing.
const handleThemeEditCancel = () => {
  setEditingThemeId(null);
};

// Delete a theme after confirmation.
const handleDeleteThemeConfirm = async () => {
  if (!deleteConfirmThemeId) return;
  try {
    await deleteTheme(deleteConfirmThemeId);
    const result = await getThemes();
    setThemes(result || []);
  } catch (error) {
    errorHandler.handle(error, { action: 'deleteTheme' });
  } finally {
    setDeleteConfirmThemeId(null);
  }
};

// Drag-and-drop reorder handler (same pattern as ClusterTabs).
const handleThemeDrop = async (targetId: string) => {
  if (!draggingThemeId || draggingThemeId === targetId) {
    setDraggingThemeId(null);
    setDropTargetThemeId(null);
    return;
  }
  const ids = themes.map((t) => t.id);
  const fromIdx = ids.indexOf(draggingThemeId);
  const toIdx = ids.indexOf(targetId);
  if (fromIdx === -1 || toIdx === -1) return;

  // Move item from fromIdx to toIdx.
  const reordered = [...ids];
  reordered.splice(fromIdx, 1);
  reordered.splice(toIdx, 0, draggingThemeId);

  try {
    await reorderThemes(reordered);
    const result = await getThemes();
    setThemes(result || []);
  } catch (error) {
    errorHandler.handle(error, { action: 'reorderThemes' });
  } finally {
    setDraggingThemeId(null);
    setDropTargetThemeId(null);
  }
};
```

**Step 4: Render the themes table**

Add JSX after the `</div>` that closes `palette-tint-controls` (~line 545), inside the Appearance section:

```tsx
{/* Saved Themes */}
<div className="themes-section">
  <h4>Saved Themes</h4>
  {themesLoading ? (
    <div className="themes-loading">Loading themes...</div>
  ) : (
    <>
      {themes.length > 0 && (
        <div className="themes-table">
          <div className="themes-table-header">
            <span></span>
            <span>Theme Name</span>
            <span>Pattern</span>
            <span></span>
            <span></span>
          </div>
          {themes.map((theme) => {
            const isDragging = theme.id === draggingThemeId;
            const isDropTarget =
              theme.id === dropTargetThemeId && theme.id !== draggingThemeId;
            const isEditing = editingThemeId === theme.id;
            return (
              <div
                key={theme.id}
                className={`themes-table-row${isDragging ? ' themes-table-row--dragging' : ''}${isDropTarget ? ' themes-table-row--drop-target' : ''}`}
                onDragOver={(e) => {
                  if (!draggingThemeId) return;
                  e.preventDefault();
                  setDropTargetThemeId(theme.id);
                }}
                onDragLeave={() => {
                  setDropTargetThemeId((c) =>
                    c === theme.id ? null : c
                  );
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  handleThemeDrop(theme.id);
                }}
              >
                <span
                  className="themes-drag-handle"
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'move';
                    setDraggingThemeId(theme.id);
                  }}
                  onDragEnd={() => {
                    setDraggingThemeId(null);
                    setDropTargetThemeId(null);
                  }}
                  title="Drag to reorder"
                >
                  ⠿
                </span>
                {isEditing ? (
                  <>
                    <input
                      className="theme-name-input"
                      value={themeDraft.name}
                      onChange={(e) =>
                        setThemeDraft((d) => ({
                          ...d,
                          name: e.target.value,
                        }))
                      }
                      placeholder="Theme name"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleThemeSave();
                        else if (e.key === 'Escape') handleThemeEditCancel();
                        else e.stopPropagation();
                      }}
                    />
                    <input
                      className="theme-pattern-input"
                      value={themeDraft.clusterPattern}
                      onChange={(e) =>
                        setThemeDraft((d) => ({
                          ...d,
                          clusterPattern: e.target.value,
                        }))
                      }
                      placeholder="e.g. prod*"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleThemeSave();
                        else if (e.key === 'Escape') handleThemeEditCancel();
                        else e.stopPropagation();
                      }}
                    />
                    <button
                      type="button"
                      className="theme-action-button"
                      onClick={handleThemeSave}
                      title="Save"
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="theme-action-button"
                      onClick={handleThemeEditCancel}
                      title="Cancel"
                    >
                      Cancel
                    </button>
                  </>
                ) : (
                  <>
                    <span className="theme-name">{theme.name}</span>
                    <span className="theme-pattern">
                      {theme.clusterPattern || '\u2014'}
                    </span>
                    <button
                      type="button"
                      className="theme-action-button"
                      onClick={() => handleEditTheme(theme)}
                      title="Edit theme"
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="theme-action-button theme-action-delete"
                      onClick={() =>
                        setDeleteConfirmThemeId(theme.id)
                      }
                      title="Delete theme"
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
      {editingThemeId === 'new' ? (
        <div className="themes-new-form">
          <input
            className="theme-name-input"
            value={themeDraft.name}
            onChange={(e) =>
              setThemeDraft((d) => ({ ...d, name: e.target.value }))
            }
            placeholder="Theme name"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleThemeSave();
              else if (e.key === 'Escape') handleThemeEditCancel();
              else e.stopPropagation();
            }}
          />
          <input
            className="theme-pattern-input"
            value={themeDraft.clusterPattern}
            onChange={(e) =>
              setThemeDraft((d) => ({
                ...d,
                clusterPattern: e.target.value,
              }))
            }
            placeholder="Cluster pattern (optional)"
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleThemeSave();
              else if (e.key === 'Escape') handleThemeEditCancel();
              else e.stopPropagation();
            }}
          />
          <button
            type="button"
            className="button generic"
            onClick={handleThemeSave}
          >
            Save
          </button>
          <button
            type="button"
            className="button generic"
            onClick={handleThemeEditCancel}
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="button generic theme-save-current"
          onClick={handleSaveCurrentAsTheme}
        >
          + Save Current as Theme
        </button>
      )}
    </>
  )}
</div>
```

**Step 5: Add delete confirmation modal**

Add near the other ConfirmationModal instances:

```tsx
<ConfirmationModal
  isOpen={deleteConfirmThemeId !== null}
  title="Delete Theme"
  message={`Delete "${themes.find((t) => t.id === deleteConfirmThemeId)?.name || 'this theme'}"?`}
  onConfirm={handleDeleteThemeConfirm}
  onCancel={() => setDeleteConfirmThemeId(null)}
/>
```

**Step 6: Add CSS for themes table**

Add to `frontend/src/components/content/Settings.css`:

```css
/* Saved Themes */
.themes-section {
  margin-top: 16px;
}

.themes-section h4 {
  margin: 0 0 8px 0;
  font-size: 13px;
  font-weight: 600;
}

.themes-table {
  display: grid;
  grid-template-columns: 24px 1fr 1fr auto auto;
  gap: 0;
  align-items: center;
  font-size: 12px;
}

.themes-table-header {
  display: contents;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.themes-table-header > span {
  padding: 4px 8px;
  border-bottom: 1px solid var(--color-border);
}

.themes-table-row {
  display: contents;
}

.themes-table-row > * {
  padding: 6px 8px;
  border-bottom: 1px solid var(--color-border-subtle);
}

.themes-table-row--dragging > * {
  opacity: 0.4;
}

.themes-table-row--drop-target > * {
  border-top: 2px solid var(--color-accent);
}

.themes-drag-handle {
  cursor: grab;
  user-select: none;
  font-size: 14px;
  color: var(--color-text-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
}

.themes-drag-handle:active {
  cursor: grabbing;
}

.theme-name {
  font-weight: 500;
}

.theme-pattern {
  color: var(--color-text-secondary);
  font-family: monospace;
}

.theme-name-input,
.theme-pattern-input {
  font-size: 12px;
  padding: 2px 6px;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-bg-input);
  color: var(--color-text-primary);
  width: 100%;
  box-sizing: border-box;
}

.theme-action-button {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 12px;
  color: var(--color-text-secondary);
  padding: 2px 6px;
}

.theme-action-button:hover {
  color: var(--color-text-primary);
}

.theme-action-delete:hover {
  color: var(--color-danger);
}

.themes-new-form {
  display: flex;
  gap: 8px;
  align-items: center;
  margin-top: 8px;
}

.themes-new-form .theme-name-input,
.themes-new-form .theme-pattern-input {
  flex: 1;
}

.theme-save-current {
  margin-top: 8px;
}

.themes-loading {
  font-size: 12px;
  color: var(--color-text-secondary);
  padding: 8px 0;
}
```

Note: The CSS variable names above are placeholders — verify the actual variable names used in the project's design tokens (check `frontend/src/styles/themes/light.css` and `dark.css` for the correct names).

**Step 7: Verify in browser**

Run the app. The themes table should render below the palette controls. Test:
- Save current as theme
- Edit name/pattern
- Delete with confirmation
- Drag to reorder

**Step 8: Commit**

```
feat: add saved themes table UI with drag-to-reorder
```

---

### Task 7: Frontend — Cluster Auto-Match on Switch

**Files:**
- Modify: `frontend/src/modules/kubernetes/config/KubeconfigContext.tsx` (or wherever active cluster change is handled)
- Modify: `frontend/src/core/settings/appPreferences.ts` (already has the helpers)

**Step 1: Identify the cluster switch handler**

In `KubeconfigContext.tsx`, find the `setActiveKubeconfig` function. This is called when the user clicks a cluster tab.

**Step 2: Add theme auto-matching**

After the active kubeconfig is set, extract the context name and call `matchThemeForCluster`:

```typescript
import { matchThemeForCluster, applyTheme } from '@/core/settings/appPreferences';

// Inside setActiveKubeconfig or the handler that fires on cluster switch:
const contextName = selection.split(':').pop() || '';
if (contextName) {
  matchThemeForCluster(contextName).then((matchedTheme) => {
    if (matchedTheme) {
      applyTheme(matchedTheme.id).then(() => {
        // Re-hydrate preferences so the UI picks up new palette values.
        hydrateAppPreferences();
      });
    }
  });
}
```

The exact integration point depends on how `setActiveKubeconfig` is structured. The key requirement: after the cluster switch completes, fire the match check. Don't block the cluster switch on this — use `.then()` or an async side effect.

**Step 3: Handle palette re-application after theme apply**

After `hydrateAppPreferences()` resolves, the Settings component (if open) needs to re-read values. Check if `hydrateAppPreferences` already emits events that the Settings component listens to. If so, this should "just work." If not, the Settings component may need to re-read settings when `resolvedTheme` or active cluster changes.

Also ensure the palette CSS overrides are re-applied:
```typescript
import { applyTintedPalette } from '@utils/paletteTint';
import { applyAccentColor, applyAccentBg } from '@utils/accentColor';

// After hydration, re-apply visual palette:
const tint = getPaletteTint(resolvedTheme);
applyTintedPalette(tint.hue, tint.saturation, tint.brightness);
const accent = getAccentColor(resolvedTheme);
if (accent) {
  applyAccentColor(accent);
  applyAccentBg(resolvedTheme);
}
```

**Step 4: Verify in browser**

1. Save a theme with pattern `*dev*`
2. Switch to a cluster whose context name contains "dev"
3. Palette should silently update

**Step 5: Commit**

```
feat: auto-apply matching theme on cluster switch
```

---

### Task 8: Testing and Polish

**Files:**
- Modify: `backend/app_settings_themes_test.go` (expand test coverage)
- Create: `frontend/src/components/content/Settings.test.tsx` additions (or modify existing)

**Step 1: Expand backend test coverage**

Ensure tests cover edge cases:
- Theme with all zero palette values
- Theme with accent colors set vs empty
- `filepath.Match` edge cases: pattern `*` matches everything, `?` matches single char
- SaveTheme validation: empty ID, empty name
- ReorderThemes with duplicate IDs
- ReorderThemes with missing IDs

**Step 2: Add frontend tests**

Add tests to `Settings.test.tsx` (or create if it doesn't exist) for:
- Theme table renders saved themes
- "Save Current as Theme" button appears
- Edit mode shows name/pattern inputs
- Delete confirmation modal appears

**Step 3: Run all tests**

Backend: `cd /Volumes/git/luxury-yacht/app && go test ./backend/ -v`
Frontend: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run`

**Step 4: Verify CSS variable names**

Check `frontend/src/styles/themes/light.css` and `dark.css` for correct variable names used in the themes table CSS. Common ones to verify:
- `--color-text-secondary`, `--color-text-tertiary`, `--color-text-primary`
- `--color-border`, `--color-border-subtle`
- `--color-bg-input`
- `--color-accent`, `--color-danger`

Replace any that don't exist with the correct project tokens.

**Step 5: Commit**

```
test: expand theme system test coverage
```

---

### Task 9: Update Plan Doc

**Files:**
- Modify: `docs/plans/themes.md`

**Step 1: Mark items complete**

Update the original plan doc to mark all items as complete with checkmarks as they are finished.

**Step 2: Commit**

```
docs: mark themes plan items complete
```
