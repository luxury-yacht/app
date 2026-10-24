package backend

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/internal/preferenceschema"
)

// preferenceDescriptor binds one preference declared in preferenceschema to the
// AppSettings field that holds it, the runtime effect a change flags, and its
// change-log text. The schema owns the key, type, default, bounds, allowed
// values, and validation. applyAppPreferenceChange, settings-file repair,
// import validation, and the change log iterate this table, so adding a
// preference is one schema row, one row here, and its settings.json mapping in
// readAppPreferences/writeAppPreferences.
type preferenceDescriptor struct {
	spec preferenceschema.Preference
	// logText, when set, prefixes the change log line ("<logText>: <value>").
	// Keys without it log the generic "Preference <key> changed to" line.
	logText string
	// logsValue marks keys whose applied value appears in the change log; the
	// rest log a nil value (the historical log output).
	logsValue bool
	// skipChangeLog suppresses both named and generic preference log entries.
	skipChangeLog bool
	// current reads the field (for repair, import validation, and the change log).
	current func(*AppSettings) any
	// set writes a value the spec has already validated.
	set func(*AppSettings, any)
	// effect flags the runtime owner a change must reach, if any.
	effect func(*settingsSideEffects)
}

// apply validates an incoming value against the spec, writes it, and flags the
// change's runtime effect.
func (d preferenceDescriptor) apply(settings *AppSettings, raw any, effects *settingsSideEffects) error {
	value, err := d.spec.Validate(raw)
	if err != nil {
		return err
	}
	d.set(settings, value)
	if d.effect != nil {
		d.effect(effects)
	}
	return nil
}

func (d preferenceDescriptor) repair(settings *AppSettings) {
	d.set(settings, d.spec.Repair(d.current(settings)))
}

// bindPreference binds key to a field of type T; T must match the spec's type.
func bindPreference[T any](key, logText string, effect func(*settingsSideEffects), field func(*AppSettings) *T) preferenceDescriptor {
	return preferenceDescriptor{
		spec:      preferenceschema.MustLookup(key),
		logText:   logText,
		logsValue: logText != "",
		current:   func(s *AppSettings) any { return *field(s) },
		set:       func(s *AppSettings, value any) { *field(s) = value.(T) },
		effect:    effect,
	}
}

func unloggedPreference(descriptor preferenceDescriptor) preferenceDescriptor {
	descriptor.skipChangeLog = true
	return descriptor
}

func rateLimitEffect(e *settingsSideEffects) { e.kubernetesClientRateLimits = true }

// appPreferenceTable is in schema declaration order (a binding-coverage test
// holds it there).
var appPreferenceTable = []preferenceDescriptor{
	unloggedPreference(bindPreference(preferenceschema.KeySidebarClusterResourcesExpanded, "", nil,
		func(s *AppSettings) *bool { return &s.SidebarClusterResourcesExpanded })),
	unloggedPreference(bindPreference(preferenceschema.KeySidebarClusterExtensionsExpanded, "", nil,
		func(s *AppSettings) *bool { return &s.SidebarClusterExtensionsExpanded })),
	unloggedPreference(bindPreference(preferenceschema.KeySidebarNamespaceResourcesExpanded, "", nil,
		func(s *AppSettings) *bool { return &s.SidebarNamespaceResourcesExpanded })),
	unloggedPreference(bindPreference(preferenceschema.KeySidebarNamespaceExtensionsExpanded, "", nil,
		func(s *AppSettings) *bool { return &s.SidebarNamespaceExtensionsExpanded })),
	bindPreference(preferenceschema.KeyAppearanceMode, "Appearance mode changed to", nil,
		func(s *AppSettings) *string { return &s.AppearanceMode }),
	bindPreference(preferenceschema.KeyUseShortResourceNames, "Use short resource names changed to", nil,
		func(s *AppSettings) *bool { return &s.UseShortResourceNames }),
	bindPreference(preferenceschema.KeyDimInactiveNamespaces, "Dim inactive namespaces changed to", nil,
		func(s *AppSettings) *bool { return &s.DimInactiveNamespaces }),
	bindPreference(preferenceschema.KeyExclusiveNamespaces, "Exclusive namespaces changed to", nil,
		func(s *AppSettings) *bool { return &s.ExclusiveNamespaces }),
	bindPreference(preferenceschema.KeyErrorReportingEnabled, "Error reporting enabled changed to",
		func(e *settingsSideEffects) { e.errorReporting = true },
		func(s *AppSettings) *bool { return &s.ErrorReportingEnabled }),
	bindPreference(preferenceschema.KeyAutoRefreshEnabled, "Auto refresh enabled changed to", nil,
		func(s *AppSettings) *bool { return &s.AutoRefreshEnabled }),
	loggedValue(bindPreference(preferenceschema.KeyMetricsRefreshIntervalMs, "",
		func(e *settingsSideEffects) { e.metricsInterval = true },
		func(s *AppSettings) *int { return &s.MetricsRefreshIntervalMs })),
	bindPreference(preferenceschema.KeyKubernetesClientQPS, "Kubernetes client QPS changed to", rateLimitEffect,
		func(s *AppSettings) *int { return &s.KubernetesClientQPS }),
	bindPreference(preferenceschema.KeyKubernetesClientBurst, "Kubernetes client burst changed to", rateLimitEffect,
		func(s *AppSettings) *int { return &s.KubernetesClientBurst }),
	bindPreference(preferenceschema.KeyPermissionSSRRFetchConcurrency, "Permission SSRR fetch concurrency changed to",
		func(e *settingsSideEffects) { e.permissionFetchConcurrency = true },
		func(s *AppSettings) *int { return &s.PermissionSSRRFetchConcurrency }),
	bindPreference(preferenceschema.KeyObjPanelLogsBufferMaxSize, "ObjPanelLogs buffer max size changed to", nil,
		func(s *AppSettings) *int { return &s.ObjPanelLogsBufferMaxSize }),
	bindPreference(preferenceschema.KeyObjPanelLogsAPITimestampFormat, "Object Panel Logs Tab API timestamp format changed to", nil,
		func(s *AppSettings) *string { return &s.ObjPanelLogsAPITimestampFormat }),
	bindPreference(preferenceschema.KeyObjPanelLogsAPITimestampUseLocalTimeZone, "Object Panel Logs Tab API timestamp local timezone changed to", nil,
		func(s *AppSettings) *bool { return &s.ObjPanelLogsAPITimestampUseLocalTimeZone }),
	bindPreference(preferenceschema.KeyObjPanelLogsTargetPerScopeLimit, "Object Panel Logs Tab target per-scope limit changed to",
		func(e *settingsSideEffects) { e.containerLogsPerScopeLimit = true },
		func(s *AppSettings) *int { return &s.ObjPanelLogsTargetPerScopeLimit }),
	bindPreference(preferenceschema.KeyObjPanelLogsTargetGlobalLimit, "Object Panel Logs Tab target global limit changed to",
		func(e *settingsSideEffects) { e.containerLogsGlobalLimit = true },
		func(s *AppSettings) *int { return &s.ObjPanelLogsTargetGlobalLimit }),
	bindPreference(preferenceschema.KeyGridTablePersistenceMode, "Grid table persistence mode changed to", nil,
		func(s *AppSettings) *string { return &s.GridTablePersistenceMode }),
	bindPreference(preferenceschema.KeyDefaultTablePageSize, "Default table page size changed to", nil,
		func(s *AppSettings) *int { return &s.DefaultTablePageSize }),
	bindPreference(preferenceschema.KeyDefaultObjectPanelPosition, "Default object panel position changed to", nil,
		func(s *AppSettings) *string { return &s.DefaultObjectPanelPosition }),
	bindPreference(preferenceschema.KeyObjectPanelDockedRightWidth, "", nil,
		func(s *AppSettings) *int { return &s.ObjectPanelDockedRightWidth }),
	bindPreference(preferenceschema.KeyObjectPanelDockedBottomHeight, "", nil,
		func(s *AppSettings) *int { return &s.ObjectPanelDockedBottomHeight }),
	bindPreference(preferenceschema.KeyObjectPanelFloatingWidth, "", nil,
		func(s *AppSettings) *int { return &s.ObjectPanelFloatingWidth }),
	bindPreference(preferenceschema.KeyObjectPanelFloatingHeight, "", nil,
		func(s *AppSettings) *int { return &s.ObjectPanelFloatingHeight }),
	bindPreference(preferenceschema.KeyPaletteHueLight, "Palette hue light changed to", nil,
		func(s *AppSettings) *int { return &s.PaletteHueLight }),
	bindPreference(preferenceschema.KeyPaletteSaturationLight, "Palette saturation light changed to", nil,
		func(s *AppSettings) *int { return &s.PaletteSaturationLight }),
	bindPreference(preferenceschema.KeyPaletteBrightnessLight, "Palette brightness light changed to", nil,
		func(s *AppSettings) *int { return &s.PaletteBrightnessLight }),
	bindPreference(preferenceschema.KeyPaletteHueDark, "Palette hue dark changed to", nil,
		func(s *AppSettings) *int { return &s.PaletteHueDark }),
	bindPreference(preferenceschema.KeyPaletteSaturationDark, "Palette saturation dark changed to", nil,
		func(s *AppSettings) *int { return &s.PaletteSaturationDark }),
	bindPreference(preferenceschema.KeyPaletteBrightnessDark, "Palette brightness dark changed to", nil,
		func(s *AppSettings) *int { return &s.PaletteBrightnessDark }),
	bindPreference(preferenceschema.KeyAccentColorLight, "Accent color light changed to", nil,
		func(s *AppSettings) *string { return &s.AccentColorLight }),
	bindPreference(preferenceschema.KeyAccentColorDark, "Accent color dark changed to", nil,
		func(s *AppSettings) *string { return &s.AccentColorDark }),
	bindPreference(preferenceschema.KeyLinkColorLight, "Link color light changed to", nil,
		func(s *AppSettings) *string { return &s.LinkColorLight }),
	bindPreference(preferenceschema.KeyLinkColorDark, "Link color dark changed to", nil,
		func(s *AppSettings) *string { return &s.LinkColorDark }),
}

// loggedValue logs the applied value under the generic change line.
func loggedValue(descriptor preferenceDescriptor) preferenceDescriptor {
	descriptor.logsValue = true
	return descriptor
}

func appPreferenceDescriptors() []preferenceDescriptor {
	return appPreferenceTable
}

func applyAppPreferenceChange(settings *AppSettings, change AppPreferenceChange, effects *settingsSideEffects) error {
	if settings == nil {
		return fmt.Errorf("settings are not loaded")
	}
	for _, descriptor := range appPreferenceDescriptors() {
		if descriptor.spec.Key == change.Key {
			return descriptor.apply(settings, change.Value, effects)
		}
	}
	return fmt.Errorf("unknown preference key: %s", change.Key)
}

// defaultAppPreferences returns AppSettings holding every preference default.
func defaultAppPreferences() *AppSettings {
	settings := &AppSettings{}
	for _, descriptor := range appPreferenceDescriptors() {
		descriptor.set(settings, descriptor.spec.Default)
	}
	return settings
}

// repairAppPreferences settles every preference read back from a settings
// file, the way the schema repairs a stored value.
func repairAppPreferences(settings *AppSettings) {
	for _, descriptor := range appPreferenceDescriptors() {
		descriptor.repair(settings)
	}
}

// repairIntPreference is a runtime owner's guard on an integer preference value
// it receives.
func repairIntPreference(key string, value int) int {
	return preferenceschema.MustLookup(key).Repair(value).(int)
}

func logPreferenceChange(logger *Logger, key string, value any) {
	if logger == nil {
		return
	}
	for _, descriptor := range appPreferenceDescriptors() {
		if descriptor.spec.Key != key {
			continue
		}
		if descriptor.skipChangeLog {
			return
		}
		if descriptor.logText != "" {
			logger.Info(fmt.Sprintf("%s: %v", descriptor.logText, value), logsources.Settings)
			return
		}
		break
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
		if descriptor.spec.Key == key {
			if !descriptor.logsValue {
				return nil
			}
			return descriptor.current(settings)
		}
	}
	return nil
}
