package backend

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/containerlogs"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/luxury-yacht/app/internal/appstate"
)

const settingsSchemaVersion = 1

var validHexColorRe = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

const (
	defaultThemeID   = "default"
	defaultThemeName = "default"
)

const (
	appPreferenceAppearanceMode                           = "appearanceMode"
	appPreferenceUseShortResourceNames                    = "useShortResourceNames"
	appPreferenceDimInactiveNamespaces                    = "dimInactiveNamespaces"
	appPreferenceExclusiveNamespaces                      = "exclusiveNamespaces"
	appPreferenceErrorReportingEnabled                    = "errorReportingEnabled"
	appPreferenceAutoRefreshEnabled                       = "autoRefreshEnabled"
	appPreferenceRefreshBackgroundClustersEnabled         = "refreshBackgroundClustersEnabled"
	appPreferenceMetricsRefreshIntervalMs                 = "metricsRefreshIntervalMs"
	appPreferenceKubernetesClientQPS                      = "kubernetesClientQPS"
	appPreferenceKubernetesClientBurst                    = "kubernetesClientBurst"
	appPreferencePermissionSSRRFetchConcurrency           = "permissionSSRRFetchConcurrency"
	appPreferenceObjPanelLogsBufferMaxSize                = "objPanelLogsBufferMaxSize"
	appPreferenceObjPanelLogsAPITimestampFormat           = "objPanelLogsApiTimestampFormat"
	appPreferenceObjPanelLogsAPITimestampUseLocalTimeZone = "objPanelLogsApiTimestampUseLocalTimeZone"
	appPreferenceObjPanelLogsTargetPerScopeLimit          = "objPanelLogsTargetPerScopeLimit"
	appPreferenceObjPanelLogsTargetGlobalLimit            = "objPanelLogsTargetGlobalLimit"
	appPreferenceGridTablePersistenceMode                 = "gridTablePersistenceMode"
	appPreferenceDefaultTablePageSize                     = "defaultTablePageSize"
	appPreferenceDefaultObjectPanelPosition               = "defaultObjectPanelPosition"
	appPreferenceObjectPanelDockedRightWidth              = "objectPanelDockedRightWidth"
	appPreferenceObjectPanelDockedBottomHeight            = "objectPanelDockedBottomHeight"
	appPreferenceObjectPanelFloatingWidth                 = "objectPanelFloatingWidth"
	appPreferenceObjectPanelFloatingHeight                = "objectPanelFloatingHeight"
	appPreferencePaletteHueLight                          = "paletteHueLight"
	appPreferencePaletteSaturationLight                   = "paletteSaturationLight"
	appPreferencePaletteBrightnessLight                   = "paletteBrightnessLight"
	appPreferencePaletteHueDark                           = "paletteHueDark"
	appPreferencePaletteSaturationDark                    = "paletteSaturationDark"
	appPreferencePaletteBrightnessDark                    = "paletteBrightnessDark"
	appPreferenceAccentColorLight                         = "accentColorLight"
	appPreferenceAccentColorDark                          = "accentColorDark"
	appPreferenceLinkColorLight                           = "linkColorLight"
	appPreferenceLinkColorDark                            = "linkColorDark"
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
	AppearanceMode                string                 `json:"appearanceMode"`
	UseShortResourceNames         bool                   `json:"useShortResourceNames"`
	DimInactiveNamespaces         *bool                  `json:"dimInactiveNamespaces,omitempty"`
	ExclusiveNamespaces           *bool                  `json:"exclusiveNamespaces,omitempty"`
	ErrorReportingEnabled         *bool                  `json:"errorReportingEnabled,omitempty"`
	Refresh                       *settingsRefresh       `json:"refresh"`
	KubernetesAPI                 *settingsKubernetesAPI `json:"kubernetesAPI,omitempty"`
	ObjPanelLogs                  *settingsObjPanelLogs  `json:"objPanelLogs,omitempty"`
	GridTablePersistenceMode      string                 `json:"gridTablePersistenceMode"`
	DefaultTablePageSize          int                    `json:"defaultTablePageSize"`
	DefaultObjectPanelPosition    string                 `json:"defaultObjectPanelPosition"`
	ObjectPanelDockedRightWidth   int                    `json:"objectPanelDockedRightWidth"`
	ObjectPanelDockedBottomHeight int                    `json:"objectPanelDockedBottomHeight"`
	ObjectPanelFloatingWidth      int                    `json:"objectPanelFloatingWidth"`
	ObjectPanelFloatingHeight     int                    `json:"objectPanelFloatingHeight"`

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
	Background        bool `json:"background"`
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

// Object Panel Logs Tab buffer size bounds. The frontend clamps to the same
// range, so the client can't push values outside these limits; clamping again
// in the setter is defence in depth.
const (
	defaultObjPanelLogsBufferMaxSize       = 1000
	minObjPanelLogsBufferMaxSize           = 100
	maxObjPanelLogsBufferMaxSize           = 10000
	defaultObjPanelLogsAPITimestampFormat  = "YYYY-MM-DDTHH:mm:ss.SSS[Z]"
	defaultObjPanelLogsTargetPerScopeLimit = containerlogs.DefaultPerScopeTargetLimit
	minObjPanelLogsTargetPerScopeLimit     = containerlogs.MinPerScopeTargetLimit
	maxObjPanelLogsTargetPerScopeLimit     = containerlogs.MaxPerScopeTargetLimit
	defaultObjPanelLogsTargetGlobalLimit   = config.ContainerLogsStreamGlobalTargetLimit
	minObjPanelLogsTargetGlobalLimit       = 1
	maxObjPanelLogsTargetGlobalLimit       = 1000
	defaultKubernetesClientQPS             = config.KubernetesClientQPS
	minKubernetesClientQPS                 = 1
	maxKubernetesClientQPS                 = 5000
	defaultKubernetesClientBurst           = config.KubernetesClientBurst
	minKubernetesClientBurst               = 1
	maxKubernetesClientBurst               = 10000
	defaultPermissionSSRRFetchConcurrency  = config.PermissionSSRRFetchConcurrency
	minPermissionSSRRFetchConcurrency      = 1
	maxPermissionSSRRFetchConcurrency      = config.PermissionSSRRFetchConcurrency * 8
	// Sanity bounds only — the selectable page-size values are owned by the
	// frontend's shared TABLE_PAGE_SIZE_OPTIONS list (one source for the
	// pagination footers and the Settings dropdown).
	defaultTablePageSize                 = 50
	minTablePageSize                     = 1
	maxTablePageSize                     = 1000
	defaultObjectPanelPosition           = "right"
	defaultObjectPanelDockedRightWidth   = 600
	defaultObjectPanelDockedBottomHeight = 600
	defaultObjectPanelFloatingWidth      = 600
	defaultObjectPanelFloatingHeight     = 800
	minObjectPanelDockedRightWidth       = 500
	minObjectPanelDockedBottomHeight     = 200
	minObjectPanelFloatingWidth          = 450
	minObjectPanelFloatingHeight         = 200
	maxObjectPanelLayoutValue            = 9999
	minPaletteHue                        = 0
	maxPaletteHue                        = 360
	minPaletteSaturation                 = 0
	maxPaletteSaturation                 = 100
	minPaletteBrightness                 = -50
	maxPaletteBrightness                 = 50
)

func clampKubernetesClientQPS(qps int) int {
	return clampInt(qps, minKubernetesClientQPS, maxKubernetesClientQPS)
}

func clampKubernetesClientBurst(burst int) int {
	return clampInt(burst, minKubernetesClientBurst, maxKubernetesClientBurst)
}

func clampPermissionSSRRFetchConcurrency(limit int) int {
	return clampInt(limit, minPermissionSSRRFetchConcurrency, maxPermissionSSRRFetchConcurrency)
}

func clampObjPanelLogsBufferMaxSize(size int) int {
	return clampInt(size, minObjPanelLogsBufferMaxSize, maxObjPanelLogsBufferMaxSize)
}

func clampObjPanelLogsTargetPerScopeLimit(limit int) int {
	return clampInt(limit, minObjPanelLogsTargetPerScopeLimit, maxObjPanelLogsTargetPerScopeLimit)
}

func clampObjPanelLogsTargetGlobalLimit(limit int) int {
	return clampInt(limit, minObjPanelLogsTargetGlobalLimit, maxObjPanelLogsTargetGlobalLimit)
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
	return &settingsFile{
		SchemaVersion: settingsSchemaVersion,
		UpdatedAt:     time.Now().UTC(),
		Preferences: settingsPreferences{
			AppearanceMode:        "system",
			DimInactiveNamespaces: boolPtr(true),
			ExclusiveNamespaces:   boolPtr(true),
			ErrorReportingEnabled: boolPtr(true),
			Refresh:               &settingsRefresh{Auto: true, Background: true, MetricsIntervalMs: defaultMetricsIntervalMs()},
			KubernetesAPI: &settingsKubernetesAPI{
				ClientQPS:                      defaultKubernetesClientQPS,
				ClientBurst:                    defaultKubernetesClientBurst,
				PermissionSSRRFetchConcurrency: defaultPermissionSSRRFetchConcurrency,
			},
			ObjPanelLogs: &settingsObjPanelLogs{
				BufferMaxSize:       defaultObjPanelLogsBufferMaxSize,
				TargetPerScopeLimit: defaultObjPanelLogsTargetPerScopeLimit,
				TargetGlobalLimit:   defaultObjPanelLogsTargetGlobalLimit,
				APITimestampFormat:  defaultObjPanelLogsAPITimestampFormat,
			},

			GridTablePersistenceMode:      "shared",
			DefaultTablePageSize:          defaultTablePageSize,
			DefaultObjectPanelPosition:    defaultObjectPanelPosition,
			ObjectPanelDockedRightWidth:   defaultObjectPanelDockedRightWidth,
			ObjectPanelDockedBottomHeight: defaultObjectPanelDockedBottomHeight,
			ObjectPanelFloatingWidth:      defaultObjectPanelFloatingWidth,
			ObjectPanelFloatingHeight:     defaultObjectPanelFloatingHeight,
			Themes:                        []Theme{defaultTheme()},
		},
		Kubeconfig: settingsKubeconfig{
			SearchPaths: defaultKubeconfigSearchPaths(),
		},
	}
}

// normalizeSettingsFile ensures required defaults are present after loading.
func normalizeSettingsFile(settings *settingsFile) *settingsFile {
	if settings == nil {
		return defaultSettingsFile()
	}
	normalizeSettingsMetadata(settings)
	normalizeCorePreferences(&settings.Preferences)
	normalizeRefreshPreferences(&settings.Preferences)
	normalizeKubernetesAPIPreferences(&settings.Preferences)
	normalizeObjPanelLogsPreferences(&settings.Preferences)
	normalizeLayoutPreferences(&settings.Preferences)
	migrateLegacyPalettePreferences(&settings.Preferences)
	normalizeKubeconfigSettings(&settings.Kubeconfig)
	settings.Preferences.Themes = normalizeThemes(
		settings.Preferences.Themes,
		defaultThemeFromPreferences(settings.Preferences),
	)

	return settings
}

func normalizeSettingsMetadata(settings *settingsFile) {
	if settings.SchemaVersion == 0 {
		settings.SchemaVersion = settingsSchemaVersion
	}
}

func normalizeCorePreferences(preferences *settingsPreferences) {
	if preferences.AppearanceMode == "" {
		preferences.AppearanceMode = "system"
	}
	if preferences.DimInactiveNamespaces == nil {
		preferences.DimInactiveNamespaces = boolPtr(true)
	}
	if preferences.ExclusiveNamespaces == nil {
		preferences.ExclusiveNamespaces = boolPtr(true)
	}
	if preferences.ErrorReportingEnabled == nil {
		preferences.ErrorReportingEnabled = boolPtr(true)
	}
}

func normalizeRefreshPreferences(preferences *settingsPreferences) {
	if preferences.Refresh == nil {
		preferences.Refresh = &settingsRefresh{Auto: true, Background: true, MetricsIntervalMs: defaultMetricsIntervalMs()}
	}
	if preferences.Refresh.MetricsIntervalMs <= 0 {
		preferences.Refresh.MetricsIntervalMs = defaultMetricsIntervalMs()
	}
}

func normalizeKubernetesAPIPreferences(preferences *settingsPreferences) {
	if preferences.KubernetesAPI == nil {
		preferences.KubernetesAPI = &settingsKubernetesAPI{
			ClientQPS:                      defaultKubernetesClientQPS,
			ClientBurst:                    defaultKubernetesClientBurst,
			PermissionSSRRFetchConcurrency: defaultPermissionSSRRFetchConcurrency,
		}
	}
	api := preferences.KubernetesAPI
	api.ClientQPS = defaultOrClampInt(api.ClientQPS, defaultKubernetesClientQPS, minKubernetesClientQPS, maxKubernetesClientQPS)
	api.ClientBurst = defaultOrClampInt(api.ClientBurst, defaultKubernetesClientBurst, minKubernetesClientBurst, maxKubernetesClientBurst)
	api.PermissionSSRRFetchConcurrency = defaultOrClampInt(
		api.PermissionSSRRFetchConcurrency,
		defaultPermissionSSRRFetchConcurrency,
		minPermissionSSRRFetchConcurrency,
		maxPermissionSSRRFetchConcurrency,
	)
}

func normalizeObjPanelLogsPreferences(preferences *settingsPreferences) {
	if preferences.ObjPanelLogs == nil {
		preferences.ObjPanelLogs = &settingsObjPanelLogs{
			BufferMaxSize:       defaultObjPanelLogsBufferMaxSize,
			TargetPerScopeLimit: defaultObjPanelLogsTargetPerScopeLimit,
			TargetGlobalLimit:   defaultObjPanelLogsTargetGlobalLimit,
			APITimestampFormat:  defaultObjPanelLogsAPITimestampFormat,
		}
	}
	// A zero value means "use the default", not "truncate every buffer to 0".
	logs := preferences.ObjPanelLogs
	logs.BufferMaxSize = defaultOrClampInt(logs.BufferMaxSize, defaultObjPanelLogsBufferMaxSize, minObjPanelLogsBufferMaxSize, maxObjPanelLogsBufferMaxSize)
	logs.TargetPerScopeLimit = defaultOrClampInt(logs.TargetPerScopeLimit, defaultObjPanelLogsTargetPerScopeLimit, minObjPanelLogsTargetPerScopeLimit, maxObjPanelLogsTargetPerScopeLimit)
	logs.TargetGlobalLimit = defaultOrClampInt(logs.TargetGlobalLimit, defaultObjPanelLogsTargetGlobalLimit, minObjPanelLogsTargetGlobalLimit, maxObjPanelLogsTargetGlobalLimit)
	if logs.APITimestampFormat == "" {
		logs.APITimestampFormat = defaultObjPanelLogsAPITimestampFormat
	}
}

func normalizeLayoutPreferences(preferences *settingsPreferences) {
	if preferences.GridTablePersistenceMode == "" {
		preferences.GridTablePersistenceMode = "shared"
	}
	if preferences.DefaultObjectPanelPosition == "" {
		preferences.DefaultObjectPanelPosition = defaultObjectPanelPosition
	}
	preferences.DefaultTablePageSize = defaultOrClampInt(preferences.DefaultTablePageSize, defaultTablePageSize, minTablePageSize, maxTablePageSize)
	preferences.ObjectPanelDockedRightWidth = defaultOrClampInt(preferences.ObjectPanelDockedRightWidth, defaultObjectPanelDockedRightWidth, minObjectPanelDockedRightWidth, maxObjectPanelLayoutValue)
	preferences.ObjectPanelDockedBottomHeight = defaultOrClampInt(preferences.ObjectPanelDockedBottomHeight, defaultObjectPanelDockedBottomHeight, minObjectPanelDockedBottomHeight, maxObjectPanelLayoutValue)
	preferences.ObjectPanelFloatingWidth = defaultOrClampInt(preferences.ObjectPanelFloatingWidth, defaultObjectPanelFloatingWidth, minObjectPanelFloatingWidth, maxObjectPanelLayoutValue)
	preferences.ObjectPanelFloatingHeight = defaultOrClampInt(preferences.ObjectPanelFloatingHeight, defaultObjectPanelFloatingHeight, minObjectPanelFloatingHeight, maxObjectPanelLayoutValue)
}

func defaultOrClampInt(value, defaultValue, minValue, maxValue int) int {
	if value <= 0 {
		return defaultValue
	}
	return clampInt(value, minValue, maxValue)
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

func defaultMetricsIntervalMs() int {
	return int(config.RefreshMetricsInterval / time.Millisecond)
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
	return &AppSettings{
		AppearanceMode:                           "system",
		SelectedKubeconfigs:                      nil,
		UseShortResourceNames:                    false,
		DimInactiveNamespaces:                    true,
		ExclusiveNamespaces:                      true,
		ErrorReportingEnabled:                    true,
		AutoRefreshEnabled:                       true,
		RefreshBackgroundClustersEnabled:         true,
		MetricsRefreshIntervalMs:                 defaultMetricsIntervalMs(),
		KubernetesClientQPS:                      defaultKubernetesClientQPS,
		KubernetesClientBurst:                    defaultKubernetesClientBurst,
		PermissionSSRRFetchConcurrency:           defaultPermissionSSRRFetchConcurrency,
		ObjPanelLogsBufferMaxSize:                defaultObjPanelLogsBufferMaxSize,
		ObjPanelLogsTargetPerScopeLimit:          defaultObjPanelLogsTargetPerScopeLimit,
		ObjPanelLogsTargetGlobalLimit:            defaultObjPanelLogsTargetGlobalLimit,
		ObjPanelLogsAPITimestampFormat:           defaultObjPanelLogsAPITimestampFormat,
		ObjPanelLogsAPITimestampUseLocalTimeZone: false,
		GridTablePersistenceMode:                 "shared",
		DefaultTablePageSize:                     defaultTablePageSize,
		DefaultObjectPanelPosition:               defaultObjectPanelPosition,
		ObjectPanelDockedRightWidth:              defaultObjectPanelDockedRightWidth,
		ObjectPanelDockedBottomHeight:            defaultObjectPanelDockedBottomHeight,
		ObjectPanelFloatingWidth:                 defaultObjectPanelFloatingWidth,
		ObjectPanelFloatingHeight:                defaultObjectPanelFloatingHeight,
		Themes:                                   []Theme{defaultTheme()},
	}
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
	logSettings := resolveObjPanelLogSettings(settings.Preferences.ObjPanelLogs)
	kubernetesAPISettings := resolveKubernetesAPISettings(settings.Preferences.KubernetesAPI)

	return &AppSettings{
		AnonymizedID:                             settings.Telemetry.AnonymizedID,
		AppearanceMode:                           settings.Preferences.AppearanceMode,
		SelectedKubeconfigs:                      append([]string(nil), settings.Kubeconfig.Selected...),
		UseShortResourceNames:                    settings.Preferences.UseShortResourceNames,
		DimInactiveNamespaces:                    boolPreferenceOrDefault(settings.Preferences.DimInactiveNamespaces, true),
		ExclusiveNamespaces:                      boolPreferenceOrDefault(settings.Preferences.ExclusiveNamespaces, true),
		ErrorReportingEnabled:                    boolPreferenceOrDefault(settings.Preferences.ErrorReportingEnabled, true),
		AutoRefreshEnabled:                       settings.Preferences.Refresh.Auto,
		RefreshBackgroundClustersEnabled:         settings.Preferences.Refresh.Background,
		MetricsRefreshIntervalMs:                 settings.Preferences.Refresh.MetricsIntervalMs,
		KubernetesClientQPS:                      kubernetesAPISettings.clientQPS,
		KubernetesClientBurst:                    kubernetesAPISettings.clientBurst,
		PermissionSSRRFetchConcurrency:           kubernetesAPISettings.permissionSSRRFetchConcurrency,
		ObjPanelLogsBufferMaxSize:                logSettings.bufferMaxSize,
		ObjPanelLogsTargetPerScopeLimit:          logSettings.targetPerScopeLimit,
		ObjPanelLogsTargetGlobalLimit:            logSettings.targetGlobalLimit,
		ObjPanelLogsAPITimestampFormat:           logSettings.apiTimestampFormat,
		ObjPanelLogsAPITimestampUseLocalTimeZone: logSettings.useLocalTimeZone,
		GridTablePersistenceMode:                 settings.Preferences.GridTablePersistenceMode,
		DefaultTablePageSize:                     settings.Preferences.DefaultTablePageSize,
		DefaultObjectPanelPosition:               settings.Preferences.DefaultObjectPanelPosition,
		ObjectPanelDockedRightWidth:              settings.Preferences.ObjectPanelDockedRightWidth,
		ObjectPanelDockedBottomHeight:            settings.Preferences.ObjectPanelDockedBottomHeight,
		ObjectPanelFloatingWidth:                 settings.Preferences.ObjectPanelFloatingWidth,
		ObjectPanelFloatingHeight:                settings.Preferences.ObjectPanelFloatingHeight,
		PaletteHueLight:                          settings.Preferences.PaletteHueLight,
		PaletteSaturationLight:                   settings.Preferences.PaletteSaturationLight,
		PaletteBrightnessLight:                   settings.Preferences.PaletteBrightnessLight,
		PaletteHueDark:                           settings.Preferences.PaletteHueDark,
		PaletteSaturationDark:                    settings.Preferences.PaletteSaturationDark,
		PaletteBrightnessDark:                    settings.Preferences.PaletteBrightnessDark,
		AccentColorLight:                         settings.Preferences.AccentColorLight,
		AccentColorDark:                          settings.Preferences.AccentColorDark,
		LinkColorLight:                           settings.Preferences.LinkColorLight,
		LinkColorDark:                            settings.Preferences.LinkColorDark,
		Themes:                                   settings.Preferences.Themes,
	}
}

type resolvedObjPanelLogSettings struct {
	bufferMaxSize       int
	targetPerScopeLimit int
	targetGlobalLimit   int
	apiTimestampFormat  string
	useLocalTimeZone    bool
}

func resolveObjPanelLogSettings(settings *settingsObjPanelLogs) resolvedObjPanelLogSettings {
	resolved := resolvedObjPanelLogSettings{
		bufferMaxSize:       defaultObjPanelLogsBufferMaxSize,
		targetPerScopeLimit: defaultObjPanelLogsTargetPerScopeLimit,
		targetGlobalLimit:   defaultObjPanelLogsTargetGlobalLimit,
		apiTimestampFormat:  defaultObjPanelLogsAPITimestampFormat,
	}
	if settings == nil {
		return resolved
	}
	if settings.BufferMaxSize > 0 {
		resolved.bufferMaxSize = clampObjPanelLogsBufferMaxSize(settings.BufferMaxSize)
	}
	if settings.TargetPerScopeLimit > 0 {
		resolved.targetPerScopeLimit = clampObjPanelLogsTargetPerScopeLimit(settings.TargetPerScopeLimit)
	}
	if settings.TargetGlobalLimit > 0 {
		resolved.targetGlobalLimit = clampObjPanelLogsTargetGlobalLimit(settings.TargetGlobalLimit)
	}
	if settings.APITimestampFormat != "" {
		resolved.apiTimestampFormat = settings.APITimestampFormat
	}
	resolved.useLocalTimeZone = settings.UseLocalTimeZone
	return resolved
}

type resolvedKubernetesAPISettings struct {
	clientQPS                      int
	clientBurst                    int
	permissionSSRRFetchConcurrency int
}

func resolveKubernetesAPISettings(settings *settingsKubernetesAPI) resolvedKubernetesAPISettings {
	resolved := resolvedKubernetesAPISettings{
		clientQPS:                      defaultKubernetesClientQPS,
		clientBurst:                    defaultKubernetesClientBurst,
		permissionSSRRFetchConcurrency: defaultPermissionSSRRFetchConcurrency,
	}
	if settings == nil {
		return resolved
	}
	if settings.ClientQPS > 0 {
		resolved.clientQPS = clampKubernetesClientQPS(settings.ClientQPS)
	}
	if settings.ClientBurst > 0 {
		resolved.clientBurst = clampKubernetesClientBurst(settings.ClientBurst)
	}
	if settings.PermissionSSRRFetchConcurrency > 0 {
		resolved.permissionSSRRFetchConcurrency = clampPermissionSSRRFetchConcurrency(settings.PermissionSSRRFetchConcurrency)
	}
	return resolved
}

func boolPreferenceOrDefault(value *bool, fallback bool) bool {
	if value == nil {
		return fallback
	}
	return *value
}

func (p *PreferencesService) saveAppSettings() error {
	if p.appSettings == nil {
		return fmt.Errorf("no app settings to save")
	}

	settings, err := p.loadSettingsFile()
	if err != nil {
		return err
	}

	settings.Preferences.AppearanceMode = p.appSettings.AppearanceMode
	settings.Preferences.UseShortResourceNames = p.appSettings.UseShortResourceNames
	settings.Preferences.DimInactiveNamespaces = boolPtr(p.appSettings.DimInactiveNamespaces)
	settings.Preferences.ExclusiveNamespaces = boolPtr(p.appSettings.ExclusiveNamespaces)
	settings.Preferences.ErrorReportingEnabled = boolPtr(p.appSettings.ErrorReportingEnabled)
	if settings.Preferences.Refresh == nil {
		settings.Preferences.Refresh = &settingsRefresh{}
	}
	settings.Preferences.Refresh.Auto = p.appSettings.AutoRefreshEnabled
	settings.Preferences.Refresh.Background = p.appSettings.RefreshBackgroundClustersEnabled
	settings.Preferences.Refresh.MetricsIntervalMs = p.appSettings.MetricsRefreshIntervalMs
	if settings.Preferences.KubernetesAPI == nil {
		settings.Preferences.KubernetesAPI = &settingsKubernetesAPI{}
	}
	settings.Preferences.KubernetesAPI.ClientQPS = clampKubernetesClientQPS(p.appSettings.KubernetesClientQPS)
	settings.Preferences.KubernetesAPI.ClientBurst = clampKubernetesClientBurst(p.appSettings.KubernetesClientBurst)
	settings.Preferences.KubernetesAPI.PermissionSSRRFetchConcurrency = clampPermissionSSRRFetchConcurrency(p.appSettings.PermissionSSRRFetchConcurrency)
	if settings.Preferences.ObjPanelLogs == nil {
		settings.Preferences.ObjPanelLogs = &settingsObjPanelLogs{}
	}
	settings.Preferences.ObjPanelLogs.BufferMaxSize = clampObjPanelLogsBufferMaxSize(p.appSettings.ObjPanelLogsBufferMaxSize)
	settings.Preferences.ObjPanelLogs.TargetPerScopeLimit = clampObjPanelLogsTargetPerScopeLimit(p.appSettings.ObjPanelLogsTargetPerScopeLimit)
	settings.Preferences.ObjPanelLogs.TargetGlobalLimit = clampObjPanelLogsTargetGlobalLimit(p.appSettings.ObjPanelLogsTargetGlobalLimit)
	if p.appSettings.ObjPanelLogsAPITimestampFormat == "" {
		settings.Preferences.ObjPanelLogs.APITimestampFormat = defaultObjPanelLogsAPITimestampFormat
	} else {
		settings.Preferences.ObjPanelLogs.APITimestampFormat = p.appSettings.ObjPanelLogsAPITimestampFormat
	}
	settings.Preferences.ObjPanelLogs.UseLocalTimeZone = p.appSettings.ObjPanelLogsAPITimestampUseLocalTimeZone
	settings.Preferences.GridTablePersistenceMode = p.appSettings.GridTablePersistenceMode
	settings.Preferences.DefaultTablePageSize = p.appSettings.DefaultTablePageSize
	settings.Preferences.DefaultObjectPanelPosition = p.appSettings.DefaultObjectPanelPosition
	settings.Preferences.ObjectPanelDockedRightWidth = p.appSettings.ObjectPanelDockedRightWidth
	settings.Preferences.ObjectPanelDockedBottomHeight = p.appSettings.ObjectPanelDockedBottomHeight
	settings.Preferences.ObjectPanelFloatingWidth = p.appSettings.ObjectPanelFloatingWidth
	settings.Preferences.ObjectPanelFloatingHeight = p.appSettings.ObjectPanelFloatingHeight
	// Write per-mode palette fields; leave old fields zeroed so omitempty drops them.
	settings.Preferences.PaletteHueLight = p.appSettings.PaletteHueLight
	settings.Preferences.PaletteSaturationLight = p.appSettings.PaletteSaturationLight
	settings.Preferences.PaletteBrightnessLight = p.appSettings.PaletteBrightnessLight
	settings.Preferences.PaletteHueDark = p.appSettings.PaletteHueDark
	settings.Preferences.PaletteSaturationDark = p.appSettings.PaletteSaturationDark
	settings.Preferences.PaletteBrightnessDark = p.appSettings.PaletteBrightnessDark
	settings.Preferences.AccentColorLight = p.appSettings.AccentColorLight
	settings.Preferences.AccentColorDark = p.appSettings.AccentColorDark
	settings.Preferences.LinkColorLight = p.appSettings.LinkColorLight
	settings.Preferences.LinkColorDark = p.appSettings.LinkColorDark
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

func intPtr(v int) *int {
	return &v
}

func (p *PreferencesService) GetAppSettingsSchema() (*AppSettingsSchema, error) {
	settings, err := p.GetAppSettings()
	if err != nil {
		return nil, err
	}
	schema := buildAppSettingsSchema(settings)
	schema.AnonymizedID = settings.AnonymizedID
	return schema, nil
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

func boolPreferenceValue(value any) (bool, error) {
	v, ok := value.(bool)
	if !ok {
		return false, fmt.Errorf("expected boolean value")
	}
	return v, nil
}

func stringPreferenceValue(value any) (string, error) {
	v, ok := value.(string)
	if !ok {
		return "", fmt.Errorf("expected string value")
	}
	return v, nil
}

func intPreferenceValue(value any) (int, error) {
	switch v := value.(type) {
	case int:
		return v, nil
	case int8:
		return int(v), nil
	case int16:
		return int(v), nil
	case int32:
		return int(v), nil
	case int64:
		return int(v), nil
	case float64:
		return int(v), nil
	case float32:
		return int(v), nil
	case json.Number:
		i, err := v.Int64()
		return int(i), err
	default:
		return 0, fmt.Errorf("expected integer value")
	}
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

func clampInt(value, minValue, maxValue int) int {
	if value < minValue {
		return minValue
	}
	if value > maxValue {
		return maxValue
	}
	return value
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

// GetZoomLevel returns the persisted zoom level (50-200), defaulting to 100.
func (p *PreferencesService) GetZoomLevel() int {
	settings, err := p.loadSettingsFile()
	if err != nil {
		return 100
	}

	level := settings.UI.ZoomLevel
	if level < 50 || level > 200 {
		return 100
	}
	return level
}

// SetZoomLevel persists the zoom level (clamped to 50-200).
func (p *PreferencesService) SetZoomLevel(level int) error {
	// Clamp to valid range
	if level < 50 {
		level = 50
	}
	if level > 200 {
		level = 200
	}

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

	p.settingsMu.Lock()
	defer p.settingsMu.Unlock()

	settings, err := p.loadSettingsFile()
	if err != nil {
		return fmt.Errorf("loading settings: %w", err)
	}

	found := false
	for i, t := range settings.Preferences.Themes {
		if t.ID == theme.ID {
			settings.Preferences.Themes[i] = theme
			found = true
			break
		}
	}
	if !found {
		if themeIsDefault {
			settings.Preferences.Themes = append(settings.Preferences.Themes, theme)
		} else {
			defaultThemeValue := settings.Preferences.Themes[len(settings.Preferences.Themes)-1]
			settings.Preferences.Themes = append(
				append(settings.Preferences.Themes[:len(settings.Preferences.Themes)-1], theme),
				defaultThemeValue,
			)
		}
	}
	settings.Preferences.Themes = normalizeThemes(settings.Preferences.Themes, defaultTheme())

	if err := p.saveSettingsFile(settings); err != nil {
		return err
	}
	p.syncThemesCacheLocked(settings.Preferences.Themes)
	return nil
}

// DeleteTheme removes a theme from the library by ID.
func (p *PreferencesService) DeleteTheme(id string) error {
	if id == defaultThemeID {
		return fmt.Errorf("default theme cannot be deleted")
	}

	p.settingsMu.Lock()
	defer p.settingsMu.Unlock()

	settings, err := p.loadSettingsFile()
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
	settings.Preferences.Themes = normalizeThemes(settings.Preferences.Themes, defaultTheme())

	if err := p.saveSettingsFile(settings); err != nil {
		return err
	}
	p.syncThemesCacheLocked(settings.Preferences.Themes)
	return nil
}

// ReorderThemes sets the theme ordering. The ids slice must contain exactly the
// same IDs as the current theme list (first-match priority depends on order).
func (p *PreferencesService) ReorderThemes(ids []string) error {
	p.settingsMu.Lock()
	defer p.settingsMu.Unlock()

	settings, err := p.loadSettingsFile()
	if err != nil {
		return fmt.Errorf("loading settings: %w", err)
	}

	if len(ids) != len(settings.Preferences.Themes) {
		return fmt.Errorf("id count mismatch: got %d, have %d themes", len(ids), len(settings.Preferences.Themes))
	}
	if len(ids) == 0 || ids[len(ids)-1] != defaultThemeID {
		return fmt.Errorf("default theme must remain last")
	}

	byID := make(map[string]Theme, len(settings.Preferences.Themes))
	for _, t := range settings.Preferences.Themes {
		byID[t.ID] = t
	}

	reordered := make([]Theme, 0, len(ids))
	for _, id := range ids {
		t, ok := byID[id]
		if !ok {
			return fmt.Errorf("unknown theme ID: %s", id)
		}
		reordered = append(reordered, t)
	}

	settings.Preferences.Themes = normalizeThemes(reordered, defaultTheme())
	if err := p.saveSettingsFile(settings); err != nil {
		return err
	}
	p.syncThemesCacheLocked(settings.Preferences.Themes)
	return nil
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

	if err := p.saveSettingsFile(settings); err != nil {
		return err
	}

	// Sync the in-memory cache so saveAppSettings doesn't overwrite with stale data.
	if p.appSettings != nil {
		p.appSettings.PaletteHueLight = theme.PaletteHueLight
		p.appSettings.PaletteSaturationLight = theme.PaletteSaturationLight
		p.appSettings.PaletteBrightnessLight = theme.PaletteBrightnessLight
		p.appSettings.PaletteHueDark = theme.PaletteHueDark
		p.appSettings.PaletteSaturationDark = theme.PaletteSaturationDark
		p.appSettings.PaletteBrightnessDark = theme.PaletteBrightnessDark
		p.appSettings.AccentColorLight = theme.AccentColorLight
		p.appSettings.AccentColorDark = theme.AccentColorDark
		p.appSettings.LinkColorLight = theme.LinkColorLight
		p.appSettings.LinkColorDark = theme.LinkColorDark
		p.appSettings.Themes = append([]Theme(nil), settings.Preferences.Themes...)
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
