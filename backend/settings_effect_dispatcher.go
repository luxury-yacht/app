package backend

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/logsources"
)

type ErrorReportingSettingSink interface {
	SetErrorReportingEnabled(bool) error
}

type ClusterRateLimitSettingSink interface {
	SetKubernetesClientRateLimits(qps, burst int)
}

type PermissionFetchSettingSink interface {
	SetPermissionFetchConcurrency(int)
}

type ContainerLogsSelectionSettingSink interface {
	SetContainerLogsPerScopeLimit(int)
}

type RefreshSettingSink interface {
	SetContainerLogsGlobalLimit(int)
	SetMetricsRefreshInterval(int)
}

// SettingsEffectDispatcher is the complete write-only bridge from persisted
// preference commits to runtime owners.
type SettingsEffectDispatcher struct {
	errorReporting ErrorReportingSettingSink
	cluster        ClusterRateLimitSettingSink
	permission     PermissionFetchSettingSink
	containerLogs  ContainerLogsSelectionSettingSink
	refresh        RefreshSettingSink
	logger         *Logger
}

func NewSettingsEffectDispatcher(
	errorReporting ErrorReportingSettingSink,
	cluster ClusterRateLimitSettingSink,
	permission PermissionFetchSettingSink,
	containerLogs ContainerLogsSelectionSettingSink,
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
	if effects.errorReporting && d.errorReporting != nil {
		if err := d.errorReporting.SetErrorReportingEnabled(settings.ErrorReportingEnabled); err != nil && d.logger != nil {
			d.logger.Warn(fmt.Sprintf("Could not update error reporting: %v", err), logsources.Settings)
		}
	}
	if effects.kubernetesClientRateLimits && d.cluster != nil {
		d.cluster.SetKubernetesClientRateLimits(settings.KubernetesClientQPS, settings.KubernetesClientBurst)
	}
	if effects.permissionFetchConcurrency && d.permission != nil {
		d.permission.SetPermissionFetchConcurrency(settings.PermissionSSRRFetchConcurrency)
	}
	if effects.containerLogsPerScopeLimit && d.containerLogs != nil {
		d.containerLogs.SetContainerLogsPerScopeLimit(settings.ObjPanelLogsTargetPerScopeLimit)
	}
	if effects.containerLogsGlobalLimit && d.refresh != nil {
		d.refresh.SetContainerLogsGlobalLimit(settings.ObjPanelLogsTargetGlobalLimit)
	}
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
