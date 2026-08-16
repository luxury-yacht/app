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
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

const settingsSchemaVersion = 1

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
	appPreferenceObjectPanelFloatingX                     = "objectPanelFloatingX"
	appPreferenceObjectPanelFloatingY                     = "objectPanelFloatingY"
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
	// (docs/plans/namespace-scope.md). Empty means no scope: every namespaced
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
	ObjectPanelFloatingX          int                    `json:"objectPanelFloatingX"`
	ObjectPanelFloatingY          int                    `json:"objectPanelFloatingY"`

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
		// TODO: Remove after the old preferences.theme settings format is no longer supported.
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
	defaultObjectPanelDockedBottomHeight = 400
	defaultObjectPanelFloatingWidth      = 500
	defaultObjectPanelFloatingHeight     = 400
	defaultObjectPanelFloatingX          = 100
	defaultObjectPanelFloatingY          = 100
	minObjectPanelDockedRightWidth       = 500
	minObjectPanelDockedBottomHeight     = 200
	minObjectPanelFloatingWidth          = 450
	minObjectPanelFloatingHeight         = 200
	minObjectPanelFloatingX              = 1
	minObjectPanelFloatingY              = 1
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
			ObjectPanelFloatingX:          defaultObjectPanelFloatingX,
			ObjectPanelFloatingY:          defaultObjectPanelFloatingY,
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
	preferences.ObjectPanelFloatingX = defaultOrClampInt(preferences.ObjectPanelFloatingX, defaultObjectPanelFloatingX, minObjectPanelFloatingX, maxObjectPanelLayoutValue)
	preferences.ObjectPanelFloatingY = defaultOrClampInt(preferences.ObjectPanelFloatingY, defaultObjectPanelFloatingY, minObjectPanelFloatingY, maxObjectPanelLayoutValue)
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
func (a *App) getSettingsFilePath() (string, error) {
	configDir, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("could not find config directory: %w", err)
	}
	configDir = filepath.Join(configDir, "luxury-yacht")
	return filepath.Join(configDir, "settings.json"), nil
}

// cacheDirPath returns the app's cache directory (<UserCacheDir>/luxury-yacht):
// the single home for transient on-disk caches (API discovery, maintained-store
// spill, diagnostic dumps). It is the cache-tier sibling of the config dir and
// the one place that defines the cache base, so Factory Reset can clear the
// whole subtree in one call.
func (a *App) cacheDirPath() (string, error) {
	cacheDir, err := os.UserCacheDir()
	if err != nil {
		return "", fmt.Errorf("could not find cache directory: %w", err)
	}
	return filepath.Join(cacheDir, "luxury-yacht"), nil
}

// loadSettingsFile reads settings.json or returns defaults when missing.
func (a *App) loadSettingsFile() (*settingsFile, error) {
	configFile, err := a.getSettingsFilePath()
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
func (a *App) saveSettingsFile(settings *settingsFile) error {
	if settings == nil {
		return fmt.Errorf("no settings to save")
	}

	settings = normalizeSettingsFile(settings)
	if _, err := ensureAnonymizedID(settings); err != nil {
		return err
	}
	configFile, err := a.getSettingsFilePath()
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
	tempFile, err := os.CreateTemp(dir, ".tmp-*")
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

//wails:ignore
func (a *App) SaveWindowSettings() error {
	if a != nil && a.windowGeometry != nil {
		return a.SaveWindowSettingsForWindow("")
	}
	window, err := a.currentWindowWhenReady()
	if err != nil {
		return err
	}
	return a.SaveWindowSettingsForWindow(window.Name())
}

// SaveWindowSettingsForWindow persists the geometry of a named peer as the
// next session's initial geometry.
//
//wails:ignore
func (a *App) SaveWindowSettingsForWindow(windowName string) error {
	if !a.runtimeAvailable() {
		return fmt.Errorf("application context is not available")
	}
	geometry, err := a.readWindowGeometry(windowName)
	if err != nil {
		return fmt.Errorf("read window %q geometry: %w", windowName, err)
	}
	a.windowSettings = &WindowSettings{
		X:         geometry.X,
		Y:         geometry.Y,
		Width:     geometry.Width,
		Height:    geometry.Height,
		Maximized: geometry.Maximised,
	}

	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()

	settings, err := a.loadSettingsFile()
	if err != nil {
		return err
	}

	settings.UI.Window = *a.windowSettings
	if a.appSettings != nil {
		settings.Kubeconfig.Selected = append([]string(nil), a.appSettings.SelectedKubeconfigs...)
	}
	return a.saveSettingsFile(settings)
}

//wails:ignore
func (a *App) LoadWindowSettings() (*WindowSettings, error) {
	settings, err := a.loadSettingsFile()
	if err != nil {
		return nil, err
	}

	window := settings.UI.Window
	if window.Width <= 0 || window.Height <= 0 {
		window.Width = 1200
		window.Height = 800
	}

	a.windowSettings = &window
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
		ObjectPanelFloatingX:                     defaultObjectPanelFloatingX,
		ObjectPanelFloatingY:                     defaultObjectPanelFloatingY,
		Themes:                                   []Theme{defaultTheme()},
	}
}

func (a *App) loadAppSettings() error {
	settings, err := a.loadSettingsFile()
	if err != nil {
		return err
	}
	created, err := ensureAnonymizedID(settings)
	if err != nil {
		return err
	}
	if created {
		if err := a.saveSettingsFile(settings); err != nil {
			return err
		}
	}
	a.appSettings = appSettingsFromFile(settings)

	logSettings := resolveObjPanelLogSettings(settings.Preferences.ObjPanelLogs)
	containerlogs.SetPerScopeTargetLimit(logSettings.targetPerScopeLimit)
	// The accessor guards the lazy init (subsystem builds run concurrently); creating
	// on demand here is correct — the limit then applies to the limiter every
	// subsystem receives.
	if limiter := a.sharedContainerLogsTargetLimiter(); limiter != nil {
		limiter.SetLimit(logSettings.targetGlobalLimit)
	}
	return nil
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
		ObjectPanelFloatingX:                     settings.Preferences.ObjectPanelFloatingX,
		ObjectPanelFloatingY:                     settings.Preferences.ObjectPanelFloatingY,
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

func (a *App) saveAppSettings() error {
	if a.appSettings == nil {
		return fmt.Errorf("no app settings to save")
	}

	settings, err := a.loadSettingsFile()
	if err != nil {
		return err
	}

	settings.Preferences.AppearanceMode = a.appSettings.AppearanceMode
	settings.Preferences.UseShortResourceNames = a.appSettings.UseShortResourceNames
	settings.Preferences.DimInactiveNamespaces = boolPtr(a.appSettings.DimInactiveNamespaces)
	settings.Preferences.ExclusiveNamespaces = boolPtr(a.appSettings.ExclusiveNamespaces)
	settings.Preferences.ErrorReportingEnabled = boolPtr(a.appSettings.ErrorReportingEnabled)
	if settings.Preferences.Refresh == nil {
		settings.Preferences.Refresh = &settingsRefresh{}
	}
	settings.Preferences.Refresh.Auto = a.appSettings.AutoRefreshEnabled
	settings.Preferences.Refresh.Background = a.appSettings.RefreshBackgroundClustersEnabled
	settings.Preferences.Refresh.MetricsIntervalMs = a.appSettings.MetricsRefreshIntervalMs
	if settings.Preferences.KubernetesAPI == nil {
		settings.Preferences.KubernetesAPI = &settingsKubernetesAPI{}
	}
	settings.Preferences.KubernetesAPI.ClientQPS = clampKubernetesClientQPS(a.appSettings.KubernetesClientQPS)
	settings.Preferences.KubernetesAPI.ClientBurst = clampKubernetesClientBurst(a.appSettings.KubernetesClientBurst)
	settings.Preferences.KubernetesAPI.PermissionSSRRFetchConcurrency = clampPermissionSSRRFetchConcurrency(a.appSettings.PermissionSSRRFetchConcurrency)
	if settings.Preferences.ObjPanelLogs == nil {
		settings.Preferences.ObjPanelLogs = &settingsObjPanelLogs{}
	}
	settings.Preferences.ObjPanelLogs.BufferMaxSize = clampObjPanelLogsBufferMaxSize(a.appSettings.ObjPanelLogsBufferMaxSize)
	settings.Preferences.ObjPanelLogs.TargetPerScopeLimit = clampObjPanelLogsTargetPerScopeLimit(a.appSettings.ObjPanelLogsTargetPerScopeLimit)
	settings.Preferences.ObjPanelLogs.TargetGlobalLimit = clampObjPanelLogsTargetGlobalLimit(a.appSettings.ObjPanelLogsTargetGlobalLimit)
	if a.appSettings.ObjPanelLogsAPITimestampFormat == "" {
		settings.Preferences.ObjPanelLogs.APITimestampFormat = defaultObjPanelLogsAPITimestampFormat
	} else {
		settings.Preferences.ObjPanelLogs.APITimestampFormat = a.appSettings.ObjPanelLogsAPITimestampFormat
	}
	settings.Preferences.ObjPanelLogs.UseLocalTimeZone = a.appSettings.ObjPanelLogsAPITimestampUseLocalTimeZone
	settings.Preferences.GridTablePersistenceMode = a.appSettings.GridTablePersistenceMode
	settings.Preferences.DefaultTablePageSize = a.appSettings.DefaultTablePageSize
	settings.Preferences.DefaultObjectPanelPosition = a.appSettings.DefaultObjectPanelPosition
	settings.Preferences.ObjectPanelDockedRightWidth = a.appSettings.ObjectPanelDockedRightWidth
	settings.Preferences.ObjectPanelDockedBottomHeight = a.appSettings.ObjectPanelDockedBottomHeight
	settings.Preferences.ObjectPanelFloatingWidth = a.appSettings.ObjectPanelFloatingWidth
	settings.Preferences.ObjectPanelFloatingHeight = a.appSettings.ObjectPanelFloatingHeight
	settings.Preferences.ObjectPanelFloatingX = a.appSettings.ObjectPanelFloatingX
	settings.Preferences.ObjectPanelFloatingY = a.appSettings.ObjectPanelFloatingY
	// Write per-mode palette fields; leave old fields zeroed so omitempty drops them.
	settings.Preferences.PaletteHueLight = a.appSettings.PaletteHueLight
	settings.Preferences.PaletteSaturationLight = a.appSettings.PaletteSaturationLight
	settings.Preferences.PaletteBrightnessLight = a.appSettings.PaletteBrightnessLight
	settings.Preferences.PaletteHueDark = a.appSettings.PaletteHueDark
	settings.Preferences.PaletteSaturationDark = a.appSettings.PaletteSaturationDark
	settings.Preferences.PaletteBrightnessDark = a.appSettings.PaletteBrightnessDark
	settings.Preferences.AccentColorLight = a.appSettings.AccentColorLight
	settings.Preferences.AccentColorDark = a.appSettings.AccentColorDark
	settings.Preferences.LinkColorLight = a.appSettings.LinkColorLight
	settings.Preferences.LinkColorDark = a.appSettings.LinkColorDark
	settings.Preferences.Themes = a.appSettings.Themes

	settings.Kubeconfig.Selected = append([]string(nil), a.appSettings.SelectedKubeconfigs...)

	return a.saveSettingsFile(settings)
}

// ClearAppState deletes persisted state files and resets in-memory caches for a clean restart.
func (a *App) ClearAppState() error {
	return a.runSelectionMutation("clear-app-state", func(_ *selectionMutation) error {
		if err := a.clearKubeconfigSelection(); err != nil {
			return err
		}
		// Registration holds this mutex through both the metric send and its
		// acknowledgement write. Waiting here makes that worker finish before
		// persisted settings are removed, so it cannot recreate a pre-reset ID.
		a.installationTelemetryMu.Lock()
		defer a.installationTelemetryMu.Unlock()
		errs := a.clearPersistedAppState()
		a.resetInMemoryAppState()
		if len(errs) > 0 {
			return fmt.Errorf("clear app state: %w", errs[0])
		}
		return nil
	})
}

func (a *App) clearPersistedAppState() []error {
	var errs []error
	errs = appendPathRemovalError(errs, a.getSettingsFilePath, removeFileIfExists)
	errs = appendPathRemovalError(errs, a.getPersistenceFilePath, removeFileIfExists)
	// clearKubeconfigSelection has already stopped cache writers before this removal.
	errs = appendPathRemovalError(errs, a.cacheDirPath, os.RemoveAll)
	return errs
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

func (a *App) resetInMemoryAppState() {
	a.settingsMu.Lock()
	a.appSettings = nil
	a.settingsMu.Unlock()
	a.windowSettings = nil
}

// removeFileIfExists ignores missing files so reset can be re-run safely.
func removeFileIfExists(path string) error {
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (a *App) GetAppSettings() (*AppSettings, error) {
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()

	if a.appSettings == nil {
		if err := a.loadAppSettings(); err != nil {
			return nil, err
		}
	}

	cp := *a.appSettings
	cp.SelectedKubeconfigs = append([]string(nil), a.appSettings.SelectedKubeconfigs...)
	cp.Themes = append([]Theme(nil), a.appSettings.Themes...)
	return &cp, nil
}

// InitializeErrorReporting applies the persisted preference before application
// startup can produce reportable errors. A settings read failure keeps the
// reporter disabled. This is a package-level startup function so Wails does not
// expose it as a frontend-callable App method.
func InitializeErrorReporting(a *App) error {
	if a == nil || a.errorReporter == nil {
		return nil
	}

	a.settingsMu.Lock()
	if a.appSettings == nil {
		if err := a.loadAppSettings(); err != nil {
			a.settingsMu.Unlock()
			_ = a.errorReporter.SetEnabled(false)
			return err
		}
	}
	enabled := a.appSettings.ErrorReportingEnabled
	a.settingsMu.Unlock()
	if err := a.errorReporter.SetEnabled(enabled); err != nil {
		return err
	}
	return nil
}

func intPtr(v int) *int {
	return &v
}

func (a *App) GetAppSettingsSchema() (*AppSettingsSchema, error) {
	settings, err := a.GetAppSettings()
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

func (a *App) UpdateAppPreferences(request UpdateAppPreferencesRequest) (*UpdateAppPreferencesResponse, error) {
	update, err := a.prepareAppPreferenceUpdate(request)
	if err != nil {
		return nil, err
	}
	a.applySettingsSideEffects(update)
	return &UpdateAppPreferencesResponse{Settings: update.settings, ChangedKeys: update.changedKeys}, nil
}

func (a *App) prepareAppPreferenceUpdate(request UpdateAppPreferencesRequest) (*preparedPreferenceUpdate, error) {
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()

	if a.appSettings == nil {
		if err := a.loadAppSettings(); err != nil {
			return nil, err
		}
	}

	previous := copyAppSettings(a.appSettings)
	next := copyAppSettings(a.appSettings)
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

	a.appSettings = next
	if err := a.saveAppSettings(); err != nil {
		a.appSettings = previous
		return nil, err
	}

	for _, key := range changedKeys {
		logPreferenceChange(a.logger, key, preferenceValueForLog(next, key))
	}

	return &preparedPreferenceUpdate{settings: copyAppSettings(next), changedKeys: changedKeys, effects: effects}, nil
}

func (a *App) applySettingsSideEffects(update *preparedPreferenceUpdate) {
	settings, effects := update.settings, update.effects
	a.applyErrorReportingSideEffect(effects.errorReporting, settings.ErrorReportingEnabled)
	a.applyKubernetesClientRateLimitsSideEffect(
		effects.kubernetesClientRateLimits,
		settings.KubernetesClientQPS,
		settings.KubernetesClientBurst,
	)
	applyContainerLogsPerScopeLimitSideEffect(
		effects.containerLogsPerScopeLimit,
		settings.ObjPanelLogsTargetPerScopeLimit,
	)
	a.applyContainerLogsGlobalLimitSideEffect(
		effects.containerLogsGlobalLimit,
		settings.ObjPanelLogsTargetGlobalLimit,
	)
	a.applyMetricsIntervalSideEffect(effects.metricsInterval, settings.MetricsRefreshIntervalMs)
}

func (a *App) applyErrorReportingSideEffect(apply, enabled bool) {
	if !apply || a.errorReporter == nil {
		return
	}
	if err := a.errorReporter.SetEnabled(enabled); err != nil {
		a.logger.Warn(fmt.Sprintf("Could not update error reporting: %v", err), logsources.Settings)
		return
	}
	if enabled {
		a.scheduleInstallationMetricRegistration(a.CtxOrBackground())
	}
}

func (a *App) applyKubernetesClientRateLimitsSideEffect(apply bool, qps int, burst int) {
	if !apply {
		return
	}
	a.applyKubernetesClientRateLimits(qps, burst)
}

func applyContainerLogsPerScopeLimitSideEffect(apply bool, limit int) {
	if !apply {
		return
	}
	containerlogs.SetPerScopeTargetLimit(limit)
}

func (a *App) applyContainerLogsGlobalLimitSideEffect(apply bool, limit int) {
	if !apply {
		return
	}
	if limiter := a.sharedContainerLogsTargetLimiter(); limiter != nil {
		limiter.SetLimit(limit)
	}
}

func setSubsystemMetricsInterval(subsystem *system.Subsystem, interval time.Duration) {
	if subsystem == nil {
		return
	}
	subsystem.Manager.SetMetricsInterval(interval)
}

func (a *App) applyMetricsIntervalSideEffect(apply bool, intervalMs int) {
	if !apply {
		return
	}
	// The metric cadence is server-owned (the doorbell rides collections):
	// retime every connected cluster's running poller live. Clusters that
	// connect later read the same setting at subsystem build.
	interval := time.Duration(intervalMs) * time.Millisecond
	for _, subsystem := range a.snapshotRefreshSubsystems() {
		setSubsystemMetricsInterval(subsystem, interval)
	}
}

func (a *App) kubernetesClientRateLimits() (qps int, burst int) {
	if a == nil {
		return defaultKubernetesClientQPS, defaultKubernetesClientBurst
	}
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()
	if a.appSettings == nil {
		return defaultKubernetesClientQPS, defaultKubernetesClientBurst
	}
	qps = a.appSettings.KubernetesClientQPS
	if qps <= 0 {
		qps = defaultKubernetesClientQPS
	}
	burst = a.appSettings.KubernetesClientBurst
	if burst <= 0 {
		burst = defaultKubernetesClientBurst
	}
	return clampKubernetesClientQPS(qps), clampKubernetesClientBurst(burst)
}

func (a *App) permissionSSRRFetchConcurrency() int {
	if a == nil {
		return defaultPermissionSSRRFetchConcurrency
	}
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()
	if a.appSettings == nil || a.appSettings.PermissionSSRRFetchConcurrency <= 0 {
		return defaultPermissionSSRRFetchConcurrency
	}
	return clampPermissionSSRRFetchConcurrency(a.appSettings.PermissionSSRRFetchConcurrency)
}

//wails:ignore
func (a *App) SetAppearanceMode(mode string) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceAppearanceMode, Value: mode}}})
	return err
}

//wails:ignore
func (a *App) SetUseShortResourceNames(useShort bool) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceUseShortResourceNames, Value: useShort}}})
	return err
}

//wails:ignore
func (a *App) SetDimInactiveNamespaces(enabled bool) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceDimInactiveNamespaces, Value: enabled}}})
	return err
}

//wails:ignore
func (a *App) SetExclusiveNamespaces(enabled bool) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceExclusiveNamespaces, Value: enabled}}})
	return err
}

// SetAutoRefreshEnabled persists the auto-refresh preference.
//
//wails:ignore
func (a *App) SetAutoRefreshEnabled(enabled bool) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceAutoRefreshEnabled, Value: enabled}}})
	return err
}

// SetBackgroundRefreshEnabled persists the background refresh preference.
//
//wails:ignore
func (a *App) SetBackgroundRefreshEnabled(enabled bool) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceRefreshBackgroundClustersEnabled, Value: enabled}}})
	return err
}

//wails:ignore
func (a *App) SetKubernetesClientQPS(qps int) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceKubernetesClientQPS, Value: qps}}})
	return err
}

//wails:ignore
func (a *App) SetKubernetesClientBurst(burst int) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceKubernetesClientBurst, Value: burst}}})
	return err
}

//wails:ignore
func (a *App) SetPermissionSSRRFetchConcurrency(limit int) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferencePermissionSSRRFetchConcurrency, Value: limit}}})
	return err
}

// SetObjPanelLogsBufferMaxSize persists the max container log entries each
// Object Panel Logs Tab keeps in memory.
// Values are clamped to [minObjPanelLogsBufferMaxSize, maxObjPanelLogsBufferMaxSize].
//
//wails:ignore
func (a *App) SetObjPanelLogsBufferMaxSize(size int) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceObjPanelLogsBufferMaxSize, Value: size}}})
	return err
}

//wails:ignore
func (a *App) SetObjPanelLogsTargetPerScopeLimit(limit int) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceObjPanelLogsTargetPerScopeLimit, Value: limit}}})
	return err
}

//wails:ignore
func (a *App) SetObjPanelLogsTargetGlobalLimit(limit int) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceObjPanelLogsTargetGlobalLimit, Value: limit}}})
	return err
}

//wails:ignore
func (a *App) SetObjPanelLogsAPITimestampFormat(format string) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceObjPanelLogsAPITimestampFormat, Value: format}}})
	return err
}

//wails:ignore
func (a *App) SetObjPanelLogsAPITimestampUseLocalTimeZone(enabled bool) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceObjPanelLogsAPITimestampUseLocalTimeZone, Value: enabled}}})
	return err
}

// SetGridTablePersistenceMode persists the grid table persistence mode.
//
//wails:ignore
func (a *App) SetGridTablePersistenceMode(mode string) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceGridTablePersistenceMode, Value: mode}}})
	return err
}

// SetDefaultObjectPanelPosition persists the default object panel position.
//
//wails:ignore
func (a *App) SetDefaultObjectPanelPosition(position string) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceDefaultObjectPanelPosition, Value: position}}})
	return err
}

// SetObjectPanelLayout persists the default object panel dimensions and floating position.
//
//wails:ignore
func (a *App) SetObjectPanelLayout(dockedRightWidth, dockedBottomHeight, floatingWidth, floatingHeight, floatingX, floatingY int) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{
		{Key: appPreferenceObjectPanelDockedRightWidth, Value: dockedRightWidth},
		{Key: appPreferenceObjectPanelDockedBottomHeight, Value: dockedBottomHeight},
		{Key: appPreferenceObjectPanelFloatingWidth, Value: floatingWidth},
		{Key: appPreferenceObjectPanelFloatingHeight, Value: floatingHeight},
		{Key: appPreferenceObjectPanelFloatingX, Value: floatingX},
		{Key: appPreferenceObjectPanelFloatingY, Value: floatingY},
	}})
	return err
}

//wails:ignore
func (a *App) GetAppearanceModeInfo() (*AppearanceModeInfo, error) {
	settings, err := a.GetAppSettings()
	if err != nil {
		return nil, err
	}

	return &AppearanceModeInfo{
		CurrentMode: settings.AppearanceMode,
		UserMode:    settings.AppearanceMode,
	}, nil
}

//wails:ignore
func (a *App) ShowSettings() {
	maxRetries := config.AppMenuTriggerMaxRetries
	for i := 0; i < maxRetries; i++ {
		if a.runtimeAvailable() {
			a.logger.Debug("Settings menu triggered", logsources.App)
			a.emitCurrentWindowEvent("open-settings")
			return
		}
		if i < maxRetries-1 {
			time.Sleep(config.AppMenuTriggerRetryDelay)
		}
	}
	a.logger.Warn("Cannot show settings: application context is nil after retries", logsources.App)
}

//wails:ignore
func (a *App) ShowAbout() {
	maxRetries := config.AppMenuTriggerMaxRetries
	for i := 0; i < maxRetries; i++ {
		if a.runtimeAvailable() {
			a.logger.Debug("About menu triggered", logsources.App)
			a.emitCurrentWindowEvent("open-about")
			return
		}
		if i < maxRetries-1 {
			time.Sleep(config.AppMenuTriggerRetryDelay)
		}
	}
	a.logger.Warn("Cannot show about: application context is nil after retries", logsources.App)
}

// GetZoomLevel returns the persisted zoom level (50-200), defaulting to 100.
func (a *App) GetZoomLevel() int {
	settings, err := a.loadSettingsFile()
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
func (a *App) SetZoomLevel(level int) error {
	// Clamp to valid range
	if level < 50 {
		level = 50
	}
	if level > 200 {
		level = 200
	}

	settings, err := a.loadSettingsFile()
	if err != nil {
		return err
	}

	settings.UI.ZoomLevel = level
	return a.saveSettingsFile(settings)
}

// SetPaletteTint persists the palette hue (0-360), saturation (0-100), and brightness (-50 to +50) preferences
// for the specified resolved appearance mode ("light" or "dark"). Values are clamped to their valid ranges.
//
//wails:ignore
func (a *App) SetPaletteTint(mode string, hue, saturation, brightness int) error {
	if mode != "light" && mode != "dark" {
		return fmt.Errorf("invalid palette mode: %s", mode)
	}
	hueKey := appPreferencePaletteHueDark
	saturationKey := appPreferencePaletteSaturationDark
	brightnessKey := appPreferencePaletteBrightnessDark
	if mode == "light" {
		hueKey = appPreferencePaletteHueLight
		saturationKey = appPreferencePaletteSaturationLight
		brightnessKey = appPreferencePaletteBrightnessLight
	}
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{
		{Key: hueKey, Value: hue},
		{Key: saturationKey, Value: saturation},
		{Key: brightnessKey, Value: brightness},
	}})
	if err == nil {
		a.logger.Info(
			fmt.Sprintf(
				"Palette tint (%s) changed to hue=%d saturation=%d brightness=%d",
				mode,
				clampInt(hue, minPaletteHue, maxPaletteHue),
				clampInt(saturation, minPaletteSaturation, maxPaletteSaturation),
				clampInt(brightness, minPaletteBrightness, maxPaletteBrightness),
			),
			logsources.Settings,
		)
	}
	return err
}

// validHexColorRe matches a 7-character hex color string (#rrggbb).
var validHexColorRe = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

// SetLinkColor persists a custom link color for the specified resolved appearance mode ("light" or "dark").
// The color must be a 7-char hex string (#rrggbb) or an empty string to reset to default.
//
//wails:ignore
func (a *App) SetLinkColor(mode, color string) error {
	if mode != "light" && mode != "dark" {
		return fmt.Errorf("invalid link color mode: %s", mode)
	}
	key := appPreferenceLinkColorDark
	if mode == "light" {
		key = appPreferenceLinkColorLight
	}
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: key, Value: color}}})
	if err != nil && color != "" && !validHexColorRe.MatchString(color) {
		return fmt.Errorf("invalid link color format: %s (expected #rrggbb)", color)
	}
	if err == nil {
		a.logger.Info(fmt.Sprintf("Link color (%s) changed to: %s", mode, color), logsources.Settings)
	}
	return err
}

// SetAccentColor persists a custom accent color for the specified resolved appearance mode ("light" or "dark").
// The color must be a 7-char hex string (#rrggbb) or an empty string to reset to default.
//
//wails:ignore
func (a *App) SetAccentColor(mode, color string) error {
	if mode != "light" && mode != "dark" {
		return fmt.Errorf("invalid accent color mode: %s", mode)
	}
	key := appPreferenceAccentColorDark
	if mode == "light" {
		key = appPreferenceAccentColorLight
	}
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: key, Value: color}}})
	if err != nil && color != "" && !validHexColorRe.MatchString(color) {
		return fmt.Errorf("invalid accent color format: %s (expected #rrggbb)", color)
	}
	if err == nil {
		a.logger.Info(fmt.Sprintf("Accent color (%s) changed to: %s", mode, color), logsources.Settings)
	}
	return err
}

// syncThemesCacheLocked updates the in-memory appSettings cache with the current
// themes list so that saveAppSettings (used by SetPaletteTint, SetAccentColor,
// etc.) does not overwrite disk-persisted themes with stale cached data.
func (a *App) syncThemesCacheLocked(themes []Theme) {
	if a.appSettings != nil {
		a.appSettings.Themes = append([]Theme(nil), themes...)
	}
}

// GetThemes returns the saved theme library.
func (a *App) GetThemes() ([]Theme, error) {
	settings, err := a.loadSettingsFile()
	if err != nil {
		return nil, fmt.Errorf("loading settings: %w", err)
	}
	return settings.Preferences.Themes, nil
}

// ValidateThemeClusterPattern checks whether a theme cluster pattern can be
// parsed by the app glob matcher without mutating saved settings.
func (a *App) ValidateThemeClusterPattern(pattern string) ThemeClusterPatternValidationResult {
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
func (a *App) SaveTheme(theme Theme) error {
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

	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()

	settings, err := a.loadSettingsFile()
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

	if err := a.saveSettingsFile(settings); err != nil {
		return err
	}
	a.syncThemesCacheLocked(settings.Preferences.Themes)
	return nil
}

// DeleteTheme removes a theme from the library by ID.
func (a *App) DeleteTheme(id string) error {
	if id == defaultThemeID {
		return fmt.Errorf("default theme cannot be deleted")
	}

	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()

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
	settings.Preferences.Themes = normalizeThemes(settings.Preferences.Themes, defaultTheme())

	if err := a.saveSettingsFile(settings); err != nil {
		return err
	}
	a.syncThemesCacheLocked(settings.Preferences.Themes)
	return nil
}

// ReorderThemes sets the theme ordering. The ids slice must contain exactly the
// same IDs as the current theme list (first-match priority depends on order).
func (a *App) ReorderThemes(ids []string) error {
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()

	settings, err := a.loadSettingsFile()
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
	if err := a.saveSettingsFile(settings); err != nil {
		return err
	}
	a.syncThemesCacheLocked(settings.Preferences.Themes)
	return nil
}

// ApplyTheme loads a saved theme by ID and copies its palette values into the
// active settings fields, then persists. The frontend re-reads settings to
// pick up the changes.
func (a *App) ApplyTheme(id string) error {
	a.settingsMu.Lock()
	defer a.settingsMu.Unlock()

	settings, err := a.loadSettingsFile()
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

	if err := a.saveSettingsFile(settings); err != nil {
		return err
	}

	// Sync the in-memory cache so saveAppSettings doesn't overwrite with stale data.
	if a.appSettings != nil {
		a.appSettings.PaletteHueLight = theme.PaletteHueLight
		a.appSettings.PaletteSaturationLight = theme.PaletteSaturationLight
		a.appSettings.PaletteBrightnessLight = theme.PaletteBrightnessLight
		a.appSettings.PaletteHueDark = theme.PaletteHueDark
		a.appSettings.PaletteSaturationDark = theme.PaletteSaturationDark
		a.appSettings.PaletteBrightnessDark = theme.PaletteBrightnessDark
		a.appSettings.AccentColorLight = theme.AccentColorLight
		a.appSettings.AccentColorDark = theme.AccentColorDark
		a.appSettings.LinkColorLight = theme.LinkColorLight
		a.appSettings.LinkColorDark = theme.LinkColorDark
		a.appSettings.Themes = append([]Theme(nil), settings.Preferences.Themes...)
	}
	return nil
}

// MatchThemeForCluster returns the first saved theme whose ClusterPattern
// matches the given context name using app glob rules: * matches any sequence,
// ? matches any single character, and character classes such as [a-z] are
// supported. An empty ClusterPattern is treated as "*" and matches every
// context name. Returns nil if no theme matches.
func (a *App) MatchThemeForCluster(contextName string) (*Theme, error) {
	settings, err := a.loadSettingsFile()
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
