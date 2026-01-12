/*
 * backend/app_migration.go
 *
 * Handles migration of legacy backend files to the current settings format.
 */

package backend

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"k8s.io/client-go/util/homedir"
)

type legacyAppPreferences struct {
	Theme                            string   `json:"theme"`
	SelectedKubeconfig               string   `json:"selectedKubeconfig"`
	SelectedKubeconfigs              []string `json:"selectedKubeconfigs"`
	UseShortResourceNames            *bool    `json:"useShortResourceNames"`
	AutoRefreshEnabled               *bool    `json:"autoRefreshEnabled"`
	RefreshBackgroundClustersEnabled *bool    `json:"refreshBackgroundClustersEnabled"`
	GridTablePersistenceMode         string   `json:"gridTablePersistenceMode"`
}

type legacyLocalStoragePayload struct {
	Theme                            *string                    `json:"theme"`
	UseShortResourceNames            *bool                      `json:"useShortResourceNames"`
	AutoRefreshEnabled               *bool                      `json:"autoRefreshEnabled"`
	RefreshBackgroundClustersEnabled *bool                      `json:"refreshBackgroundClustersEnabled"`
	GridTablePersistenceMode         *string                    `json:"gridTablePersistenceMode"`
	ClusterTabsOrder                 []string                   `json:"clusterTabsOrder"`
	GridTableEntries                 map[string]json.RawMessage `json:"gridTableEntries"`
}

type legacyFileCandidate struct {
	path    string
	modTime time.Time
}

// gridTablePayloadVersion matches the GridTable persisted payload version.
const gridTablePayloadVersion = 1

// migrateLegacyBackendFiles imports legacy backend files into settings.json.
func (a *App) migrateLegacyBackendFiles() {
	if a == nil || a.logger == nil {
		return
	}

	windowCandidates := findLegacyFileCandidates("window-settings.json")
	prefsCandidates := findLegacyFileCandidates("app-preferences.json")
	if len(windowCandidates) == 0 && len(prefsCandidates) == 0 {
		a.logger.Debug("Legacy migration: no legacy backend files found", "Migration")
		return
	}

	logLegacyCandidates(a.logger, "window-settings.json", windowCandidates)
	logLegacyCandidates(a.logger, "app-preferences.json", prefsCandidates)

	settings, err := a.loadSettingsFile()
	if err != nil {
		a.logger.Warn(fmt.Sprintf("Legacy migration: failed to load settings.json: %v", err), "Migration")
		return
	}
	settings = normalizeSettingsFile(settings)
	defaults := defaultSettingsFile()

	var (
		windowPath      string
		windowSettings  *WindowSettings
		windowParsed    bool
		prefsPath       string
		legacyPrefs     *legacyAppPreferences
		prefsParsed     bool
		settingsChanged bool
	)

	if candidate, ok := selectLatestLegacyCandidate(windowCandidates); ok {
		windowPath = candidate.path
		windowSettings, err = readLegacyWindowSettings(windowPath)
		if err != nil {
			a.logger.Warn(fmt.Sprintf("Legacy migration: failed to read %s: %v", windowPath, err), "Migration")
		} else {
			windowParsed = true
		}
	}

	if candidate, ok := selectLatestLegacyCandidate(prefsCandidates); ok {
		prefsPath = candidate.path
		legacyPrefs, err = readLegacyAppPreferences(prefsPath)
		if err != nil {
			a.logger.Warn(fmt.Sprintf("Legacy migration: failed to read %s: %v", prefsPath, err), "Migration")
		} else {
			prefsParsed = true
		}
	}

	if windowParsed {
		if settings.UI.Window.Width <= 0 || settings.UI.Window.Height <= 0 {
			settings.UI.Window = *windowSettings
			settingsChanged = true
			a.logger.Info("Legacy migration: applied window settings", "Migration")
		} else {
			a.logger.Info("Legacy migration: skipped window settings (already set)", "Migration")
		}
	}

	if prefsParsed {
		applied := applyLegacyAppPreferences(a.logger, settings, defaults, legacyPrefs)
		if applied {
			settingsChanged = true
		}
	}

	if settingsChanged {
		if err := a.saveSettingsFile(settings); err != nil {
			a.logger.Warn(fmt.Sprintf("Legacy migration: failed to persist settings.json: %v", err), "Migration")
			return
		}
	}

	if windowParsed {
		deleteLegacyFile(a.logger, windowPath)
	}
	if prefsParsed {
		deleteLegacyFile(a.logger, prefsPath)
	}

	a.logger.Info("Legacy migration: backend file migration complete", "Migration")
}

// MigrateLegacyLocalStorage imports legacy localStorage payloads into the backend store.
func (a *App) MigrateLegacyLocalStorage(payload legacyLocalStoragePayload) error {
	if a == nil || a.logger == nil {
		return nil
	}

	if payloadIsEmpty(payload) {
		a.logger.Debug("Legacy migration: no legacy localStorage data provided", "Migration")
		return nil
	}

	a.logger.Info("Legacy migration: processing localStorage payload", "Migration")
	if details := describeLegacyPayload(payload); len(details) > 0 {
		a.logger.Info(
			fmt.Sprintf("Legacy migration: localStorage payload includes %s", strings.Join(details, ", ")),
			"Migration",
		)
	}

	settings, err := a.loadSettingsFile()
	if err != nil {
		a.logger.Warn(fmt.Sprintf("Legacy migration: failed to load settings.json: %v", err), "Migration")
		return err
	}
	settings = normalizeSettingsFile(settings)
	defaults := defaultSettingsFile()

	if applyLegacyLocalStoragePreferences(a.logger, settings, defaults, payload) {
		if err := a.saveSettingsFile(settings); err != nil {
			a.logger.Warn(fmt.Sprintf("Legacy migration: failed to save settings.json: %v", err), "Migration")
			return err
		}
	}

	if err := a.applyLegacyPersistencePayload(payload); err != nil {
		a.logger.Warn(fmt.Sprintf("Legacy migration: failed to save persistence.json: %v", err), "Migration")
		return err
	}

	a.logger.Info("Legacy migration: localStorage migration complete", "Migration")
	return nil
}

func payloadIsEmpty(payload legacyLocalStoragePayload) bool {
	return payload.Theme == nil &&
		payload.UseShortResourceNames == nil &&
		payload.AutoRefreshEnabled == nil &&
		payload.RefreshBackgroundClustersEnabled == nil &&
		payload.GridTablePersistenceMode == nil &&
		len(payload.ClusterTabsOrder) == 0 &&
		len(payload.GridTableEntries) == 0
}

// describeLegacyPayload summarizes which localStorage fields are present.
func describeLegacyPayload(payload legacyLocalStoragePayload) []string {
	entries := make([]string, 0)
	if payload.Theme != nil {
		entries = append(entries, "theme")
	}
	if payload.UseShortResourceNames != nil {
		entries = append(entries, "useShortResourceNames")
	}
	if payload.AutoRefreshEnabled != nil {
		entries = append(entries, "autoRefreshEnabled")
	}
	if payload.RefreshBackgroundClustersEnabled != nil {
		entries = append(entries, "refreshBackgroundClustersEnabled")
	}
	if payload.GridTablePersistenceMode != nil {
		entries = append(entries, "gridTablePersistenceMode")
	}
	if len(payload.ClusterTabsOrder) > 0 {
		entries = append(entries, fmt.Sprintf("clusterTabsOrder(%d)", len(payload.ClusterTabsOrder)))
	}
	if len(payload.GridTableEntries) > 0 {
		entries = append(entries, fmt.Sprintf("gridTableEntries(%d)", len(payload.GridTableEntries)))
	}
	return entries
}

func applyLegacyLocalStoragePreferences(
	logger *Logger,
	settings *settingsFile,
	defaults *settingsFile,
	payload legacyLocalStoragePayload,
) bool {
	// Only apply legacy values when settings are still at defaults.
	changed := false
	applied := make([]string, 0)

	if payload.Theme != nil && settings.Preferences.Theme == defaults.Preferences.Theme {
		if isValidTheme(*payload.Theme) {
			if *payload.Theme != settings.Preferences.Theme {
				settings.Preferences.Theme = *payload.Theme
				changed = true
			}
			if *payload.Theme != defaults.Preferences.Theme {
				applied = append(applied, "theme")
			}
		} else if logger != nil {
			logger.Warn(fmt.Sprintf("Legacy migration: invalid theme value %q", *payload.Theme), "Migration")
		}
	}

	if payload.UseShortResourceNames != nil &&
		settings.Preferences.UseShortResourceNames == defaults.Preferences.UseShortResourceNames &&
		*payload.UseShortResourceNames != defaults.Preferences.UseShortResourceNames {
		settings.Preferences.UseShortResourceNames = *payload.UseShortResourceNames
		applied = append(applied, "useShortResourceNames")
		changed = true
	}

	if payload.AutoRefreshEnabled != nil &&
		settings.Preferences.Refresh.Auto == defaults.Preferences.Refresh.Auto &&
		*payload.AutoRefreshEnabled != defaults.Preferences.Refresh.Auto {
		settings.Preferences.Refresh.Auto = *payload.AutoRefreshEnabled
		applied = append(applied, "autoRefreshEnabled")
		changed = true
	}

	if payload.RefreshBackgroundClustersEnabled != nil &&
		settings.Preferences.Refresh.Background == defaults.Preferences.Refresh.Background &&
		*payload.RefreshBackgroundClustersEnabled != defaults.Preferences.Refresh.Background {
		settings.Preferences.Refresh.Background = *payload.RefreshBackgroundClustersEnabled
		applied = append(applied, "refreshBackgroundClustersEnabled")
		changed = true
	}

	if payload.GridTablePersistenceMode != nil &&
		settings.Preferences.GridTablePersistenceMode == defaults.Preferences.GridTablePersistenceMode {
		if isValidGridTablePersistenceMode(*payload.GridTablePersistenceMode) &&
			*payload.GridTablePersistenceMode != defaults.Preferences.GridTablePersistenceMode {
			settings.Preferences.GridTablePersistenceMode = *payload.GridTablePersistenceMode
			applied = append(applied, "gridTablePersistenceMode")
			changed = true
		} else if logger != nil && !isValidGridTablePersistenceMode(*payload.GridTablePersistenceMode) {
			logger.Warn(fmt.Sprintf("Legacy migration: invalid grid table mode %q", *payload.GridTablePersistenceMode), "Migration")
		}
	}

	if logger != nil {
		if len(applied) > 0 {
			logger.Info(fmt.Sprintf("Legacy migration: applied localStorage preferences (%s)", strings.Join(applied, ", ")), "Migration")
		} else {
			logger.Info("Legacy migration: no localStorage preferences required migration", "Migration")
		}
	}

	return changed
}

func (a *App) applyLegacyPersistencePayload(payload legacyLocalStoragePayload) error {
	if len(payload.ClusterTabsOrder) == 0 && len(payload.GridTableEntries) == 0 {
		return nil
	}

	a.persistenceMu.Lock()
	defer a.persistenceMu.Unlock()

	state, err := a.loadPersistenceFile()
	if err != nil {
		return err
	}

	persistenceChanged := false

	if len(payload.ClusterTabsOrder) > 0 {
		if len(state.ClusterTabs.Order) == 0 {
			resolved := a.resolveLegacyClusterTabOrder(payload.ClusterTabsOrder)
			if len(resolved) > 0 {
				state.ClusterTabs.Order = resolved
				persistenceChanged = true
				a.logger.Info(
					fmt.Sprintf("Legacy migration: migrated cluster tab order (%d entries)", len(resolved)),
					"Migration",
				)
			} else {
				a.logger.Info("Legacy migration: no cluster tab entries resolved for migration", "Migration")
			}
		} else {
			a.logger.Info("Legacy migration: skipped cluster tab order (already set)", "Migration")
		}
	}

	if len(payload.GridTableEntries) > 0 {
		entries := state.Tables.GridTable[gridTablePersistenceVersionKey]
		if entries == nil {
			entries = make(map[string]json.RawMessage)
			state.Tables.GridTable[gridTablePersistenceVersionKey] = entries
		}

		added := 0
		skipped := 0
		invalid := 0
		for key, value := range payload.GridTableEntries {
			if strings.TrimSpace(key) == "" || len(value) == 0 {
				invalid++
				continue
			}
			if _, exists := entries[key]; exists {
				skipped++
				continue
			}
			if !isValidGridTablePayload(value) {
				invalid++
				continue
			}
			entries[key] = value
			added++
		}

		if added > 0 {
			persistenceChanged = true
		}

		a.logger.Info(
			fmt.Sprintf(
				"Legacy migration: imported grid table persistence (added=%d, skipped=%d, invalid=%d)",
				added,
				skipped,
				invalid,
			),
			"Migration",
		)
	}

	if !persistenceChanged {
		return nil
	}

	return a.savePersistenceFile(state)
}

func resolveLegacyConfigDirs() []string {
	dirs := make([]string, 0, 2)
	if configDir, err := os.UserConfigDir(); err == nil && configDir != "" {
		dirs = append(dirs, filepath.Join(configDir, "luxury-yacht"))
	}
	if home := homedir.HomeDir(); home != "" {
		dirs = append(dirs, filepath.Join(home, ".config", "luxury-yacht"))
	}
	return dedupeStrings(dirs)
}

func findLegacyFileCandidates(fileName string) []legacyFileCandidate {
	var candidates []legacyFileCandidate
	for _, dir := range resolveLegacyConfigDirs() {
		path := filepath.Join(dir, fileName)
		info, err := os.Stat(path)
		if err != nil {
			continue
		}
		candidates = append(candidates, legacyFileCandidate{
			path:    path,
			modTime: info.ModTime(),
		})
	}
	return candidates
}

func logLegacyCandidates(logger *Logger, fileName string, candidates []legacyFileCandidate) {
	if logger == nil {
		return
	}
	if len(candidates) == 0 {
		logger.Debug(fmt.Sprintf("Legacy migration: %s not found", fileName), "Migration")
		return
	}
	for _, candidate := range candidates {
		logger.Info(fmt.Sprintf("Legacy migration: located %s at %s", fileName, candidate.path), "Migration")
	}
	if len(candidates) > 1 {
		logger.Info(fmt.Sprintf("Legacy migration: multiple %s files found; using most recent", fileName), "Migration")
	}
}

func selectLatestLegacyCandidate(candidates []legacyFileCandidate) (legacyFileCandidate, bool) {
	if len(candidates) == 0 {
		return legacyFileCandidate{}, false
	}
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].modTime.After(candidates[j].modTime)
	})
	return candidates[0], true
}

func readLegacyWindowSettings(path string) (*WindowSettings, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var settings WindowSettings
	if err := json.Unmarshal(data, &settings); err != nil {
		return nil, err
	}
	return &settings, nil
}

func readLegacyAppPreferences(path string) (*legacyAppPreferences, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var prefs legacyAppPreferences
	if err := json.Unmarshal(data, &prefs); err != nil {
		return nil, err
	}
	return &prefs, nil
}

// applyLegacyAppPreferences merges legacy app-preferences.json values into settings.json.
func applyLegacyAppPreferences(
	logger *Logger,
	settings *settingsFile,
	defaults *settingsFile,
	prefs *legacyAppPreferences,
) bool {
	changed := false
	applied := make([]string, 0)

	if prefs == nil || settings == nil || defaults == nil {
		return false
	}

	theme := strings.TrimSpace(prefs.Theme)
	if theme != "" && settings.Preferences.Theme == defaults.Preferences.Theme {
		if isValidTheme(theme) {
			if theme != settings.Preferences.Theme {
				settings.Preferences.Theme = theme
				changed = true
			}
			if theme != defaults.Preferences.Theme {
				applied = append(applied, "theme")
			}
		} else if logger != nil {
			logger.Warn(fmt.Sprintf("Legacy migration: invalid theme value %q", theme), "Migration")
		}
	}

	if prefs.UseShortResourceNames != nil &&
		settings.Preferences.UseShortResourceNames == defaults.Preferences.UseShortResourceNames &&
		*prefs.UseShortResourceNames != defaults.Preferences.UseShortResourceNames {
		settings.Preferences.UseShortResourceNames = *prefs.UseShortResourceNames
		applied = append(applied, "useShortResourceNames")
		changed = true
	}

	if prefs.AutoRefreshEnabled != nil &&
		settings.Preferences.Refresh.Auto == defaults.Preferences.Refresh.Auto &&
		*prefs.AutoRefreshEnabled != defaults.Preferences.Refresh.Auto {
		settings.Preferences.Refresh.Auto = *prefs.AutoRefreshEnabled
		applied = append(applied, "autoRefreshEnabled")
		changed = true
	}

	if prefs.RefreshBackgroundClustersEnabled != nil &&
		settings.Preferences.Refresh.Background == defaults.Preferences.Refresh.Background &&
		*prefs.RefreshBackgroundClustersEnabled != defaults.Preferences.Refresh.Background {
		settings.Preferences.Refresh.Background = *prefs.RefreshBackgroundClustersEnabled
		applied = append(applied, "refreshBackgroundClustersEnabled")
		changed = true
	}

	if prefs.GridTablePersistenceMode != "" &&
		settings.Preferences.GridTablePersistenceMode == defaults.Preferences.GridTablePersistenceMode &&
		prefs.GridTablePersistenceMode != defaults.Preferences.GridTablePersistenceMode {
		if isValidGridTablePersistenceMode(prefs.GridTablePersistenceMode) {
			settings.Preferences.GridTablePersistenceMode = prefs.GridTablePersistenceMode
			applied = append(applied, "gridTablePersistenceMode")
			changed = true
		} else if logger != nil {
			logger.Warn(
				fmt.Sprintf(
					"Legacy migration: invalid grid table mode %q",
					prefs.GridTablePersistenceMode,
				),
				"Migration",
			)
		}
	}

	if len(settings.Kubeconfig.Selected) == 0 && settings.Kubeconfig.Active == "" {
		selections := normalizeSelections(prefs.SelectedKubeconfigs)
		active := strings.TrimSpace(prefs.SelectedKubeconfig)
		if len(selections) == 0 && active != "" {
			selections = []string{active}
		}
		if active == "" && len(selections) > 0 {
			active = selections[0]
		}
		if len(selections) > 0 {
			settings.Kubeconfig.Selected = selections
			settings.Kubeconfig.Active = active
			applied = append(applied, "kubeconfig")
			changed = true
		}
	}

	if logger != nil {
		if len(applied) > 0 {
			logger.Info(
				fmt.Sprintf("Legacy migration: applied app-preferences.json fields (%s)", strings.Join(applied, ", ")),
				"Migration",
			)
		} else {
			logger.Info("Legacy migration: no app-preferences.json values required migration", "Migration")
		}
	}

	return changed
}

func normalizeSelections(selections []string) []string {
	result := make([]string, 0, len(selections))
	seen := make(map[string]struct{}, len(selections))
	for _, selection := range selections {
		trimmed := strings.TrimSpace(selection)
		if trimmed == "" {
			continue
		}
		if _, exists := seen[trimmed]; exists {
			continue
		}
		seen[trimmed] = struct{}{}
		result = append(result, trimmed)
	}
	return result
}

func deleteLegacyFile(logger *Logger, path string) {
	if strings.TrimSpace(path) == "" {
		return
	}
	if err := removeFileIfExists(path); err != nil {
		logger.Warn(fmt.Sprintf("Legacy migration: failed to delete %s: %v", path, err), "Migration")
		return
	}
	logger.Info(fmt.Sprintf("Legacy migration: deleted legacy file %s", path), "Migration")
}

func isValidTheme(theme string) bool {
	return theme == "light" || theme == "dark" || theme == "system"
}

func isValidGridTablePersistenceMode(mode string) bool {
	return mode == "shared" || mode == "namespaced"
}

func isValidGridTablePayload(payload json.RawMessage) bool {
	var envelope struct {
		Version int `json:"version"`
	}
	if err := json.Unmarshal(payload, &envelope); err != nil {
		return false
	}
	return envelope.Version == gridTablePayloadVersion
}

func dedupeStrings(values []string) []string {
	seen := make(map[string]struct{}, len(values))
	result := make([]string, 0, len(values))
	for _, value := range values {
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	return result
}

// resolveLegacyClusterTabOrder maps legacy filename:context IDs to full path:context selections.
func (a *App) resolveLegacyClusterTabOrder(order []string) []string {
	if len(order) == 0 {
		return nil
	}
	if len(a.availableKubeconfigs) == 0 {
		if a.logger != nil {
			a.logger.Warn("Legacy migration: unable to resolve cluster tab order (no kubeconfigs loaded)", "Migration")
		}
		return nil
	}

	byPathContext := make(map[string]kubeconfigSelection, len(a.availableKubeconfigs))
	byPath := make(map[string][]kubeconfigSelection)
	byNameContext := make(map[string][]kubeconfigSelection)
	byName := make(map[string][]kubeconfigSelection)

	for _, kc := range a.availableKubeconfigs {
		selection := kubeconfigSelection{Path: kc.Path, Context: kc.Context}
		key := fmt.Sprintf("%s:%s", kc.Path, kc.Context)
		byPathContext[key] = selection
		byPath[kc.Path] = append(byPath[kc.Path], selection)
		nameKey := fmt.Sprintf("%s:%s", kc.Name, kc.Context)
		byNameContext[nameKey] = append(byNameContext[nameKey], selection)
		byName[kc.Name] = append(byName[kc.Name], selection)
	}

	resolved := make([]string, 0, len(order))
	seen := make(map[string]struct{}, len(order))

	for _, entry := range order {
		trimmed := strings.TrimSpace(entry)
		if trimmed == "" {
			continue
		}

		pathPart, contextPart := splitSelectionParts(trimmed)
		if pathPart == "" {
			continue
		}

		var selection *kubeconfigSelection
		if contextPart != "" {
			if match, ok := byPathContext[fmt.Sprintf("%s:%s", pathPart, contextPart)]; ok {
				selection = &match
			} else {
				matches := byNameContext[fmt.Sprintf("%s:%s", pathPart, contextPart)]
				if len(matches) == 1 {
					selection = &matches[0]
				} else if len(matches) > 1 {
					a.logger.Info(
						fmt.Sprintf("Legacy migration: ambiguous cluster tab entry %q (multiple matches)", trimmed),
						"Migration",
					)
				} else {
					a.logger.Info(
						fmt.Sprintf("Legacy migration: cluster tab entry %q not found", trimmed),
						"Migration",
					)
				}
			}
		} else {
			if matches := byPath[pathPart]; len(matches) == 1 {
				selection = &matches[0]
			} else if matches := byName[pathPart]; len(matches) == 1 {
				selection = &matches[0]
			} else if len(byPath[pathPart]) > 1 || len(byName[pathPart]) > 1 {
				a.logger.Info(
					fmt.Sprintf("Legacy migration: ambiguous cluster tab entry %q (multiple matches)", trimmed),
					"Migration",
				)
			} else {
				a.logger.Info(
					fmt.Sprintf("Legacy migration: cluster tab entry %q not found", trimmed),
					"Migration",
				)
			}
		}

		if selection == nil {
			continue
		}

		normalized := selection.String()
		if _, exists := seen[normalized]; exists {
			continue
		}
		seen[normalized] = struct{}{}
		resolved = append(resolved, normalized)
	}

	return resolved
}
