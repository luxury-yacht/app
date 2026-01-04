package snapshot

import (
	"context"
	"encoding/json"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// Service builds snapshots through registered domain builders and applies short-lived caching via singleflight.
type Service struct {
	registry          *domain.Registry
	telemetry         *telemetry.Recorder
	group             singleflight.Group
	sequence          uint64
	cluster           ClusterMeta
	cacheMu           sync.RWMutex
	cache             map[string]cacheEntry
	cacheTTL          time.Duration
	permissionChecker *permissions.Checker
	permissionChecks  map[string]permissionCheck
}

type cacheEntry struct {
	snapshot  *refresh.Snapshot
	expiresAt time.Time
}

// NewService returns a Service for the provided registry.
func NewService(reg *domain.Registry, recorder *telemetry.Recorder, meta ClusterMeta) *Service {
	return newService(reg, recorder, meta, nil, nil)
}

// NewServiceWithPermissions returns a Service that validates runtime permissions per snapshot request.
func NewServiceWithPermissions(
	reg *domain.Registry,
	recorder *telemetry.Recorder,
	meta ClusterMeta,
	checker *permissions.Checker,
) *Service {
	return newService(reg, recorder, meta, checker, nil)
}

func newService(
	reg *domain.Registry,
	recorder *telemetry.Recorder,
	meta ClusterMeta,
	checker *permissions.Checker,
	checks map[string]permissionCheck,
) *Service {
	if checker == nil {
		checks = nil
	}
	if checker != nil && checks == nil {
		checks = defaultPermissionChecks()
	}
	return &Service{
		registry:          reg,
		telemetry:         recorder,
		cluster:           meta,
		cache:             make(map[string]cacheEntry),
		cacheTTL:          config.SnapshotCacheTTL,
		permissionChecker: checker,
		permissionChecks:  checks,
	}
}

// Build returns a snapshot for the requested domain/scope.
func (s *Service) Build(ctx context.Context, domainName, scope string) (*refresh.Snapshot, error) {
	ctx = WithClusterMeta(ctx, s.cluster)
	if err := s.ensurePermissions(ctx, domainName, scope); err != nil {
		return nil, err
	}
	cacheKey := s.cacheKey(domainName, scope)
	if !refresh.HasCacheBypass(ctx) {
		if cached := s.loadCache(cacheKey); cached != nil {
			return cached, nil
		}
	}
	value, err, _ := s.group.Do(cacheKey, func() (interface{}, error) {
		if !refresh.HasCacheBypass(ctx) {
			if cached := s.loadCache(cacheKey); cached != nil {
				return cached, nil
			}
		}
		start := time.Now()
		snap, buildErr := s.registry.Build(ctx, domainName, scope)
		duration := time.Since(start)
		if buildErr != nil {
			s.recordTelemetry(
				domainName,
				scope,
				duration,
				buildErr,
				false,
				0,
				nil,
				0,
				0,
				0,
				true,
				duration.Milliseconds(),
			)
			return nil, buildErr
		}
		snap.GeneratedAt = time.Now().UnixMilli()
		snap.Sequence = atomic.AddUint64(&s.sequence, 1)
		snap.Stats.BuildDurationMs = duration.Milliseconds()
		snap.Stats.BuildStartedAtUnix = start.UnixMilli()
		if snap.Stats.BatchIndex == 0 && snap.Stats.TimeToFirstRowMs == 0 {
			snap.Stats.TimeToFirstRowMs = duration.Milliseconds()
		}
		if snap.Payload != nil {
			if data, marshalErr := json.Marshal(snap.Payload); marshalErr == nil {
				snap.Checksum = checksumBytes(data)
			}
		}
		s.recordTelemetry(
			domainName,
			scope,
			duration,
			nil,
			snap.Stats.Truncated,
			snap.Stats.TotalItems,
			snap.Stats.Warnings,
			snap.Stats.BatchIndex,
			snap.Stats.TotalBatches,
			snap.Stats.BatchSize,
			snap.Stats.IsFinalBatch,
			snap.Stats.TimeToFirstRowMs,
		)
		s.storeCache(cacheKey, snap)
		return snap, nil
	})
	if err != nil {
		return nil, err
	}
	return value.(*refresh.Snapshot), nil
}

// ensurePermissions blocks snapshot builds when the current identity no longer has list access.
func (s *Service) ensurePermissions(ctx context.Context, domainName, scope string) error {
	if s == nil || s.permissionChecker == nil || len(s.permissionChecks) == 0 {
		return nil
	}
	check, ok := s.permissionChecks[domainName]
	if !ok {
		return nil
	}
	start := time.Now()
	allowed, err := check.allows(ctx, s.permissionChecker)
	if err != nil {
		duration := time.Since(start)
		s.recordTelemetry(
			domainName,
			scope,
			duration,
			err,
			false,
			0,
			nil,
			0,
			0,
			0,
			true,
			duration.Milliseconds(),
		)
		return err
	}
	if allowed {
		return nil
	}
	denied := refresh.NewPermissionDeniedError(domainName, check.resource)
	duration := time.Since(start)
	s.recordTelemetry(
		domainName,
		scope,
		duration,
		denied,
		false,
		0,
		nil,
		0,
		0,
		0,
		true,
		duration.Milliseconds(),
	)
	return denied
}

func (s *Service) recordTelemetry(
	domain string,
	scope string,
	duration time.Duration,
	err error,
	truncated bool,
	totalItems int,
	warnings []string,
	batchIndex int,
	totalBatches int,
	batchSize int,
	isFinal bool,
	timeToFirstRowMs int64,
) {
	if s.telemetry == nil {
		return
	}
	s.telemetry.RecordSnapshot(
		domain,
		scope,
		duration,
		err,
		truncated,
		totalItems,
		warnings,
		batchIndex,
		totalBatches,
		batchSize,
		isFinal,
		timeToFirstRowMs,
	)
}

func (s *Service) cacheKey(domainName, scope string) string {
	return fmt.Sprintf("%s:%s", domainName, scope)
}

func (s *Service) loadCache(key string) *refresh.Snapshot {
	if s.cacheTTL <= 0 {
		return nil
	}
	s.cacheMu.RLock()
	entry, ok := s.cache[key]
	s.cacheMu.RUnlock()
	if !ok {
		return nil
	}
	if time.Now().After(entry.expiresAt) {
		s.cacheMu.Lock()
		delete(s.cache, key)
		s.cacheMu.Unlock()
		return nil
	}
	return entry.snapshot
}

func (s *Service) storeCache(key string, snap *refresh.Snapshot) {
	if s.cacheTTL <= 0 || snap == nil {
		return
	}
	if !s.shouldCacheSnapshot(snap) {
		return
	}
	s.cacheMu.Lock()
	s.cache[key] = cacheEntry{
		snapshot:  snap,
		expiresAt: time.Now().Add(s.cacheTTL),
	}
	s.cacheMu.Unlock()
}

func (s *Service) shouldCacheSnapshot(snap *refresh.Snapshot) bool {
	if snap == nil {
		return false
	}
	// Avoid caching partial snapshots so follow-up requests can rehydrate cleanly.
	if snap.Stats.Truncated {
		return false
	}
	if snap.Stats.TotalBatches > 0 && !snap.Stats.IsFinalBatch {
		return false
	}
	return true
}

func checksumBytes(data []byte) string {
	sum := fnv1a32(data)
	return fmt.Sprintf("%08x", sum)
}

func fnv1a32(data []byte) uint32 {
	const offset32 = 2166136261
	const prime32 = 16777619
	hash := uint32(offset32)
	for _, b := range data {
		hash ^= uint32(b)
		hash *= prime32
	}
	return hash
}
