/*
 * backend/objectcatalog/health.go
 *
 * Catalog health tracking and cache rebuild helpers.
 */

package objectcatalog

import (
	"sort"
	"time"
)

type healthStatus struct {
	State               HealthState
	ConsecutiveFailures int
	LastSync            time.Time
	LastSuccess         time.Time
	LastError           string
	Stale               bool
	FailedResources     int
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
	if s.deps.Logger != nil {
		s.deps.Logger.Info(msg, componentName)
	}
}

func (s *Service) logWarn(msg string) {
	if s.deps.Logger != nil {
		s.deps.Logger.Warn(msg, componentName)
	}
}

func (s *Service) logDebug(msg string) {
	if s.deps.Logger != nil {
		s.deps.Logger.Debug(msg, componentName)
	}
}

func (s *Service) rebuildCacheFromItems(items map[string]Summary, descriptors []Descriptor) {
	kindSet := make(map[string]struct{})
	namespaceSet := make(map[string]struct{})
	chunks := make([]*summaryChunk, 0, 1)

	if len(items) > 0 {
		summaries := make([]Summary, 0, len(items))
		for _, summary := range items {
			summaries = append(summaries, summary)
			if summary.Kind != "" {
				kindSet[summary.Kind] = struct{}{}
			}
			if summary.Namespace != "" {
				namespaceSet[summary.Namespace] = struct{}{}
			}
		}
		sort.Slice(summaries, func(i, j int) bool {
			if summaries[i].Kind != summaries[j].Kind {
				return summaries[i].Kind < summaries[j].Kind
			}
			if summaries[i].Namespace != summaries[j].Namespace {
				return summaries[i].Namespace < summaries[j].Namespace
			}
			return summaries[i].Name < summaries[j].Name
		})
		chunkCopy := make([]Summary, len(summaries))
		copy(chunkCopy, summaries)
		chunks = append(chunks, &summaryChunk{items: chunkCopy})
	}

	s.publishStreamingState(chunks, kindSet, namespaceSet, descriptors, true)
}
