package backend

import (
	"context"
	"crypto/rand"
	"fmt"
	"regexp"
	"runtime"
	"strings"
	"time"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/internal/sentry"
)

const (
	installationRegisteredMetric   = "app.installation.registered"
	installationMetricFlushTimeout = 2 * time.Second
)

var anonymizedIDPattern = regexp.MustCompile(
	`(?i)^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
)

func generateAnonymizedID() (string, error) {
	var bytes [16]byte
	if _, err := rand.Read(bytes[:]); err != nil {
		return "", fmt.Errorf("generate anonymized installation ID: %w", err)
	}
	bytes[6] = (bytes[6] & 0x0f) | 0x40
	bytes[8] = (bytes[8] & 0x3f) | 0x80
	return fmt.Sprintf(
		"%08x-%04x-%04x-%04x-%012x",
		bytes[0:4],
		bytes[4:6],
		bytes[6:8],
		bytes[8:10],
		bytes[10:16],
	), nil
}

func ensureAnonymizedID(settings *settingsFile) (bool, error) {
	if settings == nil {
		return false, fmt.Errorf("no settings available for anonymized installation ID")
	}
	if anonymizedId := strings.TrimSpace(settings.Telemetry.AnonymizedID); anonymizedIDPattern.MatchString(anonymizedId) {
		settings.Telemetry.AnonymizedID = strings.ToLower(anonymizedId)
		return false, nil
	}

	anonymizedId, err := generateAnonymizedID()
	if err != nil {
		return false, err
	}
	settings.Telemetry.AnonymizedID = anonymizedId
	settings.Telemetry.InstallationMetricReported = false
	return true, nil
}

func (a *App) scheduleInstallationMetricRegistration(ctx context.Context) {
	if a == nil || ctx == nil {
		return
	}
	go a.reportInstallationMetricIfNeeded(ctx)
}

func (a *App) reportInstallationMetricIfNeeded(ctx context.Context) {
	if ctx == nil || ctx.Err() != nil {
		return
	}
	metricReporter, ok := a.errorReporter.(sentryreporting.MetricReporter)
	if !ok || !a.errorReporter.Enabled() {
		return
	}

	a.installationTelemetryMu.Lock()
	defer a.installationTelemetryMu.Unlock()
	if !a.errorReporter.Enabled() {
		return
	}

	a.settingsMu.Lock()
	settings, err := a.loadSettingsFile()
	if err == nil {
		var created bool
		created, err = ensureAnonymizedID(settings)
		if err == nil && created {
			err = a.saveSettingsFile(settings)
		}
	}
	if err != nil {
		a.settingsMu.Unlock()
		a.warnInstallationTelemetry("Could not prepare installation telemetry", err)
		return
	}
	if settings.Telemetry.InstallationMetricReported {
		a.settingsMu.Unlock()
		return
	}
	anonymizedId := settings.Telemetry.AnonymizedID
	a.settingsMu.Unlock()

	metricCtx, cancel := context.WithTimeout(ctx, installationMetricFlushTimeout)
	defer cancel()
	flushed := metricReporter.CaptureCountMetric(
		metricCtx,
		installationRegisteredMetric,
		1,
		map[string]string{
			"app.type": "desktop",
			"os.name":  runtime.GOOS,
			"os.arch":  runtime.GOARCH,
		},
	)
	if !flushed {
		return
	}

	a.settingsMu.Lock()
	settings, err = a.loadSettingsFile()
	if err == nil && settings.Telemetry.AnonymizedID == anonymizedId {
		settings.Telemetry.InstallationMetricReported = true
		err = a.saveSettingsFile(settings)
	}
	a.settingsMu.Unlock()
	if err != nil {
		a.warnInstallationTelemetry("Could not save installation telemetry acknowledgement", err)
	}
}

func (a *App) warnInstallationTelemetry(message string, err error) {
	if a.logger != nil {
		a.logger.Warn(fmt.Sprintf("%s: %v", message, err), logsources.Settings)
	}
}
