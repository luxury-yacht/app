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
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

var (
	runtimeWindowGetPosition = runtime.WindowGetPosition
	runtimeWindowGetSize     = runtime.WindowGetSize
	runtimeWindowIsMaximised = runtime.WindowIsMaximised
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
	appPreferenceAutoRefreshEnabled                       = "autoRefreshEnabled"
	appPreferenceRefreshBackgroundClustersEnabled         = "refreshBackgroundClustersEnabled"
	appPreferenceMetricsRefreshIntervalMs                 = "metricsRefreshIntervalMs"
	appPreferenceMaxTableRows                             = "maxTableRows"
	appPreferenceKubernetesClientQPS                      = "kubernetesClientQPS"
	appPreferenceKubernetesClientBurst                    = "kubernetesClientBurst"
	appPreferencePermissionSSRRFetchConcurrency           = "permissionSSRRFetchConcurrency"
	appPreferenceObjPanelLogsBufferMaxSize                = "objPanelLogsBufferMaxSize"
	appPreferenceObjPanelLogsAPITimestampFormat           = "objPanelLogsApiTimestampFormat"
	appPreferenceObjPanelLogsAPITimestampUseLocalTimeZone = "objPanelLogsApiTimestampUseLocalTimeZone"
	appPreferenceObjPanelLogsTargetPerScopeLimit          = "objPanelLogsTargetPerScopeLimit"
	appPreferenceObjPanelLogsTargetGlobalLimit            = "objPanelLogsTargetGlobalLimit"
	appPreferenceGridTablePersistenceMode                 = "gridTablePersistenceMode"
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
	SchemaVersion int                 `json:"schemaVersion"`
	UpdatedAt     time.Time           `json:"updatedAt"`
	Preferences   settingsPreferences `json:"preferences"`
	Kubeconfig    settingsKubeconfig  `json:"kubeconfig"`
	UI            settingsUI          `json:"ui"`
}

// settingsPreferences captures user-configurable preferences.
type settingsPreferences struct {
	AppearanceMode                string                 `json:"appearanceMode"`
	UseShortResourceNames         bool                   `json:"useShortResourceNames"`
	DimInactiveNamespaces         *bool                  `json:"dimInactiveNamespaces,omitempty"`
	ExclusiveNamespaces           *bool                  `json:"exclusiveNamespaces,omitempty"`
	Refresh                       *settingsRefresh       `json:"refresh"`
	MaxTableRows                  int                    `json:"maxTableRows"`
	KubernetesAPI                 *settingsKubernetesAPI `json:"kubernetesAPI,omitempty"`
	ObjPanelLogs                  *settingsObjPanelLogs  `json:"objPanelLogs,omitempty"`
	GridTablePersistenceMode      string                 `json:"gridTablePersistenceMode"`
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
	defaultMaxTableRows                    = 1000
	minMaxTableRows                        = 100
	maxMaxTableRows                        = 10000
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
	defaultObjectPanelPosition             = "right"
	defaultObjectPanelDockedRightWidth     = 600
	defaultObjectPanelDockedBottomHeight   = 400
	defaultObjectPanelFloatingWidth        = 500
	defaultObjectPanelFloatingHeight       = 400
	defaultObjectPanelFloatingX            = 100
	defaultObjectPanelFloatingY            = 100
	minObjectPanelDockedRightWidth         = 500
	minObjectPanelDockedBottomHeight       = 200
	minObjectPanelFloatingWidth            = 450
	minObjectPanelFloatingHeight           = 200
	minObjectPanelFloatingX                = 1
	minObjectPanelFloatingY                = 1
	maxObjectPanelLayoutValue              = 9999
	minPaletteHue                          = 0
	maxPaletteHue                          = 360
	minPaletteSaturation                   = 0
	maxPaletteSaturation                   = 100
	minPaletteBrightness                   = -50
	maxPaletteBrightness                   = 50
)

func clampMaxTableRows(size int) int {
	if size < minMaxTableRows {
		return minMaxTableRows
	}
	if size > maxMaxTableRows {
		return maxMaxTableRows
	}
	return size
}

func clampKubernetesClientQPS(qps int) int {
	if qps < minKubernetesClientQPS {
		return minKubernetesClientQPS
	}
	if qps > maxKubernetesClientQPS {
		return maxKubernetesClientQPS
	}
	return qps
}

func clampKubernetesClientBurst(burst int) int {
	if burst < minKubernetesClientBurst {
		return minKubernetesClientBurst
	}
	if burst > maxKubernetesClientBurst {
		return maxKubernetesClientBurst
	}
	return burst
}

func clampPermissionSSRRFetchConcurrency(limit int) int {
	if limit < minPermissionSSRRFetchConcurrency {
		return minPermissionSSRRFetchConcurrency
	}
	if limit > maxPermissionSSRRFetchConcurrency {
		return maxPermissionSSRRFetchConcurrency
	}
	return limit
}

func clampObjPanelLogsBufferMaxSize(size int) int {
	if size < minObjPanelLogsBufferMaxSize {
		return minObjPanelLogsBufferMaxSize
	}
	if size > maxObjPanelLogsBufferMaxSize {
		return maxObjPanelLogsBufferMaxSize
	}
	return size
}

func clampObjPanelLogsTargetPerScopeLimit(limit int) int {
	if limit < minObjPanelLogsTargetPerScopeLimit {
		return minObjPanelLogsTargetPerScopeLimit
	}
	if limit > maxObjPanelLogsTargetPerScopeLimit {
		return maxObjPanelLogsTargetPerScopeLimit
	}
	return limit
}

func clampObjPanelLogsTargetGlobalLimit(limit int) int {
	if limit < minObjPanelLogsTargetGlobalLimit {
		return minObjPanelLogsTargetGlobalLimit
	}
	if limit > maxObjPanelLogsTargetGlobalLimit {
		return maxObjPanelLogsTargetGlobalLimit
	}
	return limit
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
			Refresh:               &settingsRefresh{Auto: true, Background: true, MetricsIntervalMs: defaultMetricsIntervalMs()},
			MaxTableRows:          defaultMaxTableRows,
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
	if settings.SchemaVersion == 0 {
		settings.SchemaVersion = settingsSchemaVersion
	}
	if settings.Preferences.AppearanceMode == "" {
		settings.Preferences.AppearanceMode = "system"
	}
	if settings.Preferences.DimInactiveNamespaces == nil {
		settings.Preferences.DimInactiveNamespaces = boolPtr(true)
	}
	if settings.Preferences.ExclusiveNamespaces == nil {
		settings.Preferences.ExclusiveNamespaces = boolPtr(true)
	}
	if settings.Preferences.Refresh == nil {
		settings.Preferences.Refresh = &settingsRefresh{Auto: true, Background: true, MetricsIntervalMs: defaultMetricsIntervalMs()}
	}
	if settings.Preferences.Refresh.MetricsIntervalMs <= 0 {
		settings.Preferences.Refresh.MetricsIntervalMs = defaultMetricsIntervalMs()
	}
	if settings.Preferences.MaxTableRows <= 0 {
		settings.Preferences.MaxTableRows = defaultMaxTableRows
	} else {
		settings.Preferences.MaxTableRows = clampMaxTableRows(settings.Preferences.MaxTableRows)
	}
	if settings.Preferences.KubernetesAPI == nil {
		settings.Preferences.KubernetesAPI = &settingsKubernetesAPI{
			ClientQPS:                      defaultKubernetesClientQPS,
			ClientBurst:                    defaultKubernetesClientBurst,
			PermissionSSRRFetchConcurrency: defaultPermissionSSRRFetchConcurrency,
		}
	}
	if settings.Preferences.KubernetesAPI.ClientQPS <= 0 {
		settings.Preferences.KubernetesAPI.ClientQPS = defaultKubernetesClientQPS
	} else {
		settings.Preferences.KubernetesAPI.ClientQPS = clampKubernetesClientQPS(settings.Preferences.KubernetesAPI.ClientQPS)
	}
	if settings.Preferences.KubernetesAPI.ClientBurst <= 0 {
		settings.Preferences.KubernetesAPI.ClientBurst = defaultKubernetesClientBurst
	} else {
		settings.Preferences.KubernetesAPI.ClientBurst = clampKubernetesClientBurst(settings.Preferences.KubernetesAPI.ClientBurst)
	}
	if settings.Preferences.KubernetesAPI.PermissionSSRRFetchConcurrency <= 0 {
		settings.Preferences.KubernetesAPI.PermissionSSRRFetchConcurrency = defaultPermissionSSRRFetchConcurrency
	} else {
		settings.Preferences.KubernetesAPI.PermissionSSRRFetchConcurrency = clampPermissionSSRRFetchConcurrency(settings.Preferences.KubernetesAPI.PermissionSSRRFetchConcurrency)
	}
	if settings.Preferences.ObjPanelLogs == nil {
		settings.Preferences.ObjPanelLogs = &settingsObjPanelLogs{
			BufferMaxSize:       defaultObjPanelLogsBufferMaxSize,
			TargetPerScopeLimit: defaultObjPanelLogsTargetPerScopeLimit,
			TargetGlobalLimit:   defaultObjPanelLogsTargetGlobalLimit,
			APITimestampFormat:  defaultObjPanelLogsAPITimestampFormat,
		}
	}
	// A zero value means "use the default", not "truncate every buffer to 0".
	if settings.Preferences.ObjPanelLogs.BufferMaxSize <= 0 {
		settings.Preferences.ObjPanelLogs.BufferMaxSize = defaultObjPanelLogsBufferMaxSize
	} else {
		settings.Preferences.ObjPanelLogs.BufferMaxSize = clampObjPanelLogsBufferMaxSize(settings.Preferences.ObjPanelLogs.BufferMaxSize)
	}
	if settings.Preferences.ObjPanelLogs.TargetPerScopeLimit <= 0 {
		settings.Preferences.ObjPanelLogs.TargetPerScopeLimit = defaultObjPanelLogsTargetPerScopeLimit
	} else {
		settings.Preferences.ObjPanelLogs.TargetPerScopeLimit = clampObjPanelLogsTargetPerScopeLimit(settings.Preferences.ObjPanelLogs.TargetPerScopeLimit)
	}
	if settings.Preferences.ObjPanelLogs.TargetGlobalLimit <= 0 {
		settings.Preferences.ObjPanelLogs.TargetGlobalLimit = defaultObjPanelLogsTargetGlobalLimit
	} else {
		settings.Preferences.ObjPanelLogs.TargetGlobalLimit = clampObjPanelLogsTargetGlobalLimit(settings.Preferences.ObjPanelLogs.TargetGlobalLimit)
	}
	if settings.Preferences.ObjPanelLogs.APITimestampFormat == "" {
		settings.Preferences.ObjPanelLogs.APITimestampFormat = defaultObjPanelLogsAPITimestampFormat
	}
	if settings.Preferences.GridTablePersistenceMode == "" {
		settings.Preferences.GridTablePersistenceMode = "shared"
	}
	if settings.Preferences.DefaultObjectPanelPosition == "" {
		settings.Preferences.DefaultObjectPanelPosition = defaultObjectPanelPosition
	}
	if settings.Preferences.ObjectPanelDockedRightWidth <= 0 {
		settings.Preferences.ObjectPanelDockedRightWidth = defaultObjectPanelDockedRightWidth
	} else {
		settings.Preferences.ObjectPanelDockedRightWidth = clampInt(settings.Preferences.ObjectPanelDockedRightWidth, minObjectPanelDockedRightWidth, maxObjectPanelLayoutValue)
	}
	if settings.Preferences.ObjectPanelDockedBottomHeight <= 0 {
		settings.Preferences.ObjectPanelDockedBottomHeight = defaultObjectPanelDockedBottomHeight
	} else {
		settings.Preferences.ObjectPanelDockedBottomHeight = clampInt(settings.Preferences.ObjectPanelDockedBottomHeight, minObjectPanelDockedBottomHeight, maxObjectPanelLayoutValue)
	}
	if settings.Preferences.ObjectPanelFloatingWidth <= 0 {
		settings.Preferences.ObjectPanelFloatingWidth = defaultObjectPanelFloatingWidth
	} else {
		settings.Preferences.ObjectPanelFloatingWidth = clampInt(settings.Preferences.ObjectPanelFloatingWidth, minObjectPanelFloatingWidth, maxObjectPanelLayoutValue)
	}
	if settings.Preferences.ObjectPanelFloatingHeight <= 0 {
		settings.Preferences.ObjectPanelFloatingHeight = defaultObjectPanelFloatingHeight
	} else {
		settings.Preferences.ObjectPanelFloatingHeight = clampInt(settings.Preferences.ObjectPanelFloatingHeight, minObjectPanelFloatingHeight, maxObjectPanelLayoutValue)
	}
	if settings.Preferences.ObjectPanelFloatingX <= 0 {
		settings.Preferences.ObjectPanelFloatingX = defaultObjectPanelFloatingX
	} else {
		settings.Preferences.ObjectPanelFloatingX = clampInt(settings.Preferences.ObjectPanelFloatingX, minObjectPanelFloatingX, maxObjectPanelLayoutValue)
	}
	if settings.Preferences.ObjectPanelFloatingY <= 0 {
		settings.Preferences.ObjectPanelFloatingY = defaultObjectPanelFloatingY
	} else {
		settings.Preferences.ObjectPanelFloatingY = clampInt(settings.Preferences.ObjectPanelFloatingY, minObjectPanelFloatingY, maxObjectPanelLayoutValue)
	}
	// Migrate old single-value palette fields to per-mode fields.
	prefs := &settings.Preferences
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
	if settings.Kubeconfig.SearchPaths == nil {
		settings.Kubeconfig.SearchPaths = defaultKubeconfigSearchPaths()
	}
	settings.Preferences.Themes = normalizeThemes(
		settings.Preferences.Themes,
		defaultThemeFromPreferences(settings.Preferences),
	)

	return settings
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
	if err := os.MkdirAll(configDir, 0o755); err != nil {
		return "", fmt.Errorf("failed to create config directory: %w", err)
	}

	return filepath.Join(configDir, "settings.json"), nil
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

	// Windows cannot rename over an existing file, so remove it first.
	if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return os.Rename(tempFile.Name(), path)
}

func (a *App) SaveWindowSettings() error {
	x, y := runtimeWindowGetPosition(a.Ctx)
	width, height := runtimeWindowGetSize(a.Ctx)
	maximized := runtimeWindowIsMaximised(a.Ctx)

	a.windowSettings = &WindowSettings{X: x, Y: y, Width: width, Height: height, Maximized: maximized}

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
		AutoRefreshEnabled:                       true,
		RefreshBackgroundClustersEnabled:         true,
		MetricsRefreshIntervalMs:                 defaultMetricsIntervalMs(),
		MaxTableRows:                             defaultMaxTableRows,
		KubernetesClientQPS:                      defaultKubernetesClientQPS,
		KubernetesClientBurst:                    defaultKubernetesClientBurst,
		PermissionSSRRFetchConcurrency:           defaultPermissionSSRRFetchConcurrency,
		ObjPanelLogsBufferMaxSize:                defaultObjPanelLogsBufferMaxSize,
		ObjPanelLogsTargetPerScopeLimit:          defaultObjPanelLogsTargetPerScopeLimit,
		ObjPanelLogsTargetGlobalLimit:            defaultObjPanelLogsTargetGlobalLimit,
		ObjPanelLogsAPITimestampFormat:           defaultObjPanelLogsAPITimestampFormat,
		ObjPanelLogsAPITimestampUseLocalTimeZone: false,
		GridTablePersistenceMode:                 "shared",
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

	objPanelLogsBufferMaxSize := defaultObjPanelLogsBufferMaxSize
	objPanelLogsTargetPerScopeLimit := defaultObjPanelLogsTargetPerScopeLimit
	objPanelLogsTargetGlobalLimit := defaultObjPanelLogsTargetGlobalLimit
	logAPITimestampFormat := defaultObjPanelLogsAPITimestampFormat
	logAPITimestampUseLocalTimeZone := false
	maxTableRows := defaultMaxTableRows
	dimInactiveNamespaces := true
	if settings.Preferences.DimInactiveNamespaces != nil {
		dimInactiveNamespaces = *settings.Preferences.DimInactiveNamespaces
	}
	exclusiveNamespaces := true
	if settings.Preferences.ExclusiveNamespaces != nil {
		exclusiveNamespaces = *settings.Preferences.ExclusiveNamespaces
	}
	if settings.Preferences.MaxTableRows > 0 {
		maxTableRows = clampMaxTableRows(settings.Preferences.MaxTableRows)
	}
	if settings.Preferences.ObjPanelLogs != nil && settings.Preferences.ObjPanelLogs.BufferMaxSize > 0 {
		objPanelLogsBufferMaxSize = clampObjPanelLogsBufferMaxSize(settings.Preferences.ObjPanelLogs.BufferMaxSize)
	}
	if settings.Preferences.ObjPanelLogs != nil && settings.Preferences.ObjPanelLogs.TargetPerScopeLimit > 0 {
		objPanelLogsTargetPerScopeLimit = clampObjPanelLogsTargetPerScopeLimit(settings.Preferences.ObjPanelLogs.TargetPerScopeLimit)
	}
	if settings.Preferences.ObjPanelLogs != nil && settings.Preferences.ObjPanelLogs.TargetGlobalLimit > 0 {
		objPanelLogsTargetGlobalLimit = clampObjPanelLogsTargetGlobalLimit(settings.Preferences.ObjPanelLogs.TargetGlobalLimit)
	}
	if settings.Preferences.ObjPanelLogs != nil && settings.Preferences.ObjPanelLogs.APITimestampFormat != "" {
		logAPITimestampFormat = settings.Preferences.ObjPanelLogs.APITimestampFormat
	}
	if settings.Preferences.ObjPanelLogs != nil {
		logAPITimestampUseLocalTimeZone = settings.Preferences.ObjPanelLogs.UseLocalTimeZone
	}
	kubernetesClientQPS := defaultKubernetesClientQPS
	kubernetesClientBurst := defaultKubernetesClientBurst
	permissionSSRRFetchConcurrency := defaultPermissionSSRRFetchConcurrency
	if settings.Preferences.KubernetesAPI != nil {
		if settings.Preferences.KubernetesAPI.ClientQPS > 0 {
			kubernetesClientQPS = clampKubernetesClientQPS(settings.Preferences.KubernetesAPI.ClientQPS)
		}
		if settings.Preferences.KubernetesAPI.ClientBurst > 0 {
			kubernetesClientBurst = clampKubernetesClientBurst(settings.Preferences.KubernetesAPI.ClientBurst)
		}
		if settings.Preferences.KubernetesAPI.PermissionSSRRFetchConcurrency > 0 {
			permissionSSRRFetchConcurrency = clampPermissionSSRRFetchConcurrency(settings.Preferences.KubernetesAPI.PermissionSSRRFetchConcurrency)
		}
	}

	a.appSettings = &AppSettings{
		AppearanceMode:                           settings.Preferences.AppearanceMode,
		SelectedKubeconfigs:                      append([]string(nil), settings.Kubeconfig.Selected...),
		UseShortResourceNames:                    settings.Preferences.UseShortResourceNames,
		DimInactiveNamespaces:                    dimInactiveNamespaces,
		ExclusiveNamespaces:                      exclusiveNamespaces,
		AutoRefreshEnabled:                       settings.Preferences.Refresh.Auto,
		RefreshBackgroundClustersEnabled:         settings.Preferences.Refresh.Background,
		MetricsRefreshIntervalMs:                 settings.Preferences.Refresh.MetricsIntervalMs,
		MaxTableRows:                             maxTableRows,
		KubernetesClientQPS:                      kubernetesClientQPS,
		KubernetesClientBurst:                    kubernetesClientBurst,
		PermissionSSRRFetchConcurrency:           permissionSSRRFetchConcurrency,
		ObjPanelLogsBufferMaxSize:                objPanelLogsBufferMaxSize,
		ObjPanelLogsTargetPerScopeLimit:          objPanelLogsTargetPerScopeLimit,
		ObjPanelLogsTargetGlobalLimit:            objPanelLogsTargetGlobalLimit,
		ObjPanelLogsAPITimestampFormat:           logAPITimestampFormat,
		ObjPanelLogsAPITimestampUseLocalTimeZone: logAPITimestampUseLocalTimeZone,
		GridTablePersistenceMode:                 settings.Preferences.GridTablePersistenceMode,
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
	containerlogs.SetPerScopeTargetLimit(objPanelLogsTargetPerScopeLimit)
	if a.containerLogsTargetLimiter != nil {
		a.containerLogsTargetLimiter.SetLimit(objPanelLogsTargetGlobalLimit)
	}
	return nil
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
	if settings.Preferences.Refresh == nil {
		settings.Preferences.Refresh = &settingsRefresh{}
	}
	settings.Preferences.Refresh.Auto = a.appSettings.AutoRefreshEnabled
	settings.Preferences.Refresh.Background = a.appSettings.RefreshBackgroundClustersEnabled
	settings.Preferences.Refresh.MetricsIntervalMs = a.appSettings.MetricsRefreshIntervalMs
	settings.Preferences.MaxTableRows = clampMaxTableRows(a.appSettings.MaxTableRows)
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

		var errs []error

		settingsFile, err := a.getSettingsFilePath()
		if err == nil {
			if err := removeFileIfExists(settingsFile); err != nil {
				errs = append(errs, err)
			}
		} else {
			errs = append(errs, err)
		}

		persistenceFile, err := a.getPersistenceFilePath()
		if err == nil {
			if err := removeFileIfExists(persistenceFile); err != nil {
				errs = append(errs, err)
			}
		} else {
			errs = append(errs, err)
		}

		a.settingsMu.Lock()
		a.appSettings = nil
		a.settingsMu.Unlock()
		a.windowSettings = nil

		if len(errs) > 0 {
			return fmt.Errorf("clear app state: %w", errs[0])
		}

		return nil
	})
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
			return getDefaultAppSettings(), nil
		}
	}

	cp := *a.appSettings
	cp.SelectedKubeconfigs = append([]string(nil), a.appSettings.SelectedKubeconfigs...)
	cp.Themes = append([]Theme(nil), a.appSettings.Themes...)
	return &cp, nil
}

func intPtr(v int) *int {
	return &v
}

func appPreferenceSchema(key, valueType string, defaultValue, currentValue any, minValue, maxValue *int, enumOptions []string, validation string, runtimeSideEffect bool) AppPreferenceSchema {
	return AppPreferenceSchema{
		Key:               key,
		Type:              valueType,
		DefaultValue:      defaultValue,
		CurrentValue:      currentValue,
		Min:               minValue,
		Max:               maxValue,
		EnumOptions:       enumOptions,
		Validation:        validation,
		RuntimeSideEffect: runtimeSideEffect,
	}
}

func buildAppSettingsSchema(settings *AppSettings) *AppSettingsSchema {
	if settings == nil {
		settings = getDefaultAppSettings()
	}
	return &AppSettingsSchema{Preferences: []AppPreferenceSchema{
		appPreferenceSchema(appPreferenceAppearanceMode, "enum", "system", settings.AppearanceMode, nil, nil, []string{"light", "dark", "system"}, "", true),
		appPreferenceSchema(appPreferenceUseShortResourceNames, "boolean", false, settings.UseShortResourceNames, nil, nil, nil, "", false),
		appPreferenceSchema(appPreferenceDimInactiveNamespaces, "boolean", true, settings.DimInactiveNamespaces, nil, nil, nil, "", false),
		appPreferenceSchema(appPreferenceExclusiveNamespaces, "boolean", true, settings.ExclusiveNamespaces, nil, nil, nil, "", false),
		appPreferenceSchema(appPreferenceAutoRefreshEnabled, "boolean", true, settings.AutoRefreshEnabled, nil, nil, nil, "", true),
		appPreferenceSchema(appPreferenceRefreshBackgroundClustersEnabled, "boolean", true, settings.RefreshBackgroundClustersEnabled, nil, nil, nil, "", true),
		appPreferenceSchema(appPreferenceMetricsRefreshIntervalMs, "integer", defaultMetricsIntervalMs(), settings.MetricsRefreshIntervalMs, intPtr(1), nil, nil, "", true),
		appPreferenceSchema(appPreferenceMaxTableRows, "integer", defaultMaxTableRows, settings.MaxTableRows, intPtr(minMaxTableRows), intPtr(maxMaxTableRows), nil, "", false),
		appPreferenceSchema(appPreferenceKubernetesClientQPS, "integer", defaultKubernetesClientQPS, settings.KubernetesClientQPS, intPtr(minKubernetesClientQPS), intPtr(maxKubernetesClientQPS), nil, "", true),
		appPreferenceSchema(appPreferenceKubernetesClientBurst, "integer", defaultKubernetesClientBurst, settings.KubernetesClientBurst, intPtr(minKubernetesClientBurst), intPtr(maxKubernetesClientBurst), nil, "", true),
		appPreferenceSchema(appPreferencePermissionSSRRFetchConcurrency, "integer", defaultPermissionSSRRFetchConcurrency, settings.PermissionSSRRFetchConcurrency, intPtr(minPermissionSSRRFetchConcurrency), intPtr(maxPermissionSSRRFetchConcurrency), nil, "", false),
		appPreferenceSchema(appPreferenceObjPanelLogsBufferMaxSize, "integer", defaultObjPanelLogsBufferMaxSize, settings.ObjPanelLogsBufferMaxSize, intPtr(minObjPanelLogsBufferMaxSize), intPtr(maxObjPanelLogsBufferMaxSize), nil, "", false),
		appPreferenceSchema(appPreferenceObjPanelLogsAPITimestampFormat, "string", defaultObjPanelLogsAPITimestampFormat, settings.ObjPanelLogsAPITimestampFormat, nil, nil, nil, "dayjs-format", false),
		appPreferenceSchema(appPreferenceObjPanelLogsAPITimestampUseLocalTimeZone, "boolean", false, settings.ObjPanelLogsAPITimestampUseLocalTimeZone, nil, nil, nil, "", false),
		appPreferenceSchema(appPreferenceObjPanelLogsTargetPerScopeLimit, "integer", defaultObjPanelLogsTargetPerScopeLimit, settings.ObjPanelLogsTargetPerScopeLimit, intPtr(minObjPanelLogsTargetPerScopeLimit), intPtr(maxObjPanelLogsTargetPerScopeLimit), nil, "", true),
		appPreferenceSchema(appPreferenceObjPanelLogsTargetGlobalLimit, "integer", defaultObjPanelLogsTargetGlobalLimit, settings.ObjPanelLogsTargetGlobalLimit, intPtr(minObjPanelLogsTargetGlobalLimit), intPtr(maxObjPanelLogsTargetGlobalLimit), nil, "", true),
		appPreferenceSchema(appPreferenceGridTablePersistenceMode, "enum", "shared", settings.GridTablePersistenceMode, nil, nil, []string{"shared", "namespaced"}, "", false),
		appPreferenceSchema(appPreferenceDefaultObjectPanelPosition, "enum", defaultObjectPanelPosition, settings.DefaultObjectPanelPosition, nil, nil, []string{"right", "bottom", "floating"}, "", false),
		appPreferenceSchema(appPreferenceObjectPanelDockedRightWidth, "integer", defaultObjectPanelDockedRightWidth, settings.ObjectPanelDockedRightWidth, intPtr(minObjectPanelDockedRightWidth), intPtr(maxObjectPanelLayoutValue), nil, "", false),
		appPreferenceSchema(appPreferenceObjectPanelDockedBottomHeight, "integer", defaultObjectPanelDockedBottomHeight, settings.ObjectPanelDockedBottomHeight, intPtr(minObjectPanelDockedBottomHeight), intPtr(maxObjectPanelLayoutValue), nil, "", false),
		appPreferenceSchema(appPreferenceObjectPanelFloatingWidth, "integer", defaultObjectPanelFloatingWidth, settings.ObjectPanelFloatingWidth, intPtr(minObjectPanelFloatingWidth), intPtr(maxObjectPanelLayoutValue), nil, "", false),
		appPreferenceSchema(appPreferenceObjectPanelFloatingHeight, "integer", defaultObjectPanelFloatingHeight, settings.ObjectPanelFloatingHeight, intPtr(minObjectPanelFloatingHeight), intPtr(maxObjectPanelLayoutValue), nil, "", false),
		appPreferenceSchema(appPreferenceObjectPanelFloatingX, "integer", defaultObjectPanelFloatingX, settings.ObjectPanelFloatingX, intPtr(minObjectPanelFloatingX), intPtr(maxObjectPanelLayoutValue), nil, "", false),
		appPreferenceSchema(appPreferenceObjectPanelFloatingY, "integer", defaultObjectPanelFloatingY, settings.ObjectPanelFloatingY, intPtr(minObjectPanelFloatingY), intPtr(maxObjectPanelLayoutValue), nil, "", false),
		appPreferenceSchema(appPreferencePaletteHueLight, "integer", 0, settings.PaletteHueLight, intPtr(minPaletteHue), intPtr(maxPaletteHue), nil, "", false),
		appPreferenceSchema(appPreferencePaletteSaturationLight, "integer", 0, settings.PaletteSaturationLight, intPtr(minPaletteSaturation), intPtr(maxPaletteSaturation), nil, "", false),
		appPreferenceSchema(appPreferencePaletteBrightnessLight, "integer", 0, settings.PaletteBrightnessLight, intPtr(minPaletteBrightness), intPtr(maxPaletteBrightness), nil, "", false),
		appPreferenceSchema(appPreferencePaletteHueDark, "integer", 0, settings.PaletteHueDark, intPtr(minPaletteHue), intPtr(maxPaletteHue), nil, "", false),
		appPreferenceSchema(appPreferencePaletteSaturationDark, "integer", 0, settings.PaletteSaturationDark, intPtr(minPaletteSaturation), intPtr(maxPaletteSaturation), nil, "", false),
		appPreferenceSchema(appPreferencePaletteBrightnessDark, "integer", 0, settings.PaletteBrightnessDark, intPtr(minPaletteBrightness), intPtr(maxPaletteBrightness), nil, "", false),
		appPreferenceSchema(appPreferenceAccentColorLight, "color", "", settings.AccentColorLight, nil, nil, nil, "#rrggbb-or-empty", false),
		appPreferenceSchema(appPreferenceAccentColorDark, "color", "", settings.AccentColorDark, nil, nil, nil, "#rrggbb-or-empty", false),
		appPreferenceSchema(appPreferenceLinkColorLight, "color", "", settings.LinkColorLight, nil, nil, nil, "#rrggbb-or-empty", false),
		appPreferenceSchema(appPreferenceLinkColorDark, "color", "", settings.LinkColorDark, nil, nil, nil, "#rrggbb-or-empty", false),
	}}
}

func (a *App) GetAppSettingsSchema() (*AppSettingsSchema, error) {
	settings, err := a.GetAppSettings()
	if err != nil {
		return nil, err
	}
	return buildAppSettingsSchema(settings), nil
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
	kubernetesClientRateLimits bool
	containerLogsPerScopeLimit bool
	containerLogsGlobalLimit   bool
}

func applyAppPreferenceChange(settings *AppSettings, change AppPreferenceChange, effects *settingsSideEffects) error {
	if settings == nil {
		return fmt.Errorf("settings are not loaded")
	}
	switch change.Key {
	case appPreferenceAppearanceMode:
		mode, err := stringPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		if mode != "light" && mode != "dark" && mode != "system" {
			return fmt.Errorf("invalid appearance mode: %s", mode)
		}
		settings.AppearanceMode = mode
	case appPreferenceUseShortResourceNames:
		value, err := boolPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		settings.UseShortResourceNames = value
	case appPreferenceDimInactiveNamespaces:
		value, err := boolPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		settings.DimInactiveNamespaces = value
	case appPreferenceExclusiveNamespaces:
		value, err := boolPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		settings.ExclusiveNamespaces = value
	case appPreferenceAutoRefreshEnabled:
		value, err := boolPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		settings.AutoRefreshEnabled = value
	case appPreferenceRefreshBackgroundClustersEnabled:
		value, err := boolPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		settings.RefreshBackgroundClustersEnabled = value
	case appPreferenceMetricsRefreshIntervalMs:
		value, err := intPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		if value <= 0 {
			value = defaultMetricsIntervalMs()
		}
		settings.MetricsRefreshIntervalMs = value
	case appPreferenceMaxTableRows:
		value, err := intPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		settings.MaxTableRows = clampMaxTableRows(value)
	case appPreferenceKubernetesClientQPS:
		value, err := intPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		settings.KubernetesClientQPS = clampKubernetesClientQPS(value)
		effects.kubernetesClientRateLimits = true
	case appPreferenceKubernetesClientBurst:
		value, err := intPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		settings.KubernetesClientBurst = clampKubernetesClientBurst(value)
		effects.kubernetesClientRateLimits = true
	case appPreferencePermissionSSRRFetchConcurrency:
		value, err := intPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		settings.PermissionSSRRFetchConcurrency = clampPermissionSSRRFetchConcurrency(value)
	case appPreferenceObjPanelLogsBufferMaxSize:
		value, err := intPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		settings.ObjPanelLogsBufferMaxSize = clampObjPanelLogsBufferMaxSize(value)
	case appPreferenceObjPanelLogsAPITimestampFormat:
		value, err := stringPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		if value == "" {
			value = defaultObjPanelLogsAPITimestampFormat
		}
		settings.ObjPanelLogsAPITimestampFormat = value
	case appPreferenceObjPanelLogsAPITimestampUseLocalTimeZone:
		value, err := boolPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		settings.ObjPanelLogsAPITimestampUseLocalTimeZone = value
	case appPreferenceObjPanelLogsTargetPerScopeLimit:
		value, err := intPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		settings.ObjPanelLogsTargetPerScopeLimit = clampObjPanelLogsTargetPerScopeLimit(value)
		effects.containerLogsPerScopeLimit = true
	case appPreferenceObjPanelLogsTargetGlobalLimit:
		value, err := intPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		settings.ObjPanelLogsTargetGlobalLimit = clampObjPanelLogsTargetGlobalLimit(value)
		effects.containerLogsGlobalLimit = true
	case appPreferenceGridTablePersistenceMode:
		mode, err := stringPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		if mode != "shared" && mode != "namespaced" {
			return fmt.Errorf("invalid grid table persistence mode: %s", mode)
		}
		settings.GridTablePersistenceMode = mode
	case appPreferenceDefaultObjectPanelPosition:
		position, err := stringPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		if position != "right" && position != "bottom" && position != "floating" {
			return fmt.Errorf("invalid default object panel position: %s", position)
		}
		settings.DefaultObjectPanelPosition = position
	case appPreferenceObjectPanelDockedRightWidth:
		value, err := intPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		value = clampInt(value, minObjectPanelDockedRightWidth, maxObjectPanelLayoutValue)
		settings.ObjectPanelDockedRightWidth = value
	case appPreferenceObjectPanelDockedBottomHeight:
		value, err := intPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		value = clampInt(value, minObjectPanelDockedBottomHeight, maxObjectPanelLayoutValue)
		settings.ObjectPanelDockedBottomHeight = value
	case appPreferenceObjectPanelFloatingWidth:
		value, err := intPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		value = clampInt(value, minObjectPanelFloatingWidth, maxObjectPanelLayoutValue)
		settings.ObjectPanelFloatingWidth = value
	case appPreferenceObjectPanelFloatingHeight:
		value, err := intPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		value = clampInt(value, minObjectPanelFloatingHeight, maxObjectPanelLayoutValue)
		settings.ObjectPanelFloatingHeight = value
	case appPreferenceObjectPanelFloatingX:
		value, err := intPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		if value <= 0 {
			value = defaultObjectPanelFloatingX
		}
		value = clampInt(value, minObjectPanelFloatingX, maxObjectPanelLayoutValue)
		settings.ObjectPanelFloatingX = value
	case appPreferenceObjectPanelFloatingY:
		value, err := intPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		if value <= 0 {
			value = defaultObjectPanelFloatingY
		}
		value = clampInt(value, minObjectPanelFloatingY, maxObjectPanelLayoutValue)
		settings.ObjectPanelFloatingY = value
	case appPreferencePaletteHueLight:
		value, err := intPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		settings.PaletteHueLight = clampInt(value, minPaletteHue, maxPaletteHue)
	case appPreferencePaletteSaturationLight:
		value, err := intPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		settings.PaletteSaturationLight = clampInt(value, minPaletteSaturation, maxPaletteSaturation)
	case appPreferencePaletteBrightnessLight:
		value, err := intPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		settings.PaletteBrightnessLight = clampInt(value, minPaletteBrightness, maxPaletteBrightness)
	case appPreferencePaletteHueDark:
		value, err := intPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		settings.PaletteHueDark = clampInt(value, minPaletteHue, maxPaletteHue)
	case appPreferencePaletteSaturationDark:
		value, err := intPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		settings.PaletteSaturationDark = clampInt(value, minPaletteSaturation, maxPaletteSaturation)
	case appPreferencePaletteBrightnessDark:
		value, err := intPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		settings.PaletteBrightnessDark = clampInt(value, minPaletteBrightness, maxPaletteBrightness)
	case appPreferenceAccentColorLight, appPreferenceAccentColorDark, appPreferenceLinkColorLight, appPreferenceLinkColorDark:
		color, err := stringPreferenceValue(change.Value)
		if err != nil {
			return fmt.Errorf("%s: %w", change.Key, err)
		}
		if color != "" && !validHexColorRe.MatchString(color) {
			return fmt.Errorf("invalid color format for %s: %s (expected #rrggbb)", change.Key, color)
		}
		switch change.Key {
		case appPreferenceAccentColorLight:
			settings.AccentColorLight = color
		case appPreferenceAccentColorDark:
			settings.AccentColorDark = color
		case appPreferenceLinkColorLight:
			settings.LinkColorLight = color
		case appPreferenceLinkColorDark:
			settings.LinkColorDark = color
		}
	default:
		return fmt.Errorf("unknown preference key: %s", change.Key)
	}
	return nil
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

func appPreferenceKeys() []string {
	return []string{
		appPreferenceAppearanceMode,
		appPreferenceUseShortResourceNames,
		appPreferenceDimInactiveNamespaces,
		appPreferenceExclusiveNamespaces,
		appPreferenceAutoRefreshEnabled,
		appPreferenceRefreshBackgroundClustersEnabled,
		appPreferenceMetricsRefreshIntervalMs,
		appPreferenceMaxTableRows,
		appPreferenceKubernetesClientQPS,
		appPreferenceKubernetesClientBurst,
		appPreferencePermissionSSRRFetchConcurrency,
		appPreferenceObjPanelLogsBufferMaxSize,
		appPreferenceObjPanelLogsAPITimestampFormat,
		appPreferenceObjPanelLogsAPITimestampUseLocalTimeZone,
		appPreferenceObjPanelLogsTargetPerScopeLimit,
		appPreferenceObjPanelLogsTargetGlobalLimit,
		appPreferenceGridTablePersistenceMode,
		appPreferenceDefaultObjectPanelPosition,
		appPreferenceObjectPanelDockedRightWidth,
		appPreferenceObjectPanelDockedBottomHeight,
		appPreferenceObjectPanelFloatingWidth,
		appPreferenceObjectPanelFloatingHeight,
		appPreferenceObjectPanelFloatingX,
		appPreferenceObjectPanelFloatingY,
		appPreferencePaletteHueLight,
		appPreferencePaletteSaturationLight,
		appPreferencePaletteBrightnessLight,
		appPreferencePaletteHueDark,
		appPreferencePaletteSaturationDark,
		appPreferencePaletteBrightnessDark,
		appPreferenceAccentColorLight,
		appPreferenceAccentColorDark,
		appPreferenceLinkColorLight,
		appPreferenceLinkColorDark,
	}
}

func logPreferenceChange(logger *Logger, key string, value any) {
	if logger == nil {
		return
	}
	switch key {
	case appPreferenceAppearanceMode:
		logger.Info(fmt.Sprintf("Appearance mode changed to: %v", value), logsources.Settings)
	case appPreferenceUseShortResourceNames:
		logger.Info(fmt.Sprintf("Use short resource names changed to: %v", value), logsources.Settings)
	case appPreferenceDimInactiveNamespaces:
		logger.Info(fmt.Sprintf("Dim inactive namespaces changed to: %v", value), logsources.Settings)
	case appPreferenceExclusiveNamespaces:
		logger.Info(fmt.Sprintf("Exclusive namespaces changed to: %v", value), logsources.Settings)
	case appPreferenceAutoRefreshEnabled:
		logger.Info(fmt.Sprintf("Auto refresh enabled changed to: %v", value), logsources.Settings)
	case appPreferenceRefreshBackgroundClustersEnabled:
		logger.Info(fmt.Sprintf("Background refresh enabled changed to: %v", value), logsources.Settings)
	case appPreferenceMaxTableRows:
		logger.Info(fmt.Sprintf("Max table rows changed to: %v", value), logsources.Settings)
	case appPreferenceKubernetesClientQPS:
		logger.Info(fmt.Sprintf("Kubernetes client QPS changed to: %v", value), logsources.Settings)
	case appPreferenceKubernetesClientBurst:
		logger.Info(fmt.Sprintf("Kubernetes client burst changed to: %v", value), logsources.Settings)
	case appPreferencePermissionSSRRFetchConcurrency:
		logger.Info(fmt.Sprintf("Permission SSRR fetch concurrency changed to: %v", value), logsources.Settings)
	case appPreferenceObjPanelLogsBufferMaxSize:
		logger.Info(fmt.Sprintf("ObjPanelLogs buffer max size changed to: %v", value), logsources.Settings)
	case appPreferenceObjPanelLogsTargetPerScopeLimit:
		logger.Info(fmt.Sprintf("Object Panel Logs Tab target per-scope limit changed to: %v", value), logsources.Settings)
	case appPreferenceObjPanelLogsTargetGlobalLimit:
		logger.Info(fmt.Sprintf("Object Panel Logs Tab target global limit changed to: %v", value), logsources.Settings)
	case appPreferenceObjPanelLogsAPITimestampFormat:
		logger.Info(fmt.Sprintf("Object Panel Logs Tab API timestamp format changed to: %v", value), logsources.Settings)
	case appPreferenceObjPanelLogsAPITimestampUseLocalTimeZone:
		logger.Info(fmt.Sprintf("Object Panel Logs Tab API timestamp local timezone changed to: %v", value), logsources.Settings)
	case appPreferenceGridTablePersistenceMode:
		logger.Info(fmt.Sprintf("Grid table persistence mode changed to: %v", value), logsources.Settings)
	case appPreferenceDefaultObjectPanelPosition:
		logger.Info(fmt.Sprintf("Default object panel position changed to: %v", value), logsources.Settings)
	default:
		logger.Info(fmt.Sprintf("Preference %s changed to: %v", key, value), logsources.Settings)
	}
}

func (a *App) UpdateAppPreferences(request UpdateAppPreferencesRequest) (*UpdateAppPreferencesResponse, error) {
	a.settingsMu.Lock()

	if a.appSettings == nil {
		if err := a.loadAppSettings(); err != nil {
			a.settingsMu.Unlock()
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
			a.settingsMu.Unlock()
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
		a.settingsMu.Unlock()
		return nil, err
	}

	for _, key := range changedKeys {
		logPreferenceChange(a.logger, key, preferenceValueForLog(next, key))
	}

	effectiveQPS := next.KubernetesClientQPS
	effectiveBurst := next.KubernetesClientBurst
	perScopeLimit := next.ObjPanelLogsTargetPerScopeLimit
	globalLimit := next.ObjPanelLogsTargetGlobalLimit
	responseSettings := copyAppSettings(next)
	a.settingsMu.Unlock()

	if effects.kubernetesClientRateLimits {
		a.applyKubernetesClientRateLimits(effectiveQPS, effectiveBurst)
	}
	if effects.containerLogsPerScopeLimit {
		containerlogs.SetPerScopeTargetLimit(perScopeLimit)
	}
	if effects.containerLogsGlobalLimit && a.containerLogsTargetLimiter != nil {
		a.containerLogsTargetLimiter.SetLimit(globalLimit)
	}

	return &UpdateAppPreferencesResponse{
		Settings:    responseSettings,
		ChangedKeys: changedKeys,
	}, nil
}

func preferenceValueForLog(settings *AppSettings, key string) any {
	if settings == nil {
		return nil
	}
	switch key {
	case appPreferenceAppearanceMode:
		return settings.AppearanceMode
	case appPreferenceUseShortResourceNames:
		return settings.UseShortResourceNames
	case appPreferenceDimInactiveNamespaces:
		return settings.DimInactiveNamespaces
	case appPreferenceExclusiveNamespaces:
		return settings.ExclusiveNamespaces
	case appPreferenceAutoRefreshEnabled:
		return settings.AutoRefreshEnabled
	case appPreferenceRefreshBackgroundClustersEnabled:
		return settings.RefreshBackgroundClustersEnabled
	case appPreferenceMetricsRefreshIntervalMs:
		return settings.MetricsRefreshIntervalMs
	case appPreferenceMaxTableRows:
		return settings.MaxTableRows
	case appPreferenceKubernetesClientQPS:
		return settings.KubernetesClientQPS
	case appPreferenceKubernetesClientBurst:
		return settings.KubernetesClientBurst
	case appPreferencePermissionSSRRFetchConcurrency:
		return settings.PermissionSSRRFetchConcurrency
	case appPreferenceObjPanelLogsBufferMaxSize:
		return settings.ObjPanelLogsBufferMaxSize
	case appPreferenceObjPanelLogsAPITimestampFormat:
		return settings.ObjPanelLogsAPITimestampFormat
	case appPreferenceObjPanelLogsAPITimestampUseLocalTimeZone:
		return settings.ObjPanelLogsAPITimestampUseLocalTimeZone
	case appPreferenceObjPanelLogsTargetPerScopeLimit:
		return settings.ObjPanelLogsTargetPerScopeLimit
	case appPreferenceObjPanelLogsTargetGlobalLimit:
		return settings.ObjPanelLogsTargetGlobalLimit
	case appPreferenceGridTablePersistenceMode:
		return settings.GridTablePersistenceMode
	case appPreferenceDefaultObjectPanelPosition:
		return settings.DefaultObjectPanelPosition
	default:
		return nil
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

func (a *App) SetAppearanceMode(mode string) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceAppearanceMode, Value: mode}}})
	return err
}

func (a *App) SetUseShortResourceNames(useShort bool) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceUseShortResourceNames, Value: useShort}}})
	return err
}

func (a *App) SetDimInactiveNamespaces(enabled bool) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceDimInactiveNamespaces, Value: enabled}}})
	return err
}

func (a *App) SetExclusiveNamespaces(enabled bool) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceExclusiveNamespaces, Value: enabled}}})
	return err
}

// SetAutoRefreshEnabled persists the auto-refresh preference.
func (a *App) SetAutoRefreshEnabled(enabled bool) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceAutoRefreshEnabled, Value: enabled}}})
	return err
}

// SetBackgroundRefreshEnabled persists the background refresh preference.
func (a *App) SetBackgroundRefreshEnabled(enabled bool) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceRefreshBackgroundClustersEnabled, Value: enabled}}})
	return err
}

// SetMaxTableRows persists the max number of rows shown in a data table.
// Values are clamped to [minMaxTableRows, maxMaxTableRows].
func (a *App) SetMaxTableRows(size int) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceMaxTableRows, Value: size}}})
	return err
}

func (a *App) SetKubernetesClientQPS(qps int) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceKubernetesClientQPS, Value: qps}}})
	return err
}

func (a *App) SetKubernetesClientBurst(burst int) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceKubernetesClientBurst, Value: burst}}})
	return err
}

func (a *App) SetPermissionSSRRFetchConcurrency(limit int) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferencePermissionSSRRFetchConcurrency, Value: limit}}})
	return err
}

// SetObjPanelLogsBufferMaxSize persists the max container log entries each
// Object Panel Logs Tab keeps in memory.
// Values are clamped to [minObjPanelLogsBufferMaxSize, maxObjPanelLogsBufferMaxSize].
func (a *App) SetObjPanelLogsBufferMaxSize(size int) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceObjPanelLogsBufferMaxSize, Value: size}}})
	return err
}

func (a *App) SetObjPanelLogsTargetPerScopeLimit(limit int) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceObjPanelLogsTargetPerScopeLimit, Value: limit}}})
	return err
}

func (a *App) SetObjPanelLogsTargetGlobalLimit(limit int) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceObjPanelLogsTargetGlobalLimit, Value: limit}}})
	return err
}

func (a *App) SetObjPanelLogsAPITimestampFormat(format string) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceObjPanelLogsAPITimestampFormat, Value: format}}})
	return err
}

func (a *App) SetObjPanelLogsAPITimestampUseLocalTimeZone(enabled bool) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceObjPanelLogsAPITimestampUseLocalTimeZone, Value: enabled}}})
	return err
}

// SetGridTablePersistenceMode persists the grid table persistence mode.
func (a *App) SetGridTablePersistenceMode(mode string) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceGridTablePersistenceMode, Value: mode}}})
	return err
}

// SetDefaultObjectPanelPosition persists the default object panel position.
func (a *App) SetDefaultObjectPanelPosition(position string) error {
	_, err := a.UpdateAppPreferences(UpdateAppPreferencesRequest{Changes: []AppPreferenceChange{{Key: appPreferenceDefaultObjectPanelPosition, Value: position}}})
	return err
}

// SetObjectPanelLayout persists the default object panel dimensions and floating position.
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

func (a *App) ShowSettings() {
	maxRetries := config.AppMenuTriggerMaxRetries
	for i := 0; i < maxRetries; i++ {
		if a.Ctx != nil {
			a.logger.Debug("Settings menu triggered", logsources.App)
			a.emitEvent("open-settings")
			return
		}
		if i < maxRetries-1 {
			time.Sleep(config.AppMenuTriggerRetryDelay)
		}
	}
	a.logger.Warn("Cannot show settings: application context is nil after retries", logsources.App)
}

func (a *App) ShowAbout() {
	maxRetries := config.AppMenuTriggerMaxRetries
	for i := 0; i < maxRetries; i++ {
		if a.Ctx != nil {
			a.logger.Debug("About menu triggered", logsources.App)
			a.emitEvent("open-about")
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
	if err == nil && a.logger != nil {
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
func (a *App) SetLinkColor(mode string, color string) error {
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
	if err == nil && a.logger != nil {
		a.logger.Info(fmt.Sprintf("Link color (%s) changed to: %s", mode, color), logsources.Settings)
	}
	return err
}

// SetAccentColor persists a custom accent color for the specified resolved appearance mode ("light" or "dark").
// The color must be a 7-char hex string (#rrggbb) or an empty string to reset to default.
func (a *App) SetAccentColor(mode string, color string) error {
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
	if err == nil && a.logger != nil {
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
