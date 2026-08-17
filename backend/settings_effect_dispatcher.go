package backend

import (
	"fmt"
	"sync"

	"github.com/luxury-yacht/app/backend/internal/logsources"
)

type ErrorReportingEnabledSetter interface {
	SetErrorReportingEnabled(bool) error
}

type KubernetesClientRateLimitsSetter interface {
	SetKubernetesClientRateLimits(qps, burst int)
}

type PermissionFetchConcurrencySetter interface {
	SetPermissionFetchConcurrency(int)
}

type ContainerLogsPerScopeLimitSetter interface {
	SetContainerLogsPerScopeLimit(int)
}

type RefreshSettingSink interface {
	SetContainerLogsGlobalLimit(int)
	SetMetricsRefreshInterval(int)
}

// refreshSettingBridge breaks the composition cycle between Preferences and
// Refresh without exposing a partially configured owner. Values are retained
// until the refresh target is constructed, then pushed before composition
// returns. Calls into the target happen outside the bridge lock.
type refreshSettingBridge struct {
	mu          sync.Mutex
	target      RefreshSettingSink
	globalLimit int
	metricsMs   int
}

func newRefreshSettingBridge(globalLimit, metricsMs int) *refreshSettingBridge {
	return &refreshSettingBridge{globalLimit: globalLimit, metricsMs: metricsMs}
}

func (b *refreshSettingBridge) SetContainerLogsGlobalLimit(limit int) {
	if b == nil {
		return
	}
	b.mu.Lock()
	b.globalLimit = limit
	target := b.target
	b.mu.Unlock()
	if target != nil {
		target.SetContainerLogsGlobalLimit(limit)
	}
}

func (b *refreshSettingBridge) SetMetricsRefreshInterval(intervalMs int) {
	if b == nil {
		return
	}
	b.mu.Lock()
	b.metricsMs = intervalMs
	target := b.target
	b.mu.Unlock()
	if target != nil {
		target.SetMetricsRefreshInterval(intervalMs)
	}
}

func (b *refreshSettingBridge) Bind(target RefreshSettingSink) {
	if b == nil || target == nil {
		return
	}
	b.mu.Lock()
	b.target = target
	globalLimit := b.globalLimit
	metricsMs := b.metricsMs
	b.mu.Unlock()
	target.SetContainerLogsGlobalLimit(globalLimit)
	target.SetMetricsRefreshInterval(metricsMs)
}

// SettingsEffectDispatcher is the complete write-only bridge from persisted
// preference commits to runtime owners.
type SettingsEffectDispatcher struct {
	errorReporting ErrorReportingEnabledSetter
	cluster        KubernetesClientRateLimitsSetter
	permission     PermissionFetchConcurrencySetter
	containerLogs  ContainerLogsPerScopeLimitSetter
	refresh        RefreshSettingSink
	logger         *Logger
}

func NewSettingsEffectDispatcher(
	errorReporting ErrorReportingEnabledSetter,
	cluster KubernetesClientRateLimitsSetter,
	permission PermissionFetchConcurrencySetter,
	containerLogs ContainerLogsPerScopeLimitSetter,
	refresh RefreshSettingSink,
	logger *Logger,
) *SettingsEffectDispatcher {
	return &SettingsEffectDispatcher{
		errorReporting: errorReporting,
		cluster:        cluster,
		permission:     permission,
		containerLogs:  containerLogs,
		refresh:        refresh,
		logger:         logger,
	}
}

func (d *SettingsEffectDispatcher) Dispatch(settings *AppSettings, effects settingsSideEffects) {
	if d == nil || settings == nil {
		return
	}
	d.dispatchErrorReporting(settings, effects)
	d.dispatchKubernetesClientRateLimits(settings, effects)
	d.dispatchPermissionFetchConcurrency(settings, effects)
	d.dispatchContainerLogsPerScopeLimit(settings, effects)
	d.dispatchContainerLogsGlobalLimit(settings, effects)
	d.dispatchMetricsInterval(settings, effects)
}

func (d *SettingsEffectDispatcher) dispatchErrorReporting(settings *AppSettings, effects settingsSideEffects) {
	if effects.errorReporting && d.errorReporting != nil {
		if err := d.errorReporting.SetErrorReportingEnabled(settings.ErrorReportingEnabled); err != nil && d.logger != nil {
			d.logger.Warn(fmt.Sprintf("Could not update error reporting: %v", err), logsources.Settings)
		}
	}
}

func (d *SettingsEffectDispatcher) dispatchKubernetesClientRateLimits(settings *AppSettings, effects settingsSideEffects) {
	if effects.kubernetesClientRateLimits && d.cluster != nil {
		d.cluster.SetKubernetesClientRateLimits(settings.KubernetesClientQPS, settings.KubernetesClientBurst)
	}
}

func (d *SettingsEffectDispatcher) dispatchPermissionFetchConcurrency(settings *AppSettings, effects settingsSideEffects) {
	if effects.permissionFetchConcurrency && d.permission != nil {
		d.permission.SetPermissionFetchConcurrency(settings.PermissionSSRRFetchConcurrency)
	}
}

func (d *SettingsEffectDispatcher) dispatchContainerLogsPerScopeLimit(settings *AppSettings, effects settingsSideEffects) {
	if effects.containerLogsPerScopeLimit && d.containerLogs != nil {
		d.containerLogs.SetContainerLogsPerScopeLimit(settings.ObjPanelLogsTargetPerScopeLimit)
	}
}

func (d *SettingsEffectDispatcher) dispatchContainerLogsGlobalLimit(settings *AppSettings, effects settingsSideEffects) {
	if effects.containerLogsGlobalLimit && d.refresh != nil {
		d.refresh.SetContainerLogsGlobalLimit(settings.ObjPanelLogsTargetGlobalLimit)
	}
}

func (d *SettingsEffectDispatcher) dispatchMetricsInterval(settings *AppSettings, effects settingsSideEffects) {
	if effects.metricsInterval && d.refresh != nil {
		d.refresh.SetMetricsRefreshInterval(settings.MetricsRefreshIntervalMs)
	}
}

func allSettingsSideEffects() settingsSideEffects {
	return settingsSideEffects{
		errorReporting:             true,
		kubernetesClientRateLimits: true,
		permissionFetchConcurrency: true,
		containerLogsPerScopeLimit: true,
		containerLogsGlobalLimit:   true,
		metricsInterval:            true,
	}
}

func loadSettingsSideEffects() settingsSideEffects {
	return settingsSideEffects{
		kubernetesClientRateLimits: true,
		permissionFetchConcurrency: true,
		containerLogsPerScopeLimit: true,
		containerLogsGlobalLimit:   true,
		metricsInterval:            true,
	}
}
