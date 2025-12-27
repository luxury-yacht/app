package snapshot

import (
	"context"
	"encoding/json"
	"fmt"
	"sync/atomic"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// Service builds snapshots through registered domain builders and applies simple caching via singleflight.
type Service struct {
	registry  *domain.Registry
	telemetry *telemetry.Recorder
	group     singleflight.Group
	sequence  uint64
	cluster   ClusterMeta
}

// NewService returns a Service for the provided registry.
func NewService(reg *domain.Registry, recorder *telemetry.Recorder, meta ClusterMeta) *Service {
	return &Service{registry: reg, telemetry: recorder, cluster: meta}
}

// Build returns a snapshot for the requested domain/scope.
func (s *Service) Build(ctx context.Context, domainName, scope string) (*refresh.Snapshot, error) {
	ctx = WithClusterMeta(ctx, s.cluster)
	value, err, _ := s.group.Do(fmt.Sprintf("%s:%s", domainName, scope), func() (interface{}, error) {
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
		return snap, nil
	})
	if err != nil {
		return nil, err
	}
	return value.(*refresh.Snapshot), nil
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
