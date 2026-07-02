/*
 * backend/objectcatalog/health.go
 *
 * Catalog health tracking and cache rebuild helpers.
 */

package objectcatalog

import (
	"time"

	"github.com/luxury-yacht/app/backend/internal/applog"
)

type healthStatus struct {
	State               HealthState
	ConsecutiveFailures int
	LastSync            time.Time
	LastSuccess         time.Time
	LastError           string
	Stale               bool
	FailedResources     int
	// DeniedResources tracks RBAC-forbidden list targets for the current sync.
	DeniedResources map[string]struct{}
}

// recordDeniedResource notes that listing the resource type was RBAC-forbidden.
// Per-namespace collection workers can report the same type repeatedly; the
// set dedupes.
func (s *Service) recordDeniedResource(resource string) {
	s.healthMu.Lock()
	defer s.healthMu.Unlock()
	if s.health.DeniedResources == nil {
		s.health.DeniedResources = make(map[string]struct{})
	}
	s.health.DeniedResources[resource] = struct{}{}
}

// resetDeniedResources clears the denial set at the start of a sync so a
// permission grant clears the warning on the next pass.
func (s *Service) resetDeniedResources() {
	s.healthMu.Lock()
	defer s.healthMu.Unlock()
	s.health.DeniedResources = nil
}

func (s *Service) updateHealth(success bool, stale bool, err error, failedCount int) {
	s.healthMu.Lock()
	defer s.healthMu.Unlock()

	now := s.now()
	s.health.LastSync = now
	if success {
		s.health.State = HealthStateOK
		s.health.ConsecutiveFailures = 0
		s.health.LastError = ""
		s.health.Stale = false
		s.health.FailedResources = 0
		s.health.LastSuccess = now
		return
	}

	s.health.ConsecutiveFailures++
	s.health.FailedResources = failedCount
	s.health.Stale = true
	if stale || failedCount > 0 {
		s.health.State = HealthStateDegraded
	} else {
		s.health.State = HealthStateError
	}
	if err != nil {
		s.health.LastError = err.Error()
	}
}

func (s *Service) recordTelemetry(itemCount, resourceCount int, duration time.Duration, err error) {
	if s.deps.Telemetry != nil {
		s.deps.Telemetry.RecordCatalog(true, itemCount, resourceCount, duration, err)
	}
}

func (s *Service) pruneMissing(seen map[string]time.Time) {
	if s.opts.EvictionTTL <= 0 {
		return
	}

	expiry := s.now().Add(-s.opts.EvictionTTL)
	for key, last := range seen {
		if last.Before(expiry) {
			delete(seen, key)
		}
	}
}

func (s *Service) logInfo(msg string) {
	applog.Info(s.deps.Logger, msg, componentName)
}

func (s *Service) logWarn(msg string) {
	applog.Warn(s.deps.Logger, msg, componentName)
}

func (s *Service) logDebug(msg string) {
	applog.Debug(s.deps.Logger, msg, componentName)
}

func (s *Service) rebuildCacheFromItems(items map[string]Summary, descriptors []Descriptor) {
	s.cacheRebuilds.Add(1)
	s.mu.Lock()
	s.catalogIndex.rebuildCacheFromItems(items, descriptors)
	s.mu.Unlock()
}
