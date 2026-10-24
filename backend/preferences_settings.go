package backend

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"time"

	"github.com/luxury-yacht/app/backend/internal/preferenceschema"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/luxury-yacht/app/internal/appstate"
)

const settingsSchemaVersion = 1

const (
	defaultThemeID   = "default"
	defaultThemeName = "default"
)

// settingsFile captures the persisted application settings stored in settings.json.
type settingsFile struct {
	SchemaVersion int                               `json:"schemaVersion"`
	UpdatedAt     time.Time                         `json:"updatedAt"`
	Telemetry     settingsTelemetry                 `json:"telemetry"`
	Preferences   settingsPreferences               `json:"preferences"`
	Kubeconfig    settingsKubeconfig                `json:"kubeconfig"`
	UI            settingsUI                        `json:"ui"`
	Attention     *settingsGlobalAttentionRules     `json:"attention,omitempty"`
	Clusters      map[string]settingsClusterSection `json:"clusters,omitempty"`
}

type settingsTelemetry struct {
	AnonymizedID               string `json:"anonymizedId"`
	InstallationMetricReported bool   `json:"installationMetricReported,omitempty"`
	// ReportedVersion is the highest release version Sentry confirmed receiving
	// for this anonymizedId; a newer running release reports an upgrade.
	ReportedVersion string `json:"reportedVersion,omitempty"`
}

type settingsGlobalAttentionRules struct {
	FindingTypes []string `json:"findingTypes,omitempty"`
}

type settingsClusterAttentionRules struct {
	ObjectFindings []snapshot.AttentionObjectFindingIgnore `json:"objectFindings,omitempty"`
	FindingTypes   []string                                `json:"findingTypes,omitempty"`
}

// settingsClusterSection captures per-cluster persisted settings, keyed by
// clusterId (kubeconfigName:context — the same identity favorites and cluster
// tabs use).
type settingsClusterSection struct {
	// AllowedNamespaces is the cluster's namespace scope
	// (docs/architecture/namespace-scope.md). Empty means no scope: every namespaced
	// data path runs cluster-wide.
	AllowedNamespaces []string                       `json:"allowedNamespaces,omitempty"`
	Attention         *settingsClusterAttentionRules `json:"attention,omitempty"`
}

// settingsPreferences captures user-configurable preferences.
type settingsPreferences struct {
	SidebarClusterResourcesExpanded    *bool                  `json:"sidebarClusterResourcesExpanded,omitempty"`
	SidebarClusterExtensionsExpanded   bool                   `json:"sidebarClusterExtensionsExpanded"`
	SidebarNamespaceResourcesExpanded  *bool                  `json:"sidebarNamespaceResourcesExpanded,omitempty"`
	SidebarNamespaceExtensionsExpanded bool                   `json:"sidebarNamespaceExtensionsExpanded"`
	AppearanceMode                     string                 `json:"appearanceMode"`
	UseShortResourceNames              bool                   `json:"useShortResourceNames"`
	DimInactiveNamespaces              *bool                  `json:"dimInactiveNamespaces,omitempty"`
	ExclusiveNamespaces                *bool                  `json:"exclusiveNamespaces,omitempty"`
	ErrorReportingEnabled              *bool                  `json:"errorReportingEnabled,omitempty"`
	Refresh                            *settingsRefresh       `json:"refresh"`
	KubernetesAPI                      *settingsKubernetesAPI `json:"kubernetesAPI,omitempty"`
	ObjPanelLogs                       *settingsObjPanelLogs  `json:"objPanelLogs,omitempty"`
	GridTablePersistenceMode           string                 `json:"gridTablePersistenceMode"`
	DefaultTablePageSize               int                    `json:"defaultTablePageSize"`
	DefaultObjectPanelPosition         string                 `json:"defaultObjectPanelPosition"`
	ObjectPanelDockedRightWidth        int                    `json:"objectPanelDockedRightWidth"`
	ObjectPanelDockedBottomHeight      int                    `json:"objectPanelDockedBottomHeight"`
	ObjectPanelFloatingWidth           int                    `json:"objectPanelFloatingWidth"`
	ObjectPanelFloatingHeight          int                    `json:"objectPanelFloatingHeight"`

	// Migration: old single-value palette fields, read-only, omitted when zero.
	PaletteHue        int `json:"paletteHue,omitempty"`
	PaletteSaturation int `json:"paletteSaturation,omitempty"`
	PaletteBrightness int `json:"paletteBrightness,omitempty"`

	// Per-mode palette fields.
	PaletteHueLight        int    `json:"paletteHueLight"`
	PaletteSaturationLight int    `json:"paletteSaturationLight"`
	PaletteBrightnessLight int    `json:"paletteBrightnessLight"`
	PaletteHueDark         int    `json:"paletteHueDark"`
	PaletteSaturationDark  int    `json:"paletteSaturationDark"`
	PaletteBrightnessDark  int    `json:"paletteBrightnessDark"`
	AccentColorLight       string `json:"accentColorLight,omitempty"`
	AccentColorDark        string `json:"accentColorDark,omitempty"`
	LinkColorLight         string `json:"linkColorLight,omitempty"`
	LinkColorDark          string `json:"linkColorDark,omitempty"`

	// Saved theme library. Order matters: first match wins for cluster pattern matching.
	Themes []Theme `json:"themes,omitempty"`
}

func (p *settingsPreferences) UnmarshalJSON(data []byte) error {
	type preferencesAlias settingsPreferences
	var decoded preferencesAlias
	if err := json.Unmarshal(data, &decoded); err != nil {
		return err
	}

	if decoded.AppearanceMode == "" {
		// Migration from settings files written before the appearance-mode rename.
		// Old files used preferences.theme for the light/dark/system mode value.
		// Keep this read-only compatibility path while schema version 1 settings remain supported.
		var raw map[string]json.RawMessage
		if err := json.Unmarshal(data, &raw); err != nil {
			return err
		}
		if oldValue, ok := raw["theme"]; ok {
			_ = json.Unmarshal(oldValue, &decoded.AppearanceMode)
		}
	}

	*p = settingsPreferences(decoded)
	return nil
}

// settingsRefresh captures user-configurable refresh settings.
type settingsRefresh struct {
	Auto              bool `json:"auto"`
	MetricsIntervalMs int  `json:"metricsIntervalMs"`
}

// settingsKubernetesAPI captures user-configurable Kubernetes API client settings.
type settingsKubernetesAPI struct {
	ClientQPS                      int `json:"clientQPS"`
	ClientBurst                    int `json:"clientBurst"`
	PermissionSSRRFetchConcurrency int `json:"permissionSSRRFetchConcurrency"`
}

// settingsObjPanelLogs captures user-configurable Object Panel Logs Tab settings.
type settingsObjPanelLogs struct {
	BufferMaxSize       int    `json:"bufferMaxSize"`       // Max container log entries kept in memory per Object Panel Logs Tab
	TargetPerScopeLimit int    `json:"targetPerScopeLimit"` // Max pod/container targets per Object Panel Logs Tab
	TargetGlobalLimit   int    `json:"targetGlobalLimit"`   // Max pod/container targets across all Object Panel Logs tabs
	APITimestampFormat  string `json:"apiTimestampFormat"`  // Day.js format for the Kubernetes API timestamp shown in container logs
	UseLocalTimeZone    bool   `json:"useLocalTimeZone"`    // Render the Kubernetes API timestamp in the user's local timezone instead of UTC
}

// settingsKubeconfig captures user-configurable kubeconfig settings.
type settingsKubeconfig struct {
	Selected    []string `json:"selected"`
	Active      string   `json:"active"`
	SearchPaths []string `json:"searchPaths"`
}

// settingsUI captures user-configurable UI settings.
type settingsUI struct {
	Window    WindowSettings `json:"window"`
	LastView  *string        `json:"lastView"`
	ZoomLevel int            `json:"zoomLevel"`
}

// defaultSettingsFile provides a fully-populated settings file with safe defaults.
func defaultSettingsFile() *settingsFile {
	preferences := defaultPreferencesFile()
	preferences.Themes = []Theme{defaultTheme()}
	return &settingsFile{
		SchemaVersion: settingsSchemaVersion,
		UpdatedAt:     time.Now().UTC(),
		Preferences:   preferences,
		Kubeconfig: settingsKubeconfig{
			SearchPaths: defaultKubeconfigSearchPaths(),
		},
	}
}

// defaultPreferencesFile holds every preference default, in the settings.json layout.
func defaultPreferencesFile() settingsPreferences {
	var preferences settingsPreferences
	writeAppPreferences(&preferences, defaultAppPreferences())
	return preferences
}

// normalizeSettingsFile completes absent values and repairs invalid ones. Load,
// save, export, and import all pass through it.
func normalizeSettingsFile(settings *settingsFile) *settingsFile {
	if settings == nil {
		return defaultSettingsFile()
	}
	completeSettingsFile(settings)
	repairPreferencesFile(&settings.Preferences)
	settings.Preferences.Themes = normalizeThemes(
		settings.Preferences.Themes,
		defaultThemeFromPreferences(settings.Preferences),
	)

	return settings
}

// completeSettingsFile fills only what is absent, under the rules settings.json
// has always used, and runs the legacy migrations. It leaves present values as
// written, so an import can still be validated against them.
func completeSettingsFile(settings *settingsFile) {
	normalizeSettingsMetadata(settings)
	completePreferences(&settings.Preferences)
	migrateLegacyPalettePreferences(&settings.Preferences)
	normalizeKubeconfigSettings(&settings.Kubeconfig)
}

func normalizeSettingsMetadata(settings *settingsFile) {
	if settings.SchemaVersion == 0 {
		settings.SchemaVersion = settingsSchemaVersion
	}
}

// completePreferences gives an absent section, an unset optional flag, or an
// empty enum its default. (A zero integer and an empty format are settled by
// the schema's own rules during repair or validation.) The Resources groups
// start open; a saved state, which earlier versions always wrote, is kept.
func completePreferences(preferences *settingsPreferences) {
	defaults := defaultPreferencesFile()
	fillNil(&preferences.SidebarClusterResourcesExpanded, defaults.SidebarClusterResourcesExpanded)
	fillNil(&preferences.SidebarNamespaceResourcesExpanded, defaults.SidebarNamespaceResourcesExpanded)
	fillNil(&preferences.DimInactiveNamespaces, defaults.DimInactiveNamespaces)
	fillNil(&preferences.ExclusiveNamespaces, defaults.ExclusiveNamespaces)
	fillNil(&preferences.ErrorReportingEnabled, defaults.ErrorReportingEnabled)
	fillNil(&preferences.Refresh, defaults.Refresh)
	fillNil(&preferences.KubernetesAPI, defaults.KubernetesAPI)
	fillNil(&preferences.ObjPanelLogs, defaults.ObjPanelLogs)
	fillEmpty(&preferences.AppearanceMode, defaults.AppearanceMode)
	fillEmpty(&preferences.GridTablePersistenceMode, defaults.GridTablePersistenceMode)
	fillEmpty(&preferences.DefaultObjectPanelPosition, defaults.DefaultObjectPanelPosition)
}

func fillNil[T any](target **T, fallback *T) {
	if *target == nil {
		*target = fallback
	}
}

func fillEmpty(target *string, fallback string) {
	if *target == "" {
		*target = fallback
	}
}

// repairPreferencesFile settles every preference in a completed file through
// the schema's Repair rule.
func repairPreferencesFile(preferences *settingsPreferences) {
	settings := &AppSettings{}
	readAppPreferences(preferences, settings)
	repairAppPreferences(settings)
	writeAppPreferences(preferences, settings)
}

// readAppPreferences maps a completed file's preferences onto AppSettings.
func readAppPreferences(preferences *settingsPreferences, settings *AppSettings) {
	settings.SidebarClusterResourcesExpanded = *preferences.SidebarClusterResourcesExpanded
	settings.SidebarClusterExtensionsExpanded = preferences.SidebarClusterExtensionsExpanded
	settings.SidebarNamespaceResourcesExpanded = *preferences.SidebarNamespaceResourcesExpanded
	settings.SidebarNamespaceExtensionsExpanded = preferences.SidebarNamespaceExtensionsExpanded
	settings.AppearanceMode = preferences.AppearanceMode
	settings.UseShortResourceNames = preferences.UseShortResourceNames
	settings.DimInactiveNamespaces = *preferences.DimInactiveNamespaces
	settings.ExclusiveNamespaces = *preferences.ExclusiveNamespaces
	settings.ErrorReportingEnabled = *preferences.ErrorReportingEnabled
	settings.AutoRefreshEnabled = preferences.Refresh.Auto
	settings.MetricsRefreshIntervalMs = preferences.Refresh.MetricsIntervalMs
	settings.KubernetesClientQPS = preferences.KubernetesAPI.ClientQPS
	settings.KubernetesClientBurst = preferences.KubernetesAPI.ClientBurst
	settings.PermissionSSRRFetchConcurrency = preferences.KubernetesAPI.PermissionSSRRFetchConcurrency
	settings.ObjPanelLogsBufferMaxSize = preferences.ObjPanelLogs.BufferMaxSize
	settings.ObjPanelLogsTargetPerScopeLimit = preferences.ObjPanelLogs.TargetPerScopeLimit
	settings.ObjPanelLogsTargetGlobalLimit = preferences.ObjPanelLogs.TargetGlobalLimit
	settings.ObjPanelLogsAPITimestampFormat = preferences.ObjPanelLogs.APITimestampFormat
	settings.ObjPanelLogsAPITimestampUseLocalTimeZone = preferences.ObjPanelLogs.UseLocalTimeZone
	settings.GridTablePersistenceMode = preferences.GridTablePersistenceMode
	settings.DefaultTablePageSize = preferences.DefaultTablePageSize
	settings.DefaultObjectPanelPosition = preferences.DefaultObjectPanelPosition
	settings.ObjectPanelDockedRightWidth = preferences.ObjectPanelDockedRightWidth
	settings.ObjectPanelDockedBottomHeight = preferences.ObjectPanelDockedBottomHeight
	settings.ObjectPanelFloatingWidth = preferences.ObjectPanelFloatingWidth
	settings.ObjectPanelFloatingHeight = preferences.ObjectPanelFloatingHeight
	settings.PaletteHueLight = preferences.PaletteHueLight
	settings.PaletteSaturationLight = preferences.PaletteSaturationLight
	settings.PaletteBrightnessLight = preferences.PaletteBrightnessLight
	settings.PaletteHueDark = preferences.PaletteHueDark
	settings.PaletteSaturationDark = preferences.PaletteSaturationDark
	settings.PaletteBrightnessDark = preferences.PaletteBrightnessDark
	settings.AccentColorLight = preferences.AccentColorLight
	settings.AccentColorDark = preferences.AccentColorDark
	settings.LinkColorLight = preferences.LinkColorLight
	settings.LinkColorDark = preferences.LinkColorDark
}

// writeAppPreferences maps AppSettings preferences into the settings.json
// layout. The legacy single-value palette fields stay zero, so omitempty drops them.
func writeAppPreferences(preferences *settingsPreferences, settings *AppSettings) {
	preferences.SidebarClusterResourcesExpanded = boolPtr(settings.SidebarClusterResourcesExpanded)
	preferences.SidebarClusterExtensionsExpanded = settings.SidebarClusterExtensionsExpanded
	preferences.SidebarNamespaceResourcesExpanded = boolPtr(settings.SidebarNamespaceResourcesExpanded)
	preferences.SidebarNamespaceExtensionsExpanded = settings.SidebarNamespaceExtensionsExpanded
	preferences.AppearanceMode = settings.AppearanceMode
	preferences.UseShortResourceNames = settings.UseShortResourceNames
	preferences.DimInactiveNamespaces = boolPtr(settings.DimInactiveNamespaces)
	preferences.ExclusiveNamespaces = boolPtr(settings.ExclusiveNamespaces)
	preferences.ErrorReportingEnabled = boolPtr(settings.ErrorReportingEnabled)
	preferences.Refresh = &settingsRefresh{
		Auto:              settings.AutoRefreshEnabled,
		MetricsIntervalMs: settings.MetricsRefreshIntervalMs,
	}
	preferences.KubernetesAPI = &settingsKubernetesAPI{
		ClientQPS:                      settings.KubernetesClientQPS,
		ClientBurst:                    settings.KubernetesClientBurst,
		PermissionSSRRFetchConcurrency: settings.PermissionSSRRFetchConcurrency,
	}
	preferences.ObjPanelLogs = &settingsObjPanelLogs{
		BufferMaxSize:       settings.ObjPanelLogsBufferMaxSize,
		TargetPerScopeLimit: settings.ObjPanelLogsTargetPerScopeLimit,
		TargetGlobalLimit:   settings.ObjPanelLogsTargetGlobalLimit,
		APITimestampFormat:  settings.ObjPanelLogsAPITimestampFormat,
		UseLocalTimeZone:    settings.ObjPanelLogsAPITimestampUseLocalTimeZone,
	}
	preferences.GridTablePersistenceMode = settings.GridTablePersistenceMode
	preferences.DefaultTablePageSize = settings.DefaultTablePageSize
	preferences.DefaultObjectPanelPosition = settings.DefaultObjectPanelPosition
	preferences.ObjectPanelDockedRightWidth = settings.ObjectPanelDockedRightWidth
	preferences.ObjectPanelDockedBottomHeight = settings.ObjectPanelDockedBottomHeight
	preferences.ObjectPanelFloatingWidth = settings.ObjectPanelFloatingWidth
	preferences.ObjectPanelFloatingHeight = settings.ObjectPanelFloatingHeight
	preferences.PaletteHueLight = settings.PaletteHueLight
	preferences.PaletteSaturationLight = settings.PaletteSaturationLight
	preferences.PaletteBrightnessLight = settings.PaletteBrightnessLight
	preferences.PaletteHueDark = settings.PaletteHueDark
	preferences.PaletteSaturationDark = settings.PaletteSaturationDark
	preferences.PaletteBrightnessDark = settings.PaletteBrightnessDark
	preferences.AccentColorLight = settings.AccentColorLight
	preferences.AccentColorDark = settings.AccentColorDark
	preferences.LinkColorLight = settings.LinkColorLight
	preferences.LinkColorDark = settings.LinkColorDark
}

func migrateLegacyPalettePreferences(preferences *settingsPreferences) {
	// Migrate old single-value palette fields to per-mode fields.
	prefs := preferences
	if (prefs.PaletteHue != 0 || prefs.PaletteSaturation != 0 || prefs.PaletteBrightness != 0) &&
		prefs.PaletteHueLight == 0 && prefs.PaletteSaturationLight == 0 && prefs.PaletteBrightnessLight == 0 &&
		prefs.PaletteHueDark == 0 && prefs.PaletteSaturationDark == 0 && prefs.PaletteBrightnessDark == 0 {
		prefs.PaletteHueLight = prefs.PaletteHue
		prefs.PaletteSaturationLight = prefs.PaletteSaturation
		prefs.PaletteBrightnessLight = prefs.PaletteBrightness
		prefs.PaletteHueDark = prefs.PaletteHue
		prefs.PaletteSaturationDark = prefs.PaletteSaturation
		prefs.PaletteBrightnessDark = prefs.PaletteBrightness
		prefs.PaletteHue = 0
		prefs.PaletteSaturation = 0
		prefs.PaletteBrightness = 0
	}
}

func normalizeKubeconfigSettings(kubeconfig *settingsKubeconfig) {
	if kubeconfig.SearchPaths == nil {
		kubeconfig.SearchPaths = defaultKubeconfigSearchPaths()
	}
}

func defaultTheme() Theme {
	return Theme{
		ID:             defaultThemeID,
		Name:           defaultThemeName,
		ClusterPattern: "",
	}
}

func defaultThemeFromPreferences(prefs settingsPreferences) Theme {
	theme := defaultTheme()
	theme.PaletteHueLight = prefs.PaletteHueLight
	theme.PaletteSaturationLight = prefs.PaletteSaturationLight
	theme.PaletteBrightnessLight = prefs.PaletteBrightnessLight
	theme.PaletteHueDark = prefs.PaletteHueDark
	theme.PaletteSaturationDark = prefs.PaletteSaturationDark
	theme.PaletteBrightnessDark = prefs.PaletteBrightnessDark
	theme.AccentColorLight = prefs.AccentColorLight
	theme.AccentColorDark = prefs.AccentColorDark
	theme.LinkColorLight = prefs.LinkColorLight
	theme.LinkColorDark = prefs.LinkColorDark
	return theme
}

func normalizeDefaultTheme(theme Theme) Theme {
	theme.ID = defaultThemeID
	theme.Name = defaultThemeName
	theme.ClusterPattern = ""
	return theme
}

func normalizeThemes(themes []Theme, fallbackDefault Theme) []Theme {
	normalized := make([]Theme, 0, len(themes)+1)
	defaultThemeValue := normalizeDefaultTheme(fallbackDefault)
	defaultThemeFound := false

	for _, theme := range themes {
		if theme.ID == defaultThemeID {
			if !defaultThemeFound {
				defaultThemeValue = normalizeDefaultTheme(theme)
				defaultThemeFound = true
			}
			continue
		}
		normalized = append(normalized, theme)
	}

	normalized = append(normalized, defaultThemeValue)
	return normalized
}

// defaultKubeconfigSearchPaths returns the default list of kubeconfig locations.
func defaultKubeconfigSearchPaths() []string {
	return []string{"~/.kube"}
}

// getSettingsFilePath returns the path to the new settings.json location.
func (p *PreferencesService) getSettingsFilePath() (string, error) {
	manifest, err := appstate.Resolve("luxury-yacht")
	if err != nil {
		return "", fmt.Errorf("could not find config directory: %w", err)
	}
	return manifest.SettingsPath(), nil
}

// cacheDirPath returns the app's cache directory (<UserCacheDir>/luxury-yacht):
// the single home for transient on-disk caches (API discovery, maintained-store
// spill, diagnostic dumps). It is the cache-tier sibling of the config dir and
// the one place that defines the cache base, so Factory Reset can clear the
// whole subtree in one call.
func (p *PreferencesService) cacheDirPath() (string, error) {
	manifest, err := appstate.Resolve("luxury-yacht")
	if err != nil {
		return "", fmt.Errorf("could not find cache directory: %w", err)
	}
	return manifest.CacheRoot, nil
}

// loadSettingsFile reads settings.json or returns defaults when missing.
func (p *PreferencesService) loadSettingsFile() (*settingsFile, error) {
	configFile, err := p.getSettingsFilePath()
	if err != nil {
		return nil, err
	}

	if _, err := os.Stat(configFile); os.IsNotExist(err) {
		return defaultSettingsFile(), nil
	}

	data, err := os.ReadFile(configFile)
	if err != nil {
		return nil, fmt.Errorf("failed to read settings file: %w", err)
	}

	settings := &settingsFile{}
	if err := json.Unmarshal(data, settings); err != nil {
		return nil, fmt.Errorf("failed to parse settings file: %w", err)
	}

	return normalizeSettingsFile(settings), nil
}

// saveSettingsFile writes settings.json with an updated timestamp.
func (p *PreferencesService) saveSettingsFile(settings *settingsFile) error {
	if settings == nil {
		return fmt.Errorf("no settings to save")
	}

	settings = normalizeSettingsFile(settings)
	if _, err := ensureAnonymizedID(settings); err != nil {
		return err
	}
	configFile, err := p.getSettingsFilePath()
	if err != nil {
		return err
	}

	settings.SchemaVersion = settingsSchemaVersion
	settings.UpdatedAt = time.Now().UTC()

	data, err := json.Marshal(settings)
	if err != nil {
		return fmt.Errorf("failed to marshal settings: %w", err)
	}

	if err := writeSettingsFileAtomic(configFile, data, 0o644); err != nil {
		return fmt.Errorf("failed to write settings file: %w", err)
	}
	return nil
}

var writeSettingsFileAtomic = writeFileAtomic

// writeFileAtomic persists data with a temp file + rename sequence.
func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return fmt.Errorf("create parent directory: %w", err)
	}
	return writeFileAtomicWithReplace(path, data, perm, os.Rename)
}

func writeFileAtomicWithReplace(
	path string,
	data []byte,
	perm os.FileMode,
	replaceFile func(string, string) error,
) error {
	dir := filepath.Dir(path)
	tempFile, err := os.CreateTemp(dir, appAtomicWriteTempPrefix+"*")
	if err != nil {
		return err
	}
	defer os.Remove(tempFile.Name())

	if _, err := tempFile.Write(data); err != nil {
		tempFile.Close()
		return err
	}
	if err := tempFile.Sync(); err != nil {
		tempFile.Close()
		return err
	}
	if err := tempFile.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tempFile.Name(), perm); err != nil {
		return err
	}

	// Replace the destination without unlinking it first. Readers must observe
	// either the previous state or the new state, including when replacement
	// fails or another app process is starting concurrently.
	return replaceFile(tempFile.Name(), path)
}

func (p *PreferencesService) SaveWindowSettings() error {
	if p != nil && p.shell != nil && p.shell.hasWindowGeometry() {
		return p.SaveWindowSettingsForWindow("")
	}
	window, err := p.shell.currentWindowWhenReady()
	if err != nil {
		return err
	}
	return p.SaveWindowSettingsForWindow(window.Name())
}

// SaveWindowSettingsForWindow persists the geometry of a named peer as the
// next session's initial geometry.
func (p *PreferencesService) SaveWindowSettingsForWindow(windowName string) error {
	if p == nil || p.shell == nil || !p.shell.runtimeAvailable() {
		return fmt.Errorf("application context is not available")
	}
	geometry, err := p.shell.readWindowGeometry(windowName)
	if err != nil {
		return fmt.Errorf("read window %q geometry: %w", windowName, err)
	}
	p.windowSettings = &WindowSettings{
		X:         geometry.X,
		Y:         geometry.Y,
		Width:     geometry.Width,
		Height:    geometry.Height,
		Maximized: geometry.Maximised,
	}

	p.settingsMu.Lock()
	defer p.settingsMu.Unlock()

	settings, err := p.loadSettingsFile()
	if err != nil {
		return err
	}

	settings.UI.Window = *p.windowSettings
	if p.appSettings != nil {
		settings.Kubeconfig.Selected = append([]string(nil), p.appSettings.SelectedKubeconfigs...)
	}
	return p.saveSettingsFile(settings)
}

func (p *PreferencesService) LoadWindowSettings() (*WindowSettings, error) {
	settings, err := p.loadSettingsFile()
	if err != nil {
		return nil, err
	}

	window := settings.UI.Window
	if window.Width <= 0 || window.Height <= 0 {
		window.Width = 1200
		window.Height = 800
	}

	p.windowSettings = &window
	return &window, nil
}

func getDefaultAppSettings() *AppSettings {
	return appSettingsFromFile(defaultSettingsFile())
}

func (p *PreferencesService) loadAppSettingsSnapshot() (*AppSettings, error) {
	settings, err := p.loadSettingsFile()
	if err != nil {
		return nil, err
	}
	created, err := ensureAnonymizedID(settings)
	if err != nil {
		return nil, err
	}
	if created {
		if err := p.saveSettingsFile(settings); err != nil {
			return nil, err
		}
	}
	return appSettingsFromFile(settings), nil
}

func appSettingsFromFile(settings *settingsFile) *AppSettings {
	settings = normalizeSettingsFile(settings)
	app := &AppSettings{
		AnonymizedID:        settings.Telemetry.AnonymizedID,
		SelectedKubeconfigs: append([]string(nil), settings.Kubeconfig.Selected...),
		Themes:              settings.Preferences.Themes,
	}
	readAppPreferences(&settings.Preferences, app)
	return app
}

func (p *PreferencesService) saveAppSettings() error {
	if p.appSettings == nil {
		return fmt.Errorf("no app settings to save")
	}

	settings, err := p.loadSettingsFile()
	if err != nil {
		return err
	}

	writeAppPreferences(&settings.Preferences, p.appSettings)
	settings.Preferences.Themes = p.appSettings.Themes
	settings.Kubeconfig.Selected = append([]string(nil), p.appSettings.SelectedKubeconfigs...)

	return p.saveSettingsFile(settings)
}

func appendPathRemovalError(errs []error, resolve func() (string, error), remove func(string) error) []error {
	path, err := resolve()
	if err == nil {
		err = remove(path)
	}
	if err != nil {
		return append(errs, err)
	}
	return errs
}

// removeFileIfExists ignores missing files so reset can be re-run safely.
func removeFileIfExists(path string) error {
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (p *PreferencesService) GetAppSettings() (*AppSettings, error) {
	snapshot, err := p.EnsureLoaded()
	return snapshot.Settings, err
}

// InitializeErrorReporting applies the persisted preference before application
// startup can produce reportable errors. A settings read failure keeps the
// reporter disabled. This is a package-level startup function so Wails does not
// expose it as a frontend-callable service method.
func InitializeErrorReporting(preferences *PreferencesService, reporting *ErrorReportingService) error {
	if preferences == nil || reporting == nil {
		return nil
	}
	snapshot, err := preferences.EnsureLoaded()
	if err != nil || snapshot.Provenance != PreferencesLoaded || snapshot.Settings == nil {
		_ = reporting.SetErrorReportingEnabled(false)
		return err
	}
	return reporting.SetErrorReportingEnabled(snapshot.Settings.ErrorReportingEnabled)
}

func copyAppSettings(settings *AppSettings) *AppSettings {
	if settings == nil {
		return nil
	}
	cp := *settings
	cp.SelectedKubeconfigs = append([]string(nil), settings.SelectedKubeconfigs...)
	cp.Themes = append([]Theme(nil), settings.Themes...)
	return &cp
}

type settingsSideEffects struct {
	errorReporting             bool
	kubernetesClientRateLimits bool
	permissionFetchConcurrency bool
	containerLogsPerScopeLimit bool
	containerLogsGlobalLimit   bool
	metricsInterval            bool
}

type preparedPreferenceUpdate struct {
	settings    *AppSettings
	changedKeys []string
	effects     settingsSideEffects
}

func (p *PreferencesService) UpdateAppPreferences(request UpdateAppPreferencesRequest) (*UpdateAppPreferencesResponse, error) {
	update, err := p.prepareAppPreferenceUpdate(request)
	if err != nil {
		return nil, err
	}
	if p.effects != nil {
		p.effects.Dispatch(update.settings, update.effects)
	}
	return &UpdateAppPreferencesResponse{Settings: update.settings, ChangedKeys: update.changedKeys}, nil
}

func (p *PreferencesService) prepareAppPreferenceUpdate(request UpdateAppPreferencesRequest) (*preparedPreferenceUpdate, error) {
	if _, err := p.EnsureLoaded(); err != nil {
		return nil, err
	}
	p.settingsMu.Lock()
	defer p.settingsMu.Unlock()

	previous := copyAppSettings(p.appSettings)
	next := copyAppSettings(p.appSettings)
	effects := settingsSideEffects{}
	changedKeys := make([]string, 0, len(request.Changes))
	seen := make(map[string]struct{}, len(request.Changes))

	for _, change := range request.Changes {
		if err := applyAppPreferenceChange(next, change, &effects); err != nil {
			return nil, err
		}
		if _, ok := seen[change.Key]; !ok {
			seen[change.Key] = struct{}{}
			changedKeys = append(changedKeys, change.Key)
		}
	}

	p.appSettings = next
	if err := p.saveAppSettings(); err != nil {
		p.appSettings = previous
		return nil, err
	}

	for _, key := range changedKeys {
		logPreferenceChange(p.logger, key, preferenceValueForLog(next, key))
	}

	return &preparedPreferenceUpdate{settings: copyAppSettings(next), changedKeys: changedKeys, effects: effects}, nil
}

func setSubsystemMetricsInterval(subsystem *system.Subsystem, interval time.Duration) {
	if subsystem == nil {
		return
	}
	subsystem.Manager.SetMetricsInterval(interval)
}

// GetZoomLevel returns the persisted zoom level, or the default when it is
// missing or outside the zoom bounds.
func (p *PreferencesService) GetZoomLevel() int {
	settings, err := p.loadSettingsFile()
	if err != nil {
		return preferenceschema.DefaultZoomLevel
	}

	level := settings.UI.ZoomLevel
	if level < preferenceschema.MinZoomLevel || level > preferenceschema.MaxZoomLevel {
		return preferenceschema.DefaultZoomLevel
	}
	return level
}

// SetZoomLevel persists the zoom level, clamped to the zoom bounds.
func (p *PreferencesService) SetZoomLevel(level int) error {
	level = min(max(level, preferenceschema.MinZoomLevel), preferenceschema.MaxZoomLevel)

	settings, err := p.loadSettingsFile()
	if err != nil {
		return err
	}

	settings.UI.ZoomLevel = level
	return p.saveSettingsFile(settings)
}

// syncThemesCacheLocked updates the in-memory appSettings cache with the current
// themes list so that preference updates do not overwrite disk-persisted
// themes with stale cached data.
func (p *PreferencesService) syncThemesCacheLocked(themes []Theme) {
	if p.appSettings != nil {
		p.appSettings.Themes = append([]Theme(nil), themes...)
	}
}

// GetThemes returns the saved theme library.
func (p *PreferencesService) GetThemes() ([]Theme, error) {
	settings, err := p.loadSettingsFile()
	if err != nil {
		return nil, fmt.Errorf("loading settings: %w", err)
	}
	return settings.Preferences.Themes, nil
}

// ValidateThemeClusterPattern checks whether a theme cluster pattern can be
// parsed by the app glob matcher without mutating saved settings.
func (p *PreferencesService) ValidateThemeClusterPattern(pattern string) ThemeClusterPatternValidationResult {
	if err := validateThemeClusterPattern(pattern); err != nil {
		return ThemeClusterPatternValidationResult{
			Valid:   false,
			Message: themeClusterPatternValidationMessage(err),
		}
	}
	return ThemeClusterPatternValidationResult{Valid: true}
}

// updateThemeLibrary publishes to the preferences cache only after the file is saved.
func (p *PreferencesService) updateThemeLibrary(update func([]Theme) ([]Theme, error)) error {
	p.settingsMu.Lock()
	defer p.settingsMu.Unlock()

	settings, err := p.loadSettingsFile()
	if err != nil {
		return fmt.Errorf("loading settings: %w", err)
	}
	themes, err := update(settings.Preferences.Themes)
	if err != nil {
		return err
	}
	settings.Preferences.Themes = normalizeThemes(themes, defaultTheme())
	if err := p.saveSettingsFile(settings); err != nil {
		return err
	}
	p.syncThemesCacheLocked(settings.Preferences.Themes)
	return nil
}

// SaveTheme creates or updates a theme in the library. If a theme with the
// same ID exists it is updated in place; otherwise the theme is appended.
func (p *PreferencesService) SaveTheme(theme Theme) error {
	if theme.ID == "" {
		return fmt.Errorf("theme ID is required")
	}
	themeIsDefault := theme.ID == defaultThemeID
	if themeIsDefault {
		theme = normalizeDefaultTheme(theme)
	}
	if theme.Name == "" {
		return fmt.Errorf("theme name is required")
	}
	if !themeIsDefault {
		if err := validateThemeClusterPattern(theme.ClusterPattern); err != nil {
			return err
		}
	}

	return p.updateThemeLibrary(func(themes []Theme) ([]Theme, error) {
		if i := slices.IndexFunc(themes, func(saved Theme) bool { return saved.ID == theme.ID }); i >= 0 {
			themes[i] = theme
			return themes, nil
		}
		if themeIsDefault {
			return append(themes, theme), nil
		}
		defaultThemeValue := themes[len(themes)-1]
		return append(append(themes[:len(themes)-1], theme), defaultThemeValue), nil
	})
}

// DeleteTheme removes a theme from the library by ID.
func (p *PreferencesService) DeleteTheme(id string) error {
	if id == defaultThemeID {
		return fmt.Errorf("default theme cannot be deleted")
	}
	return p.updateThemeLibrary(func(themes []Theme) ([]Theme, error) {
		for i, theme := range themes {
			if theme.ID == id {
				return append(themes[:i], themes[i+1:]...), nil
			}
		}
		return nil, fmt.Errorf("theme not found: %s", id)
	})
}

// ReorderThemes sets the theme ordering. The ids slice must contain exactly the
// same IDs as the current theme list (first-match priority depends on order).
func (p *PreferencesService) ReorderThemes(ids []string) error {
	return p.updateThemeLibrary(func(themes []Theme) ([]Theme, error) {
		if len(ids) != len(themes) {
			return nil, fmt.Errorf("id count mismatch: got %d, have %d themes", len(ids), len(themes))
		}
		if len(ids) == 0 || ids[len(ids)-1] != defaultThemeID {
			return nil, fmt.Errorf("default theme must remain last")
		}

		byID := make(map[string]Theme, len(themes))
		for _, theme := range themes {
			byID[theme.ID] = theme
		}
		reordered := make([]Theme, 0, len(ids))
		for _, id := range ids {
			theme, ok := byID[id]
			if !ok {
				return nil, fmt.Errorf("unknown theme ID: %s", id)
			}
			reordered = append(reordered, theme)
		}
		return reordered, nil
	})
}

// ApplyTheme loads a saved theme by ID and copies its palette values into the
// active settings fields, then persists. The frontend re-reads settings to
// pick up the changes.
func (p *PreferencesService) ApplyTheme(id string) error {
	p.settingsMu.Lock()
	defer p.settingsMu.Unlock()

	settings, err := p.loadSettingsFile()
	if err != nil {
		return fmt.Errorf("loading settings: %w", err)
	}

	var theme *Theme
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
	settings.Preferences.LinkColorLight = theme.LinkColorLight
	settings.Preferences.LinkColorDark = theme.LinkColorDark
	// A saved theme can hold values outside the preference bounds; repair them
	// before they are stored and cached.
	normalizeSettingsFile(settings)

	if err := p.saveSettingsFile(settings); err != nil {
		return err
	}

	// Sync the in-memory cache with the stored values so saveAppSettings, which
	// writes from the cache, keeps them.
	if p.appSettings != nil {
		stored := settings.Preferences
		p.appSettings.PaletteHueLight = stored.PaletteHueLight
		p.appSettings.PaletteSaturationLight = stored.PaletteSaturationLight
		p.appSettings.PaletteBrightnessLight = stored.PaletteBrightnessLight
		p.appSettings.PaletteHueDark = stored.PaletteHueDark
		p.appSettings.PaletteSaturationDark = stored.PaletteSaturationDark
		p.appSettings.PaletteBrightnessDark = stored.PaletteBrightnessDark
		p.appSettings.AccentColorLight = stored.AccentColorLight
		p.appSettings.AccentColorDark = stored.AccentColorDark
		p.appSettings.LinkColorLight = stored.LinkColorLight
		p.appSettings.LinkColorDark = stored.LinkColorDark
		p.appSettings.Themes = append([]Theme(nil), stored.Themes...)
	}
	return nil
}

// MatchThemeForCluster returns the first saved theme whose ClusterPattern
// matches the given context name using app glob rules: * matches any sequence,
// ? matches any single character, and character classes such as [a-z] are
// supported. An empty ClusterPattern is treated as "*" and matches every
// context name. Returns nil if no theme matches.
func (p *PreferencesService) MatchThemeForCluster(contextName string) (*Theme, error) {
	settings, err := p.loadSettingsFile()
	if err != nil {
		return nil, fmt.Errorf("loading settings: %w", err)
	}

	for _, t := range normalizeThemes(settings.Preferences.Themes, defaultTheme()) {
		matched, err := matchThemeClusterPattern(t.ClusterPattern, contextName)
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
