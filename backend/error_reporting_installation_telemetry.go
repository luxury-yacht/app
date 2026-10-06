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
	"github.com/luxury-yacht/app/internal/updateidentity"
)

const (
	installationRegisteredMetric   = "app.installation.registered"
	installationUpgradedMetric     = "app.installation.upgraded"
	installationUpgradeFromUnknown = "unknown"
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
	settings.Telemetry.ReportedVersion = ""
	return true, nil
}

// installationMetric is one count metric to send and the release version to
// record once Sentry confirms delivery.
type installationMetric struct {
	name       string
	attributes map[string]string
	version    string
}

// installationMetricFor decides which metric, if any, this launch sends. New
// installations register once; registered installations report an upgrade when
// the running release is newer than the last reported one. Development and
// other non-release builds never report upgrades.
func installationMetricFor(state installationTelemetryState, currentVersion string) (installationMetric, bool) {
	current, err := updateidentity.ParseReleaseVersion(currentVersion)
	isRelease := err == nil
	if !state.registered {
		metric := installationMetric{name: installationRegisteredMetric, attributes: installationMetricAttributes()}
		if isRelease {
			metric.version = current.Version
		}
		return metric, true
	}
	if !isRelease {
		return installationMetric{}, false
	}
	fromVersion, upgraded := upgradedFromVersion(state.reportedVersion, current)
	if !upgraded {
		return installationMetric{}, false
	}
	attributes := installationMetricAttributes()
	attributes["from.version"] = fromVersion
	return installationMetric{name: installationUpgradedMetric, attributes: attributes, version: current.Version}, true
}

// upgradedFromVersion returns the version a registered installation upgraded
// from. A missing or unreadable reported version means the installation
// registered before upgrade tracking existed, so it upgraded from an unknown
// version. The reported version only moves forward, so a downgrade or relaunch
// is not an upgrade.
func upgradedFromVersion(reportedVersion string, current updateidentity.ReleaseVersion) (string, bool) {
	previous, err := updateidentity.ParseReleaseVersion(reportedVersion)
	if err != nil {
		return installationUpgradeFromUnknown, true
	}
	return previous.Version, previous.Compare(current) < 0
}

func installationMetricAttributes() map[string]string {
	return map[string]string{
		"app.type": "desktop",
		"os.name":  runtime.GOOS,
		"os.arch":  runtime.GOARCH,
	}
}

func (s *ErrorReportingService) scheduleInstallationMetricRegistration(ctx context.Context) {
	if s == nil || ctx == nil || s.suppressTelemetrySchedule.Load() {
		return
	}
	generation := s.telemetryResetGeneration.Load()
	go s.reportInstallationMetricForGeneration(ctx, generation)
}

func (s *ErrorReportingService) reportInstallationMetricIfNeeded(ctx context.Context) {
	if s == nil {
		return
	}
	s.reportInstallationMetricForGeneration(ctx, s.telemetryResetGeneration.Load())
}

func (s *ErrorReportingService) reportInstallationMetricForGeneration(ctx context.Context, generation uint64) {
	metricReporter, ok := s.installationMetricReporter(ctx)
	if !ok {
		return
	}

	s.installationTelemetryMu.Lock()
	defer s.installationTelemetryMu.Unlock()
	if s.suppressTelemetrySchedule.Load() || s.telemetryResetGeneration.Load() != generation || !s.reporter.Enabled() {
		return
	}

	state, err := s.telemetryRepository.prepareInstallationTelemetry()
	if err != nil {
		s.warnInstallationTelemetry("Could not prepare installation telemetry", err)
		return
	}
	metric, ok := installationMetricFor(state, s.currentVersion)
	if !ok {
		return
	}

	metricCtx, cancel := context.WithTimeout(ctx, installationMetricFlushTimeout)
	defer cancel()
	if !metricReporter.CaptureCountMetric(metricCtx, metric.name, 1, metric.attributes) {
		return
	}

	err = s.telemetryRepository.acknowledgeInstallationTelemetry(state.anonymizedID, metric.version)
	if err != nil {
		s.warnInstallationTelemetry("Could not save installation telemetry acknowledgement", err)
	}
}

// installationMetricReporter returns the metric reporter when installation
// telemetry may run: the context is live and reporting is enabled.
func (s *ErrorReportingService) installationMetricReporter(ctx context.Context) (sentryreporting.MetricReporter, bool) {
	if ctx == nil || ctx.Err() != nil {
		return nil, false
	}
	if s == nil || s.reporter == nil || s.telemetryRepository == nil {
		return nil, false
	}
	metricReporter, ok := s.reporter.(sentryreporting.MetricReporter)
	return metricReporter, ok && s.reporter.Enabled()
}

func (s *ErrorReportingService) warnInstallationTelemetry(message string, err error) {
	if s.logger != nil {
		s.logger.Warn(fmt.Sprintf("%s: %v", message, err), logsources.Settings)
	}
}
