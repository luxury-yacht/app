package backend

import (
	"context"
	"sync"
	"sync/atomic"

	sentryreporting "github.com/luxury-yacht/app/internal/sentry"
)

// ErrorReportingService owns reporter enablement and installation telemetry
// serialization. It receives preference values but never reads preferences.
type ErrorReportingService struct {
	reporter                  sentryreporting.Reporter
	installationTelemetryMu   sync.Mutex
	telemetryResetGeneration  atomic.Uint64
	suppressTelemetrySchedule atomic.Bool
	context                   func() context.Context
	telemetryRepository       installationTelemetryRepository
	logger                    *Logger
}

type installationTelemetryRepository interface {
	prepareInstallationTelemetry() (string, bool, error)
	acknowledgeInstallationTelemetry(string) error
}

func NewErrorReportingService(
	reporter sentryreporting.Reporter,
	contextProvider func() context.Context,
	logger *Logger,
) *ErrorReportingService {
	return &ErrorReportingService{
		reporter: reporter,
		context:  contextProvider,
		logger:   logger,
	}
}

func (s *ErrorReportingService) ConfigureInstallationTelemetry(repository installationTelemetryRepository) {
	if s != nil {
		s.telemetryRepository = repository
	}
}

func (s *ErrorReportingService) SetErrorReportingEnabled(enabled bool) error {
	if s == nil || s.reporter == nil {
		return nil
	}
	if err := s.reporter.SetEnabled(enabled); err != nil {
		return err
	}
	if enabled {
		ctx := context.Background()
		if s.context != nil {
			ctx = s.context()
		}
		s.scheduleInstallationMetricRegistration(ctx)
	}
	return nil
}

func (s *ErrorReportingService) WithInstallationTelemetryQuiesced(action func() error) error {
	if s == nil {
		if action == nil {
			return nil
		}
		return action()
	}
	s.installationTelemetryMu.Lock()
	s.suppressTelemetrySchedule.Store(true)
	s.telemetryResetGeneration.Add(1)
	defer func() {
		s.suppressTelemetrySchedule.Store(false)
		s.installationTelemetryMu.Unlock()
	}()
	if action == nil {
		return nil
	}
	return action()
}
