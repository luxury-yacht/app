# Default Object Panel Position Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persistent "Default Object Panel position" setting (Docked Right / Docked Bottom / Floating) in Settings > Display.

**Architecture:** New field flows through the existing settings pipeline: Go `settingsPreferences` struct → JSON file on disk → `AppSettings` DTO → frontend `AppPreferences` cache → consumed by `ObjectPanel.tsx` as the fallback position for `getPreferredOpenGroupKey()`.

**Tech Stack:** Go (backend settings), React/TypeScript (frontend preferences, settings UI, ObjectPanel consumer), Vitest (frontend tests), Go testing (backend tests).

**Spec:** `docs/superpowers/specs/2026-03-16-default-object-panel-position-design.md`

---

## File Structure

| File | Role |
|------|------|
| `backend/resources/types/types.go` | Add field to `AppSettings` DTO |
| `backend/app_settings.go` | Storage struct, defaults, load/save wiring, setter |
| `backend/app_settings_test.go` | Backend tests for setter validation and round-trip |
| `frontend/src/core/settings/appPreferences.ts` | Preference cache, getter, setter, hydration |
| `frontend/src/ui/settings/Settings.tsx` | Dropdown in Display section |
| `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.tsx` | Consume preference |

---

## Task 1: Backend — Add field and setter

**Files:**
- Modify: `backend/resources/types/types.go:38`
- Modify: `backend/app_settings.go:37,89,114-116,284,301,335,484-501`

- [ ] **Step 1: Add field to `AppSettings` DTO**

In `backend/resources/types/types.go`, add after `GridTablePersistenceMode`:

```go
DefaultObjectPanelPosition       string   `json:"defaultObjectPanelPosition"`       // "right", "bottom", or "floating"
```

- [ ] **Step 2: Add field to `settingsPreferences`**

In `backend/app_settings.go`, add after `GridTablePersistenceMode` in `settingsPreferences`:

```go
DefaultObjectPanelPosition string `json:"defaultObjectPanelPosition"`
```

- [ ] **Step 3: Set default in `defaultSettingsFile()`**

In the `settingsPreferences` literal inside `defaultSettingsFile()` (around line 89), add after `GridTablePersistenceMode: "shared"`:

```go
DefaultObjectPanelPosition: "right",
```

- [ ] **Step 4: Set default in `normalizeSettingsFile()`**

After the `GridTablePersistenceMode` normalization block (around line 116), add:

```go
if settings.Preferences.DefaultObjectPanelPosition == "" {
    settings.Preferences.DefaultObjectPanelPosition = "right"
}
```

- [ ] **Step 5: Wire through `loadAppSettings()`**

In `loadAppSettings()`, in the `AppSettings` literal (around line 301), add after `GridTablePersistenceMode`:

```go
DefaultObjectPanelPosition:       settings.Preferences.DefaultObjectPanelPosition,
```

- [ ] **Step 6: Wire through `saveAppSettings()`**

In `saveAppSettings()`, after the `GridTablePersistenceMode` write-back (around line 335), add:

```go
settings.Preferences.DefaultObjectPanelPosition = a.appSettings.DefaultObjectPanelPosition
```

- [ ] **Step 7: Add setter function**

After `SetGridTablePersistenceMode` (around line 501), add:

```go
// SetDefaultObjectPanelPosition persists the default object panel position.
func (a *App) SetDefaultObjectPanelPosition(position string) error {
	if position != "right" && position != "bottom" && position != "floating" {
		return fmt.Errorf("invalid default object panel position: %s", position)
	}

	if err := a.loadAppSettings(); err != nil {
		return fmt.Errorf("failed to load settings: %w", err)
	}

	a.logger.Info(fmt.Sprintf("Default object panel position changed to: %s", position), "Settings")
	a.appSettings.DefaultObjectPanelPosition = position
	return a.saveAppSettings()
}
```

- [ ] **Step 8: Verify Go build**

Run: `cd /Volumes/git/luxury-yacht/app && go build ./...`
Expected: clean build, no errors.

---

## Task 2: Backend tests

**Files:**
- Modify: `backend/app_settings_test.go`

- [ ] **Step 1: Write test for setter persistence**

Add after `TestAppSetGridTablePersistenceModeRejectsInvalidValues`:

```go
func TestAppSetDefaultObjectPanelPositionPersists(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	require.NoError(t, app.SetDefaultObjectPanelPosition("bottom"))
	require.Equal(t, "bottom", app.appSettings.DefaultObjectPanelPosition)

	app.appSettings = nil
	require.NoError(t, app.loadAppSettings())
	require.Equal(t, "bottom", app.appSettings.DefaultObjectPanelPosition)

	entries := app.logger.GetEntries()
	require.NotEmpty(t, entries)
	last := entries[len(entries)-1]
	require.Contains(t, last.Message, "Default object panel position changed to: bottom")
}

func TestAppSetDefaultObjectPanelPositionRejectsInvalidValues(t *testing.T) {
	setTestConfigEnv(t)
	app := newTestAppWithDefaults(t)

	err := app.SetDefaultObjectPanelPosition("invalid")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid default object panel position")
}
```

- [ ] **Step 2: Update round-trip test**

In `TestAppSaveAndLoadAppSettingsRoundTrip`, add `DefaultObjectPanelPosition: "floating"` to the settings literal (after `GridTablePersistenceMode`), and add the assertion:

```go
require.Equal(t, "floating", app.appSettings.DefaultObjectPanelPosition)
```

- [ ] **Step 3: Update normalization test**

In `TestLoadSettingsFileNormalizesDefaults`, add after the `GridTablePersistenceMode` assertion:

```go
require.Equal(t, "right", settings.Preferences.DefaultObjectPanelPosition)
```

- [ ] **Step 4: Run backend tests**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/ -run TestApp -v`
Expected: all tests pass.

---

## Task 3: Generate Wails bindings

- [ ] **Step 1: Regenerate Wails JS/TS bindings**

Run: `cd /Volumes/git/luxury-yacht/app && wails generate module`
Expected: `frontend/wailsjs/go/backend/App.js` and `App.d.ts` updated with `SetDefaultObjectPanelPosition`.

- [ ] **Step 2: Verify TypeScript still compiles**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit`
Expected: clean.

---

## Task 4: Frontend preferences layer

**Files:**
- Modify: `frontend/src/core/settings/appPreferences.ts`

- [ ] **Step 1: Add type and update interfaces**

After the `GridTablePersistenceMode` type (line 22), add:

```typescript
export type ObjectPanelPosition = 'right' | 'bottom' | 'floating';
```

Add to `AppPreferences` interface after `gridTablePersistenceMode`:

```typescript
defaultObjectPanelPosition: ObjectPanelPosition;
```

Add to `AppSettingsPayload` interface after `gridTablePersistenceMode`:

```typescript
defaultObjectPanelPosition?: string;
```

Add to `DEFAULT_PREFERENCES` after `gridTablePersistenceMode`:

```typescript
defaultObjectPanelPosition: 'right',
```

- [ ] **Step 2: Add normalizer**

After `normalizeGridTableMode` (around line 103), add:

```typescript
const normalizeObjectPanelPosition = (value: string | undefined): ObjectPanelPosition => {
  if (value === 'right' || value === 'bottom' || value === 'floating') {
    return value;
  }
  return DEFAULT_PREFERENCES.defaultObjectPanelPosition;
};
```

- [ ] **Step 3: Add hydration mapping**

In `hydrateAppPreferences()`, in the preference-cache update object (around line 230), add after `gridTablePersistenceMode`:

```typescript
defaultObjectPanelPosition: normalizeObjectPanelPosition(backendSettings?.defaultObjectPanelPosition),
```

- [ ] **Step 4: Add getter**

After `getGridTablePersistenceMode` (around line 275), add:

```typescript
export const getDefaultObjectPanelPosition = (): ObjectPanelPosition => {
  return preferenceCache.defaultObjectPanelPosition;
};
```

- [ ] **Step 5: Add persist function and setter**

After `persistGridTableMode` (around line 200), add:

```typescript
const persistObjectPanelPosition = async (position: ObjectPanelPosition): Promise<void> => {
  const runtimeApp = (window as any)?.go?.backend?.App;
  if (!runtimeApp) {
    return;
  }
  const setter = runtimeApp?.SetDefaultObjectPanelPosition;
  if (typeof setter !== 'function') {
    throw new Error('SetDefaultObjectPanelPosition is not available');
  }
  await setter(position);
};
```

After `setGridTablePersistenceMode` (around line 381), add:

```typescript
export const setDefaultObjectPanelPosition = (position: ObjectPanelPosition): void => {
  const normalized = normalizeObjectPanelPosition(position);
  hydrated = true;
  updatePreferenceCache({ defaultObjectPanelPosition: normalized });
  void persistObjectPanelPosition(normalized).catch((error) => {
    console.error('Failed to persist default object panel position:', error);
  });
};
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit`
Expected: clean.

---

## Task 5: Settings UI — Display section dropdown

**Files:**
- Modify: `frontend/src/ui/settings/Settings.tsx`

- [ ] **Step 1: Add imports and state**

Add to imports from `appPreferences`:

```typescript
getDefaultObjectPanelPosition,
setDefaultObjectPanelPosition,
type ObjectPanelPosition,
```

Add state (near line 72, after `persistenceMode` state):

```typescript
const [objectPanelPosition, setObjectPanelPositionState] = useState<ObjectPanelPosition>(() =>
  getDefaultObjectPanelPosition()
);
```

- [ ] **Step 2: Wire into settings load**

In `loadAppSettings` callback (around line 140), after `setPersistenceMode`, add:

```typescript
setObjectPanelPositionState(getDefaultObjectPanelPosition());
```

- [ ] **Step 3: Add change handler**

After `handlePersistenceModeToggle` (around line 249), add:

```typescript
const handleObjectPanelPositionChange = (position: ObjectPanelPosition) => {
  setObjectPanelPositionState(position);
  setDefaultObjectPanelPosition(position);
};
```

- [ ] **Step 4: Add dropdown to Display section**

In the Display section (after the short-resource-names setting-item div, around line 1354), add:

```tsx
<div className="setting-item">
  <label htmlFor="object-panel-position">Default Object Panel position</label>
  <select
    id="object-panel-position"
    value={objectPanelPosition}
    onChange={(e) => handleObjectPanelPositionChange(e.target.value as ObjectPanelPosition)}
  >
    <option value="right">Docked Right</option>
    <option value="bottom">Docked Bottom</option>
    <option value="floating">Floating</option>
  </select>
</div>
```

- [ ] **Step 5: Verify TypeScript compiles and lint passes**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit && npx eslint src/ui/settings/Settings.tsx`
Expected: clean.

---

## Task 6: ObjectPanel consumer

**Files:**
- Modify: `frontend/src/modules/object-panel/components/ObjectPanel/ObjectPanel.tsx:186`

- [ ] **Step 1: Add import**

```typescript
import { getDefaultObjectPanelPosition } from '@core/settings/appPreferences';
```

- [ ] **Step 2: Replace hardcoded fallback**

Change line 186 from:

```typescript
const openTargetGroupKey = getPreferredOpenGroupKey('right');
```

To:

```typescript
const openTargetGroupKey = getPreferredOpenGroupKey(getDefaultObjectPanelPosition());
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit`
Expected: clean.

---

## Task 7: Frontend tests

**Files:**
- Modify: existing test files for Settings and ObjectPanel

- [ ] **Step 1: Run existing tests to verify nothing is broken**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx vitest run src/ui/settings/ src/modules/object-panel/ --reporter=verbose`
Expected: all existing tests pass.

- [ ] **Step 2: Run full linting and type checks**

Run: `cd /Volumes/git/luxury-yacht/app/frontend && npx tsc --noEmit && npx eslint src/ui/settings/Settings.tsx src/modules/object-panel/components/ObjectPanel/ObjectPanel.tsx src/core/settings/appPreferences.ts`
Expected: clean.

- [ ] **Step 3: Run full Go test suite**

Run: `cd /Volumes/git/luxury-yacht/app && go test ./backend/ -v`
Expected: all tests pass.
