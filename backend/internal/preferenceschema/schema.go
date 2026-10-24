// Package preferenceschema declares every app preference once: its key, value
// type, default, bounds, allowed values, and how a value is validated when it
// is written and repaired when it is read back. Package backend binds each key
// to its AppSettings field, runtime effect, and change-log text; the frontend
// contract is generated from this table.
package preferenceschema

import (
	"encoding/json"
	"fmt"
	"math"
	"regexp"
	"slices"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/containerlogs"
)

// ValueType is a preference's value type as the settings contract names it.
type ValueType string

const (
	Boolean ValueType = "boolean"
	Integer ValueType = "integer"
	Enum    ValueType = "enum"
	String  ValueType = "string"
	Color   ValueType = "color"
)

// NonPositive says what an integer <= 0 means for a range integer: the default
// (the "absent" rule settings.json has always used) or an ordinary value.
type NonPositive string

const (
	NonPositiveDefault NonPositive = "default"
	NonPositiveClamp   NonPositive = "clamp"
)

// Validation names a value rule beyond the type.
type Validation string

const (
	// ValidationDayjsFormat marks a Day.js format string. Go accepts any
	// non-empty value; the frontend applies its stricter token check.
	ValidationDayjsFormat Validation = "dayjs-format"
	// ValidationHexColorOrEmpty is a #rrggbb color, or empty for the theme default.
	ValidationHexColorOrEmpty Validation = "#rrggbb-or-empty"
)

// HexColorPattern is the #rrggbb form every color preference accepts.
const HexColorPattern = `^#[0-9a-fA-F]{6}$`

var hexColor = regexp.MustCompile(HexColorPattern)

// Preference keys.
const (
	KeySidebarClusterResourcesExpanded          = "sidebarClusterResourcesExpanded"
	KeySidebarClusterExtensionsExpanded         = "sidebarClusterExtensionsExpanded"
	KeySidebarNamespaceResourcesExpanded        = "sidebarNamespaceResourcesExpanded"
	KeySidebarNamespaceExtensionsExpanded       = "sidebarNamespaceExtensionsExpanded"
	KeyAppearanceMode                           = "appearanceMode"
	KeyUseShortResourceNames                    = "useShortResourceNames"
	KeyDimInactiveNamespaces                    = "dimInactiveNamespaces"
	KeyExclusiveNamespaces                      = "exclusiveNamespaces"
	KeyErrorReportingEnabled                    = "errorReportingEnabled"
	KeyAutoRefreshEnabled                       = "autoRefreshEnabled"
	KeyMetricsRefreshIntervalMs                 = "metricsRefreshIntervalMs"
	KeyKubernetesClientQPS                      = "kubernetesClientQPS"
	KeyKubernetesClientBurst                    = "kubernetesClientBurst"
	KeyPermissionSSRRFetchConcurrency           = "permissionSSRRFetchConcurrency"
	KeyObjPanelLogsBufferMaxSize                = "objPanelLogsBufferMaxSize"
	KeyObjPanelLogsAPITimestampFormat           = "objPanelLogsApiTimestampFormat"
	KeyObjPanelLogsAPITimestampUseLocalTimeZone = "objPanelLogsApiTimestampUseLocalTimeZone"
	KeyObjPanelLogsTargetPerScopeLimit          = "objPanelLogsTargetPerScopeLimit"
	KeyObjPanelLogsTargetGlobalLimit            = "objPanelLogsTargetGlobalLimit"
	KeyGridTablePersistenceMode                 = "gridTablePersistenceMode"
	KeyDefaultTablePageSize                     = "defaultTablePageSize"
	KeyDefaultObjectPanelPosition               = "defaultObjectPanelPosition"
	KeyObjectPanelDockedRightWidth              = "objectPanelDockedRightWidth"
	KeyObjectPanelDockedBottomHeight            = "objectPanelDockedBottomHeight"
	KeyObjectPanelFloatingWidth                 = "objectPanelFloatingWidth"
	KeyObjectPanelFloatingHeight                = "objectPanelFloatingHeight"
	KeyPaletteHueLight                          = "paletteHueLight"
	KeyPaletteSaturationLight                   = "paletteSaturationLight"
	KeyPaletteBrightnessLight                   = "paletteBrightnessLight"
	KeyPaletteHueDark                           = "paletteHueDark"
	KeyPaletteSaturationDark                    = "paletteSaturationDark"
	KeyPaletteBrightnessDark                    = "paletteBrightnessDark"
	KeyAccentColorLight                         = "accentColorLight"
	KeyAccentColorDark                          = "accentColorDark"
	KeyLinkColorLight                           = "linkColorLight"
	KeyLinkColorDark                            = "linkColorDark"
)

// Defaults and bounds. Runtime owners start from the same defaults, so they are
// exported; each value is stated here once.
const (
	DefaultMetricsRefreshIntervalMs = int(config.RefreshMetricsInterval / time.Millisecond)

	DefaultKubernetesClientQPS            = config.KubernetesClientQPS
	MinKubernetesClientQPS                = 1
	MaxKubernetesClientQPS                = 5000
	DefaultKubernetesClientBurst          = config.KubernetesClientBurst
	MinKubernetesClientBurst              = 1
	MaxKubernetesClientBurst              = 10000
	DefaultPermissionSSRRFetchConcurrency = config.PermissionSSRRFetchConcurrency
	MinPermissionSSRRFetchConcurrency     = 1
	MaxPermissionSSRRFetchConcurrency     = config.PermissionSSRRFetchConcurrency * 8

	DefaultObjPanelLogsBufferMaxSize       = 5000
	MinObjPanelLogsBufferMaxSize           = 100
	MaxObjPanelLogsBufferMaxSize           = 10000
	DefaultObjPanelLogsAPITimestampFormat  = "YYYY-MM-DDTHH:mm:ss.SSS[Z]"
	DefaultObjPanelLogsTargetPerScopeLimit = containerlogs.DefaultPerScopeTargetLimit
	MinObjPanelLogsTargetPerScopeLimit     = containerlogs.MinPerScopeTargetLimit
	MaxObjPanelLogsTargetPerScopeLimit     = containerlogs.MaxPerScopeTargetLimit
	DefaultObjPanelLogsTargetGlobalLimit   = config.ContainerLogsStreamGlobalTargetLimit
	MinObjPanelLogsTargetGlobalLimit       = 1
	MaxObjPanelLogsTargetGlobalLimit       = 1000

	DefaultTablePageSize = 50

	DefaultObjectPanelPosition           = "right"
	DefaultObjectPanelDockedRightWidth   = 600
	DefaultObjectPanelDockedBottomHeight = 600
	DefaultObjectPanelFloatingWidth      = 600
	DefaultObjectPanelFloatingHeight     = 800
	MinObjectPanelDockedRightWidth       = 500
	MinObjectPanelDockedBottomHeight     = 200
	MinObjectPanelFloatingWidth          = 450
	MinObjectPanelFloatingHeight         = 200
	MaxObjectPanelLayoutValue            = 9999

	MinPaletteHue        = 0
	MaxPaletteHue        = 360
	MinPaletteSaturation = 0
	MaxPaletteSaturation = 100
	MinPaletteBrightness = -50
	MaxPaletteBrightness = 50
)

// Zoom level bounds (percent). Zoom has its own commands rather than being an
// AppPreference.
const (
	DefaultZoomLevel = 100
	MinZoomLevel     = 50
	MaxZoomLevel     = 200
)

// TablePageSizeOptions are the only table page sizes: the pagination footers
// and the Settings dropdown offer exactly these.
func TablePageSizeOptions() []int { return []int{25, 50, 100, 250, 500, 1000} }

// Preference declares one app preference.
type Preference struct {
	Key  string
	Type ValueType
	// Default is a bool, int, or string matching Type.
	Default any
	// Min and Max bound a range integer; Max may be nil (no upper bound).
	Min, Max *int
	// Options are an enum's allowed values.
	Options []string
	// IntOptions limit an integer to a list; such an integer has no bounds.
	IntOptions []int
	// NonPositive is a range integer's rule for values <= 0.
	NonPositive NonPositive
	Validation  Validation
	// Label names an enum in "invalid <label>: <value>" errors.
	Label string
}

func bounds(minValue, maxValue int) (*int, *int) { return &minValue, &maxValue }

func flag(key string, def bool) Preference {
	return Preference{Key: key, Type: Boolean, Default: def}
}

func choice(key, def, label string, options []string) Preference {
	return Preference{Key: key, Type: Enum, Default: def, Label: label, Options: options}
}

func ranged(key string, def, minValue, maxValue int, rule NonPositive) Preference {
	lo, hi := bounds(minValue, maxValue)
	return Preference{Key: key, Type: Integer, Default: def, Min: lo, Max: hi, NonPositive: rule}
}

// atLeast declares a range integer with no upper bound.
func atLeast(key string, def, minValue int) Preference {
	return Preference{Key: key, Type: Integer, Default: def, Min: &minValue, NonPositive: NonPositiveDefault}
}

func color(key string) Preference {
	return Preference{Key: key, Type: Color, Default: "", Validation: ValidationHexColorOrEmpty}
}

var preferences = []Preference{
	flag(KeySidebarClusterResourcesExpanded, true),
	flag(KeySidebarClusterExtensionsExpanded, false),
	flag(KeySidebarNamespaceResourcesExpanded, true),
	flag(KeySidebarNamespaceExtensionsExpanded, false),
	choice(KeyAppearanceMode, "system", "appearance mode", []string{"light", "dark", "system"}),
	flag(KeyUseShortResourceNames, false),
	flag(KeyDimInactiveNamespaces, true),
	flag(KeyExclusiveNamespaces, true),
	flag(KeyErrorReportingEnabled, true),
	flag(KeyAutoRefreshEnabled, true),
	atLeast(KeyMetricsRefreshIntervalMs, DefaultMetricsRefreshIntervalMs, 1),
	ranged(KeyKubernetesClientQPS, DefaultKubernetesClientQPS, MinKubernetesClientQPS, MaxKubernetesClientQPS, NonPositiveDefault),
	ranged(KeyKubernetesClientBurst, DefaultKubernetesClientBurst, MinKubernetesClientBurst, MaxKubernetesClientBurst, NonPositiveDefault),
	ranged(KeyPermissionSSRRFetchConcurrency, DefaultPermissionSSRRFetchConcurrency, MinPermissionSSRRFetchConcurrency, MaxPermissionSSRRFetchConcurrency, NonPositiveDefault),
	ranged(KeyObjPanelLogsBufferMaxSize, DefaultObjPanelLogsBufferMaxSize, MinObjPanelLogsBufferMaxSize, MaxObjPanelLogsBufferMaxSize, NonPositiveDefault),
	{Key: KeyObjPanelLogsAPITimestampFormat, Type: String, Default: DefaultObjPanelLogsAPITimestampFormat, Validation: ValidationDayjsFormat},
	flag(KeyObjPanelLogsAPITimestampUseLocalTimeZone, false),
	ranged(KeyObjPanelLogsTargetPerScopeLimit, DefaultObjPanelLogsTargetPerScopeLimit, MinObjPanelLogsTargetPerScopeLimit, MaxObjPanelLogsTargetPerScopeLimit, NonPositiveDefault),
	ranged(KeyObjPanelLogsTargetGlobalLimit, DefaultObjPanelLogsTargetGlobalLimit, MinObjPanelLogsTargetGlobalLimit, MaxObjPanelLogsTargetGlobalLimit, NonPositiveDefault),
	choice(KeyGridTablePersistenceMode, "shared", "grid table persistence mode", []string{"shared", "namespaced"}),
	{Key: KeyDefaultTablePageSize, Type: Integer, Default: DefaultTablePageSize, IntOptions: TablePageSizeOptions()},
	choice(KeyDefaultObjectPanelPosition, DefaultObjectPanelPosition, "default object panel position", []string{"right", "bottom", "floating"}),
	ranged(KeyObjectPanelDockedRightWidth, DefaultObjectPanelDockedRightWidth, MinObjectPanelDockedRightWidth, MaxObjectPanelLayoutValue, NonPositiveDefault),
	ranged(KeyObjectPanelDockedBottomHeight, DefaultObjectPanelDockedBottomHeight, MinObjectPanelDockedBottomHeight, MaxObjectPanelLayoutValue, NonPositiveDefault),
	ranged(KeyObjectPanelFloatingWidth, DefaultObjectPanelFloatingWidth, MinObjectPanelFloatingWidth, MaxObjectPanelLayoutValue, NonPositiveDefault),
	ranged(KeyObjectPanelFloatingHeight, DefaultObjectPanelFloatingHeight, MinObjectPanelFloatingHeight, MaxObjectPanelLayoutValue, NonPositiveDefault),
	ranged(KeyPaletteHueLight, 0, MinPaletteHue, MaxPaletteHue, NonPositiveClamp),
	ranged(KeyPaletteSaturationLight, 0, MinPaletteSaturation, MaxPaletteSaturation, NonPositiveClamp),
	ranged(KeyPaletteBrightnessLight, 0, MinPaletteBrightness, MaxPaletteBrightness, NonPositiveClamp),
	ranged(KeyPaletteHueDark, 0, MinPaletteHue, MaxPaletteHue, NonPositiveClamp),
	ranged(KeyPaletteSaturationDark, 0, MinPaletteSaturation, MaxPaletteSaturation, NonPositiveClamp),
	ranged(KeyPaletteBrightnessDark, 0, MinPaletteBrightness, MaxPaletteBrightness, NonPositiveClamp),
	color(KeyAccentColorLight),
	color(KeyAccentColorDark),
	color(KeyLinkColorLight),
	color(KeyLinkColorDark),
}

var byKey = func() map[string]Preference {
	index := make(map[string]Preference, len(preferences))
	for _, p := range preferences {
		index[p.Key] = p
	}
	return index
}()

// All returns every preference in declaration order; subscribers are notified
// in this order.
func All() []Preference { return slices.Clone(preferences) }

// Lookup returns the preference declared for key.
func Lookup(key string) (Preference, bool) {
	p, ok := byKey[key]
	return p, ok
}

// MustLookup returns the preference declared for a key constant. An unknown key
// is a programming error.
func MustLookup(key string) Preference {
	p, ok := Lookup(key)
	if !ok {
		panic(fmt.Sprintf("preferenceschema: unknown preference key %q", key))
	}
	return p
}

// Validate checks a value written through UpdateAppPreferences or an import.
// A wrong type, unknown enum, or malformed color is an error.
//
// An integer with IntOptions keeps the raw number only if it equals an option;
// anything else (a fraction, an off-list value, <= 0) becomes the default.
// Any other integer: NonPositiveDefault tests the raw number before
// truncation; otherwise the number truncates toward zero and clamps.
func (p Preference) Validate(raw any) (any, error) {
	switch p.Type {
	case Boolean:
		value, ok := raw.(bool)
		if !ok {
			return nil, p.typeError("boolean")
		}
		return value, nil
	case Integer:
		return p.validateInteger(raw)
	case Enum, Color, String:
		return p.validateString(raw)
	}
	return nil, fmt.Errorf("%s: unsupported preference type %q", p.Key, p.Type)
}

// Repair settles a stored value read back from settings.json: anything Validate
// rejects becomes the default.
func (p Preference) Repair(raw any) any {
	value, err := p.Validate(raw)
	if err != nil {
		return p.Default
	}
	return value
}

func (p Preference) typeError(kind string) error {
	return fmt.Errorf("%s: expected %s value", p.Key, kind)
}

func (p Preference) validateInteger(raw any) (any, error) {
	number, ok := numberValue(raw)
	if !ok {
		return nil, p.typeError("integer")
	}
	if len(p.IntOptions) > 0 {
		if number == math.Trunc(number) && slices.Contains(p.IntOptions, int(number)) {
			return int(number), nil
		}
		return p.Default, nil
	}
	if number <= 0 && p.NonPositive == NonPositiveDefault {
		return p.Default, nil
	}
	return p.clamp(math.Trunc(number)), nil
}

// clamp bounds a whole number in float space, so a huge value cannot overflow
// the int conversion.
func (p Preference) clamp(number float64) int {
	if p.Min != nil && number < float64(*p.Min) {
		return *p.Min
	}
	if p.Max != nil && number > float64(*p.Max) {
		return *p.Max
	}
	return int(math.Max(math.Min(number, math.MaxInt32), math.MinInt32))
}

func (p Preference) validateString(raw any) (any, error) {
	value, ok := raw.(string)
	if !ok {
		return nil, p.typeError("string")
	}
	switch {
	case p.Type == Enum && !slices.Contains(p.Options, value):
		return nil, fmt.Errorf("invalid %s: %s", p.Label, value)
	case p.Type == Color && value != "" && !hexColor.MatchString(value):
		return nil, fmt.Errorf("invalid color format for %s: %s (expected #rrggbb)", p.Key, value)
	case p.Type == String && value == "":
		return p.Default, nil
	}
	return value, nil
}

// numberValue reads a JSON or Go number; NaN and infinities are not numbers a
// setting can hold.
func numberValue(raw any) (float64, bool) {
	var number float64
	switch v := raw.(type) {
	case int:
		number = float64(v)
	case int8:
		number = float64(v)
	case int16:
		number = float64(v)
	case int32:
		number = float64(v)
	case int64:
		number = float64(v)
	case float32:
		number = float64(v)
	case float64:
		number = v
	case json.Number:
		parsed, err := v.Float64()
		if err != nil {
			return 0, false
		}
		number = parsed
	default:
		return 0, false
	}
	return number, !math.IsNaN(number) && !math.IsInf(number, 0)
}
