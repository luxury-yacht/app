# Themes System Design

## Overview

Transform the current flat palette settings into a named theme library with cluster pattern matching. Themes auto-apply when switching clusters based on glob patterns matched against the Kubernetes context name.

## Decisions

- Themes are **per-mode** — each theme stores separate values for light and dark
- **Auto-apply silently** on cluster match (no toast or confirmation)
- **First match wins** — list order determines priority; users reorder via drag
- Pattern matches against **context name only** (the part after `:` in the cluster ID)
- **No match = keep current palette** unchanged
- Data stored in the existing `settings.json` (Approach A — themes array in preferences)

## Data Model

### New Go Struct

```go
type Theme struct {
    ID             string `json:"id"`             // UUID
    Name           string `json:"name"`           // e.g., "Danger Red"
    ClusterPattern string `json:"clusterPattern"` // glob pattern, e.g., "prod*", "" = no auto-match

    PaletteHueLight        int    `json:"paletteHueLight"`
    PaletteSaturationLight int    `json:"paletteSaturationLight"`
    PaletteBrightnessLight int    `json:"paletteBrightnessLight"`
    PaletteHueDark         int    `json:"paletteHueDark"`
    PaletteSaturationDark  int    `json:"paletteSaturationDark"`
    PaletteBrightnessDark  int    `json:"paletteBrightnessDark"`

    AccentColorLight string `json:"accentColorLight,omitempty"`
    AccentColorDark  string `json:"accentColorDark,omitempty"`
}
```

### Settings File Addition

```go
type settingsPreferences struct {
    // ... existing fields unchanged ...
    Themes []Theme `json:"themes,omitempty"`
}
```

Existing flat palette fields (`paletteHueLight`, etc.) remain as the "active" palette. The themes array is the saved library. Applying a theme copies its values into the active fields.

## Backend API

### New Methods

```go
// CRUD for theme library
func (a *App) GetThemes() ([]Theme, error)
func (a *App) SaveTheme(theme Theme) error      // Upsert by ID
func (a *App) DeleteTheme(id string) error
func (a *App) ReorderThemes(ids []string) error  // Set ordering for first-match priority

// Apply a saved theme to the active palette
func (a *App) ApplyTheme(id string) error

// Find first matching theme for a cluster context name
func (a *App) MatchThemeForCluster(contextName string) (*Theme, error)
```

### Pattern Matching

Use Go's `filepath.Match` for glob-style wildcards (`*`, `?`). Supports the required patterns: `*dev*`, `stg-?`, `prod*`.

### ApplyTheme Flow

1. Look up theme by ID
2. Copy palette values into active settings fields
3. Persist to disk
4. Frontend re-reads settings to pick up new values

## Frontend — Theme Table

New section in Settings page, below existing palette controls:

```
Saved Themes
┌──────────────┬──────────┬────────┬────────┐
│ Theme Name   │ Pattern  │        │        │
├──────────────┼──────────┼────────┼────────┤
│ ⠿ Royal Blue │ *dev*    │ ✏ Edit │ ✕ Del  │
│ ⠿ Forest Grn │ stg-?    │ ✏ Edit │ ✕ Del  │
│ ⠿ Danger Red │ prod*    │ ✏ Edit │ ✕ Del  │
│ ⠿ Light Purp │ —        │ ✏ Edit │ ✕ Del  │
└──────────────┴──────────┴────────┴────────┘
                              [ + Save Current as Theme ]
```

- **Drag handles** (⠿) on each row for reordering (controls first-match priority)
- **Edit** — loads theme values into the palette controls + editable name/pattern fields; Save button persists
- **Delete** — removes with confirmation
- **"Save Current as Theme"** — captures active palette into new theme; prompts for name and optional pattern

## Frontend — Editable Value Fields

Apply the existing accent hex inline-edit pattern to hue, saturation, and brightness:

- Click value text → inline number input
- Enter to commit, Escape/blur to cancel
- Validation: hue 0–360, saturation 0–100, brightness −50 to +50
- Slider updates in sync when value is committed via text

## Frontend — Cluster Auto-Matching

### Trigger

When the user switches to a different cluster in the sidebar.

### Flow

1. User selects a cluster
2. Frontend extracts context name from cluster ID (split on `:`, take second part)
3. Calls `MatchThemeForCluster(contextName)`
4. If match → calls `ApplyTheme(id)` → re-reads settings → palette updates silently
5. If no match → no change
