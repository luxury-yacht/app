package backend

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/logsources"
)

// preferenceDescriptor declares one app preference in one place: its key,
// schema metadata, how a change is validated/clamped and applied to
// *AppSettings (including runtime side-effect flags), and how its value is
// read back for the schema and the change log. applyAppPreferenceChange,
// buildAppSettingsSchema, appPreferenceKeys, and logPreferenceChange all
// iterate this table, so adding a preference is one row here (plus its
// persistence mapping in normalize/load/saveAppSettings).
type preferenceDescriptor struct {
	key               string
	valueType         string
	defaultValue      any
	min, max          *int
	enumOptions       []string
	validation        string
	runtimeSideEffect bool
	// logText, when set, prefixes the change log line ("<logText>: <value>").
	// Keys without it log the generic "Preference <key> changed to" line.
	logText string
	// logsValue marks keys whose applied value appears in the change log; the
	// rest log a nil value (the historical log output).
	logsValue bool
	// current reads the schema CurrentValue (and the logged value).
	current func(*AppSettings) any
	// apply validates/clamps the incoming value and writes it, flagging any
	// runtime side effects. key is passed through for error wrapping.
	apply func(settings *AppSettings, key string, value any, effects *settingsSideEffects) error
}

// boolPreference declares a boolean preference over a field pointer.
func boolPreference(key string, defaultValue, sideEffect bool, logText string, field func(*AppSettings) *bool) preferenceDescriptor {
	return preferenceDescriptor{
		key: key, valueType: "boolean", defaultValue: defaultValue, runtimeSideEffect: sideEffect,
		logText: logText, logsValue: logText != "",
		current: func(s *AppSettings) any { return *field(s) },
		apply: func(settings *AppSettings, key string, raw any, _ *settingsSideEffects) error {
			value, err := boolPreferenceValue(raw)
			if err != nil {
				return fmt.Errorf("%s: %w", key, err)
			}
			*field(settings) = value
			return nil
		},
	}
}

// intPreference declares an integer preference over a field pointer. transform
// clamps/defaults the incoming value; effect (optional) flags a runtime side
// effect to apply after save.
func intPreference(key string, defaultValue int, minValue, maxValue *int, sideEffect bool, logText string, transform func(int) int, effect func(*settingsSideEffects), field func(*AppSettings) *int) preferenceDescriptor {
	return preferenceDescriptor{
		key: key, valueType: "integer", defaultValue: defaultValue, min: minValue, max: maxValue,
		runtimeSideEffect: sideEffect, logText: logText, logsValue: logText != "",
		current: func(s *AppSettings) any { return *field(s) },
		apply: func(settings *AppSettings, key string, raw any, effects *settingsSideEffects) error {
			value, err := intPreferenceValue(raw)
			if err != nil {
				return fmt.Errorf("%s: %w", key, err)
			}
			*field(settings) = transform(value)
			if effect != nil {
				effect(effects)
			}
			return nil
		},
	}
}

// enumPreference declares a string preference restricted to options, reporting
// "invalid <label>: <value>" otherwise.
func enumPreference(key, defaultValue, label string, options []string, sideEffect bool, logText string, field func(*AppSettings) *string) preferenceDescriptor {
	return preferenceDescriptor{
		key: key, valueType: "enum", defaultValue: defaultValue, enumOptions: options,
		runtimeSideEffect: sideEffect, logText: logText, logsValue: logText != "",
		current: func(s *AppSettings) any { return *field(s) },
		apply: func(settings *AppSettings, key string, raw any, _ *settingsSideEffects) error {
			value, err := stringPreferenceValue(raw)
			if err != nil {
				return fmt.Errorf("%s: %w", key, err)
			}
			valid := false
			for _, option := range options {
				if value == option {
					valid = true
					break
				}
			}
			if !valid {
				return fmt.Errorf("invalid %s: %s", label, value)
			}
			*field(settings) = value
			return nil
		},
	}
}

// colorPreference declares an optional #rrggbb color preference.
func colorPreference(key string, field func(*AppSettings) *string) preferenceDescriptor {
	return preferenceDescriptor{
		key: key, valueType: "color", defaultValue: "", validation: "#rrggbb-or-empty",
		current: func(s *AppSettings) any { return *field(s) },
		apply: func(settings *AppSettings, key string, raw any, _ *settingsSideEffects) error {
			color, err := stringPreferenceValue(raw)
			if err != nil {
				return fmt.Errorf("%s: %w", key, err)
			}
			if color != "" && !validHexColorRe.MatchString(color) {
				return fmt.Errorf("invalid color format for %s: %s (expected #rrggbb)", key, color)
			}
			*field(settings) = color
			return nil
		},
	}
}

// clampRange returns a clampInt transform over [minValue, maxValue].
func clampRange(minValue, maxValue int) func(int) int {
	return func(value int) int { return clampInt(value, minValue, maxValue) }
}

// zeroDefaulted substitutes defaultValue for non-positive values before next.
func zeroDefaulted(defaultValue int, next func(int) int) func(int) int {
	return func(value int) int {
		if value <= 0 {
			value = defaultValue
		}
		if next != nil {
			value = next(value)
		}
		return value
	}
}

func rateLimitEffect(e *settingsSideEffects) { e.kubernetesClientRateLimits = true }

// appPreferenceDescriptors builds the preference table. It is rebuilt per call
// because the metrics-interval default is derived at read time.
func appPreferenceDescriptors() []preferenceDescriptor {
	metricsInterval := intPreference(appPreferenceMetricsRefreshIntervalMs, defaultMetricsIntervalMs(), intPtr(1), nil, true, "",
		zeroDefaulted(defaultMetricsIntervalMs(), nil),
		func(e *settingsSideEffects) { e.metricsInterval = true },
		func(s *AppSettings) *int { return &s.MetricsRefreshIntervalMs })
	// The metrics interval logs its applied value under the generic line.
	metricsInterval.logsValue = true

	timestampFormat := preferenceDescriptor{
		key: appPreferenceObjPanelLogsAPITimestampFormat, valueType: "string",
		defaultValue: defaultObjPanelLogsAPITimestampFormat, validation: "dayjs-format",
		logText: "Object Panel Logs Tab API timestamp format changed to", logsValue: true,
		current: func(s *AppSettings) any { return s.ObjPanelLogsAPITimestampFormat },
		apply: func(settings *AppSettings, key string, raw any, _ *settingsSideEffects) error {
			value, err := stringPreferenceValue(raw)
			if err != nil {
				return fmt.Errorf("%s: %w", key, err)
			}
			if value == "" {
				value = defaultObjPanelLogsAPITimestampFormat
			}
			settings.ObjPanelLogsAPITimestampFormat = value
			return nil
		},
	}

	return []preferenceDescriptor{
		enumPreference(appPreferenceAppearanceMode, "system", "appearance mode", []string{"light", "dark", "system"}, true,
			"Appearance mode changed to", func(s *AppSettings) *string { return &s.AppearanceMode }),
		boolPreference(appPreferenceUseShortResourceNames, false, false,
			"Use short resource names changed to", func(s *AppSettings) *bool { return &s.UseShortResourceNames }),
		boolPreference(appPreferenceDimInactiveNamespaces, true, false,
			"Dim inactive namespaces changed to", func(s *AppSettings) *bool { return &s.DimInactiveNamespaces }),
		boolPreference(appPreferenceExclusiveNamespaces, true, false,
			"Exclusive namespaces changed to", func(s *AppSettings) *bool { return &s.ExclusiveNamespaces }),
		boolPreference(appPreferenceAutoRefreshEnabled, true, true,
			"Auto refresh enabled changed to", func(s *AppSettings) *bool { return &s.AutoRefreshEnabled }),
		boolPreference(appPreferenceRefreshBackgroundClustersEnabled, true, true,
			"Background refresh enabled changed to", func(s *AppSettings) *bool { return &s.RefreshBackgroundClustersEnabled }),
		metricsInterval,
		intPreference(appPreferenceKubernetesClientQPS, defaultKubernetesClientQPS, intPtr(minKubernetesClientQPS), intPtr(maxKubernetesClientQPS), true,
			"Kubernetes client QPS changed to", clampKubernetesClientQPS, rateLimitEffect,
			func(s *AppSettings) *int { return &s.KubernetesClientQPS }),
		intPreference(appPreferenceKubernetesClientBurst, defaultKubernetesClientBurst, intPtr(minKubernetesClientBurst), intPtr(maxKubernetesClientBurst), true,
			"Kubernetes client burst changed to", clampKubernetesClientBurst, rateLimitEffect,
			func(s *AppSettings) *int { return &s.KubernetesClientBurst }),
		intPreference(appPreferencePermissionSSRRFetchConcurrency, defaultPermissionSSRRFetchConcurrency, intPtr(minPermissionSSRRFetchConcurrency), intPtr(maxPermissionSSRRFetchConcurrency), false,
			"Permission SSRR fetch concurrency changed to", clampPermissionSSRRFetchConcurrency, nil,
			func(s *AppSettings) *int { return &s.PermissionSSRRFetchConcurrency }),
		intPreference(appPreferenceObjPanelLogsBufferMaxSize, defaultObjPanelLogsBufferMaxSize, intPtr(minObjPanelLogsBufferMaxSize), intPtr(maxObjPanelLogsBufferMaxSize), false,
			"ObjPanelLogs buffer max size changed to", clampObjPanelLogsBufferMaxSize, nil,
			func(s *AppSettings) *int { return &s.ObjPanelLogsBufferMaxSize }),
		timestampFormat,
		boolPreference(appPreferenceObjPanelLogsAPITimestampUseLocalTimeZone, false, false,
			"Object Panel Logs Tab API timestamp local timezone changed to", func(s *AppSettings) *bool { return &s.ObjPanelLogsAPITimestampUseLocalTimeZone }),
		intPreference(appPreferenceObjPanelLogsTargetPerScopeLimit, defaultObjPanelLogsTargetPerScopeLimit, intPtr(minObjPanelLogsTargetPerScopeLimit), intPtr(maxObjPanelLogsTargetPerScopeLimit), true,
			"Object Panel Logs Tab target per-scope limit changed to", clampObjPanelLogsTargetPerScopeLimit,
			func(e *settingsSideEffects) { e.containerLogsPerScopeLimit = true },
			func(s *AppSettings) *int { return &s.ObjPanelLogsTargetPerScopeLimit }),
		intPreference(appPreferenceObjPanelLogsTargetGlobalLimit, defaultObjPanelLogsTargetGlobalLimit, intPtr(minObjPanelLogsTargetGlobalLimit), intPtr(maxObjPanelLogsTargetGlobalLimit), true,
			"Object Panel Logs Tab target global limit changed to", clampObjPanelLogsTargetGlobalLimit,
			func(e *settingsSideEffects) { e.containerLogsGlobalLimit = true },
			func(s *AppSettings) *int { return &s.ObjPanelLogsTargetGlobalLimit }),
		enumPreference(appPreferenceGridTablePersistenceMode, "shared", "grid table persistence mode", []string{"shared", "namespaced"}, false,
			"Grid table persistence mode changed to", func(s *AppSettings) *string { return &s.GridTablePersistenceMode }),
		intPreference(appPreferenceDefaultTablePageSize, defaultTablePageSize, intPtr(minTablePageSize), intPtr(maxTablePageSize), false,
			"Default table page size changed to", clampRange(minTablePageSize, maxTablePageSize), nil,
			func(s *AppSettings) *int { return &s.DefaultTablePageSize }),
		enumPreference(appPreferenceDefaultObjectPanelPosition, defaultObjectPanelPosition, "default object panel position", []string{"right", "bottom", "floating"}, false,
			"Default object panel position changed to", func(s *AppSettings) *string { return &s.DefaultObjectPanelPosition }),
		intPreference(appPreferenceObjectPanelDockedRightWidth, defaultObjectPanelDockedRightWidth, intPtr(minObjectPanelDockedRightWidth), intPtr(maxObjectPanelLayoutValue), false,
			"", clampRange(minObjectPanelDockedRightWidth, maxObjectPanelLayoutValue), nil,
			func(s *AppSettings) *int { return &s.ObjectPanelDockedRightWidth }),
		intPreference(appPreferenceObjectPanelDockedBottomHeight, defaultObjectPanelDockedBottomHeight, intPtr(minObjectPanelDockedBottomHeight), intPtr(maxObjectPanelLayoutValue), false,
			"", clampRange(minObjectPanelDockedBottomHeight, maxObjectPanelLayoutValue), nil,
			func(s *AppSettings) *int { return &s.ObjectPanelDockedBottomHeight }),
		intPreference(appPreferenceObjectPanelFloatingWidth, defaultObjectPanelFloatingWidth, intPtr(minObjectPanelFloatingWidth), intPtr(maxObjectPanelLayoutValue), false,
			"", clampRange(minObjectPanelFloatingWidth, maxObjectPanelLayoutValue), nil,
			func(s *AppSettings) *int { return &s.ObjectPanelFloatingWidth }),
		intPreference(appPreferenceObjectPanelFloatingHeight, defaultObjectPanelFloatingHeight, intPtr(minObjectPanelFloatingHeight), intPtr(maxObjectPanelLayoutValue), false,
			"", clampRange(minObjectPanelFloatingHeight, maxObjectPanelLayoutValue), nil,
			func(s *AppSettings) *int { return &s.ObjectPanelFloatingHeight }),
		intPreference(appPreferenceObjectPanelFloatingX, defaultObjectPanelFloatingX, intPtr(minObjectPanelFloatingX), intPtr(maxObjectPanelLayoutValue), false,
			"", zeroDefaulted(defaultObjectPanelFloatingX, clampRange(minObjectPanelFloatingX, maxObjectPanelLayoutValue)), nil,
			func(s *AppSettings) *int { return &s.ObjectPanelFloatingX }),
		intPreference(appPreferenceObjectPanelFloatingY, defaultObjectPanelFloatingY, intPtr(minObjectPanelFloatingY), intPtr(maxObjectPanelLayoutValue), false,
			"", zeroDefaulted(defaultObjectPanelFloatingY, clampRange(minObjectPanelFloatingY, maxObjectPanelLayoutValue)), nil,
			func(s *AppSettings) *int { return &s.ObjectPanelFloatingY }),
		intPreference(appPreferencePaletteHueLight, 0, intPtr(minPaletteHue), intPtr(maxPaletteHue), false,
			"", clampRange(minPaletteHue, maxPaletteHue), nil,
			func(s *AppSettings) *int { return &s.PaletteHueLight }),
		intPreference(appPreferencePaletteSaturationLight, 0, intPtr(minPaletteSaturation), intPtr(maxPaletteSaturation), false,
			"", clampRange(minPaletteSaturation, maxPaletteSaturation), nil,
			func(s *AppSettings) *int { return &s.PaletteSaturationLight }),
		intPreference(appPreferencePaletteBrightnessLight, 0, intPtr(minPaletteBrightness), intPtr(maxPaletteBrightness), false,
			"", clampRange(minPaletteBrightness, maxPaletteBrightness), nil,
			func(s *AppSettings) *int { return &s.PaletteBrightnessLight }),
		intPreference(appPreferencePaletteHueDark, 0, intPtr(minPaletteHue), intPtr(maxPaletteHue), false,
			"", clampRange(minPaletteHue, maxPaletteHue), nil,
			func(s *AppSettings) *int { return &s.PaletteHueDark }),
		intPreference(appPreferencePaletteSaturationDark, 0, intPtr(minPaletteSaturation), intPtr(maxPaletteSaturation), false,
			"", clampRange(minPaletteSaturation, maxPaletteSaturation), nil,
			func(s *AppSettings) *int { return &s.PaletteSaturationDark }),
		intPreference(appPreferencePaletteBrightnessDark, 0, intPtr(minPaletteBrightness), intPtr(maxPaletteBrightness), false,
			"", clampRange(minPaletteBrightness, maxPaletteBrightness), nil,
			func(s *AppSettings) *int { return &s.PaletteBrightnessDark }),
		colorPreference(appPreferenceAccentColorLight, func(s *AppSettings) *string { return &s.AccentColorLight }),
		colorPreference(appPreferenceAccentColorDark, func(s *AppSettings) *string { return &s.AccentColorDark }),
		colorPreference(appPreferenceLinkColorLight, func(s *AppSettings) *string { return &s.LinkColorLight }),
		colorPreference(appPreferenceLinkColorDark, func(s *AppSettings) *string { return &s.LinkColorDark }),
	}
}

func applyAppPreferenceChange(settings *AppSettings, change AppPreferenceChange, effects *settingsSideEffects) error {
	if settings == nil {
		return fmt.Errorf("settings are not loaded")
	}
	for _, descriptor := range appPreferenceDescriptors() {
		if descriptor.key == change.Key {
			return descriptor.apply(settings, change.Key, change.Value, effects)
		}
	}
	return fmt.Errorf("unknown preference key: %s", change.Key)
}

func buildAppSettingsSchema(settings *AppSettings) *AppSettingsSchema {
	if settings == nil {
		settings = getDefaultAppSettings()
	}
	descriptors := appPreferenceDescriptors()
	preferences := make([]AppPreferenceSchema, 0, len(descriptors))
	for _, descriptor := range descriptors {
		preferences = append(preferences, AppPreferenceSchema{
			Key:               descriptor.key,
			Type:              descriptor.valueType,
			DefaultValue:      descriptor.defaultValue,
			CurrentValue:      descriptor.current(settings),
			Min:               descriptor.min,
			Max:               descriptor.max,
			EnumOptions:       descriptor.enumOptions,
			Validation:        descriptor.validation,
			RuntimeSideEffect: descriptor.runtimeSideEffect,
		})
	}
	return &AppSettingsSchema{Preferences: preferences}
}

func appPreferenceKeys() []string {
	descriptors := appPreferenceDescriptors()
	keys := make([]string, 0, len(descriptors))
	for _, descriptor := range descriptors {
		keys = append(keys, descriptor.key)
	}
	return keys
}

func logPreferenceChange(logger *Logger, key string, value any) {
	if logger == nil {
		return
	}
	for _, descriptor := range appPreferenceDescriptors() {
		if descriptor.key == key && descriptor.logText != "" {
			logger.Info(fmt.Sprintf("%s: %v", descriptor.logText, value), logsources.Settings)
			return
		}
	}
	logger.Info(fmt.Sprintf("Preference %s changed to: %v", key, value), logsources.Settings)
}

// preferenceValueForLog reads the applied value for the change log. Keys
// without logsValue report nil (the historical log output).
func preferenceValueForLog(settings *AppSettings, key string) any {
	if settings == nil {
		return nil
	}
	for _, descriptor := range appPreferenceDescriptors() {
		if descriptor.key == key {
			if !descriptor.logsValue {
				return nil
			}
			return descriptor.current(settings)
		}
	}
	return nil
}
