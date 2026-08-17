package backend

import (
	"context"
	"fmt"
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

type installationTelemetryPort struct {
	mu     sync.RWMutex
	target installationTelemetryRepository
}

func (p *installationTelemetryPort) prepareInstallationTelemetry() (string, bool, error) {
	p.mu.RLock()
	target := p.target
	p.mu.RUnlock()
	if target == nil {
		return "", false, fmt.Errorf("installation telemetry repository is not available")
	}
	return target.prepareInstallationTelemetry()
}

func (p *installationTelemetryPort) acknowledgeInstallationTelemetry(id string) error {
	p.mu.RLock()
	target := p.target
	p.mu.RUnlock()
	if target == nil {
		return fmt.Errorf("installation telemetry repository is not available")
	}
	return target.acknowledgeInstallationTelemetry(id)
}

func (p *installationTelemetryPort) bind(target installationTelemetryRepository) {
	if p == nil || target == nil {
		panic("installation telemetry port requires a target")
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.target != nil {
		panic("installation telemetry port already bound")
	}
	p.target = target
}

func (p *installationTelemetryPort) publishPreferences(preferences *PreferencesService) {
	p.bind(preferences)
}

func NewErrorReportingService(
	reporter sentryreporting.Reporter,
	contextProvider func() context.Context,
	logger *Logger,
	repositories ...installationTelemetryRepository,
) *ErrorReportingService {
	service := &ErrorReportingService{
		reporter: reporter,
		context:  contextProvider,
		logger:   logger,
	}
	if len(repositories) > 0 {
		service.telemetryRepository = repositories[0]
	}
	return service
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
