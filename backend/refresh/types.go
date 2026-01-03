package refresh

import (
	"context"
	"errors"
	"fmt"
	"log"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
)

// Manager coordinates the refresh subsystem once initialized.
type Manager struct {
	registry        Registry
	informerHub     InformerHub
	snapshotService SnapshotService
	metricsPoller   MetricsPoller
	manualQueue     ManualQueue
	mu              sync.RWMutex
	started         bool
	// runCancel stops informers/metrics/manual queue without requiring callers to hold the parent cancel.
	runCancel context.CancelFunc
}

// Registry abstracts domain registration for snapshots.
type Registry interface {
	Register(config DomainConfig) error
	Get(name string) (DomainConfig, bool)
	List() []DomainConfig
	ManualRefresh(ctx context.Context, domain, scope string) (*ManualRefreshResult, error)
}

// DomainConfig describes how to build and manually refresh a snapshot domain.
type DomainConfig struct {
	Name          string
	BuildSnapshot func(ctx context.Context, scope string) (*Snapshot, error)
	ManualRefresh func(ctx context.Context, scope string) (*ManualRefreshResult, error)
}

// InformerHub exposes informer lifecycle hooks used by the refresh manager.
type InformerHub interface {
	Start(ctx context.Context) error
	HasSynced(ctx context.Context) bool
	Shutdown() error
}

// SnapshotService builds and caches snapshots per domain.
type SnapshotService interface {
	Build(ctx context.Context, domain, scope string) (*Snapshot, error)
}

// MetricsPoller represents the periodic metrics polling component.
type MetricsPoller interface {
	Start(ctx context.Context) error
	Stop(ctx context.Context) error
}

// ManualQueue manages manual refresh jobs.
type ManualQueue interface {
	Enqueue(ctx context.Context, domain, scope, reason string) (*ManualRefreshJob, error)
	Status(jobID string) (*ManualRefreshJob, bool)
	Update(job *ManualRefreshJob)
	Next(ctx context.Context) (*ManualRefreshJob, error)
}

// ManualRefreshJob captures state for a manual refresh request.
type ManualRefreshJob struct {
	ID            string   `json:"jobId"`
	Domain        string   `json:"domain"`
	Scope         string   `json:"scope,omitempty"`
	Reason        string   `json:"reason,omitempty"`
	State         JobState `json:"state"`
	QueuedAt      int64    `json:"queuedAt"`
	StartedAt     int64    `json:"startedAt,omitempty"`
	FinishedAt    int64    `json:"finishedAt,omitempty"`
	Error         string   `json:"error,omitempty"`
	LatestVersion uint64   `json:"latestVersion,omitempty"`
}

// ManualRefreshResult summarises a manual refresh execution.
type ManualRefreshResult struct {
	Job   *ManualRefreshJob
	Error error
}

// JobState enumerates manual refresh job lifecycle states.
type JobState string

const (
	JobStateQueued    JobState = "queued"
	JobStateRunning   JobState = "running"
	JobStateSucceeded JobState = "succeeded"
	JobStateFailed    JobState = "failed"
	JobStateCancelled JobState = "cancelled"
)

// Snapshot represents the payload returned to clients.
type Snapshot struct {
	Domain      string        `json:"domain"`
	Scope       string        `json:"scope,omitempty"`
	Version     uint64        `json:"version"`
	Checksum    string        `json:"checksum"`
	GeneratedAt int64         `json:"generatedAt"` // unix millis
	Sequence    uint64        `json:"sequence"`
	Payload     interface{}   `json:"payload"`
	Stats       SnapshotStats `json:"stats"`
}

// SnapshotStats captures simple metrics for a snapshot build.
type SnapshotStats struct {
	ItemCount          int      `json:"itemCount"`
	BuildDurationMs    int64    `json:"buildDurationMs"`
	TotalItems         int      `json:"totalItems,omitempty"`
	Truncated          bool     `json:"truncated,omitempty"`
	Warnings           []string `json:"warnings,omitempty"`
	BatchIndex         int      `json:"batchIndex,omitempty"`
	BatchSize          int      `json:"batchSize,omitempty"`
	TotalBatches       int      `json:"totalBatches,omitempty"`
	IsFinalBatch       bool     `json:"isFinalBatch,omitempty"`
	TimeToFirstRowMs   int64    `json:"timeToFirstRowMs,omitempty"`
	BuildStartedAtUnix int64    `json:"buildStartedAtUnix,omitempty"`
}

// NewManager constructs a Manager with the supplied collaborators.
func NewManager(reg Registry, hub InformerHub, svc SnapshotService, poller MetricsPoller, queue ManualQueue) *Manager {
	return &Manager{
		registry:        reg,
		informerHub:     hub,
		snapshotService: svc,
		metricsPoller:   poller,
		manualQueue:     queue,
	}
}

// Start boots the informer hub and metrics poller exactly once.
func (m *Manager) Start(ctx context.Context) error {
	m.mu.Lock()
	if m.started {
		m.mu.Unlock()
		return nil
	}
	if ctx == nil {
		ctx = context.Background()
	}
	runCtx, cancel := context.WithCancel(ctx)
	m.started = true
	m.runCancel = cancel
	m.mu.Unlock()

	if m.informerHub != nil {
		if err := m.informerHub.Start(runCtx); err != nil {
			return err
		}
	}

	if m.metricsPoller != nil {
		go func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[refresh] panic in metrics poller: %v", r)
				}
			}()
			if err := m.metricsPoller.Start(runCtx); err != nil && !errors.Is(err, context.Canceled) {
				log.Printf("[refresh] metrics poller stopped with error: %v", err)
			}
		}()
	}

	if m.manualQueue != nil {
		go func() {
			defer func() {
				if r := recover(); r != nil {
					log.Printf("[refresh] panic in manual queue: %v", r)
				}
			}()
			m.runManualQueue(runCtx)
		}()
	}

	return nil
}

// Shutdown terminates running background services.
func (m *Manager) Shutdown(ctx context.Context) error {
	m.mu.Lock()
	if !m.started {
		m.mu.Unlock()
		return nil
	}
	m.started = false
	cancel := m.runCancel
	m.runCancel = nil
	m.mu.Unlock()

	// Cancelling the run context stops informer factories and pollers that rely on it.
	if cancel != nil {
		cancel()
	}

	var firstErr error
	if m.metricsPoller != nil {
		if err := m.metricsPoller.Stop(ctx); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	if m.informerHub != nil {
		if err := m.informerHub.Shutdown(); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	return firstErr
}

func (m *Manager) runManualQueue(ctx context.Context) {
	for {
		job, err := m.manualQueue.Next(ctx)
		if err != nil {
			if errors.Is(err, context.Canceled) {
				return
			}
			continue
		}
		if job == nil {
			continue
		}
		m.processManualJob(ctx, job)
	}
}

func (m *Manager) processManualJob(parent context.Context, job *ManualRefreshJob) {
	if job == nil {
		return
	}

	job.State = JobStateRunning
	job.StartedAt = time.Now().UnixMilli()
	job.Error = ""
	m.manualQueue.Update(job)

	ctx, cancel := context.WithTimeout(parent, config.RefreshRequestTimeout)
	defer cancel()

	result, manualErr := retryManualOperation(ctx, config.ManualJobMaxAttempts, config.ManualJobRetryDelay, func(callCtx context.Context) (*ManualRefreshResult, error) {
		return m.registry.ManualRefresh(callCtx, job.Domain, job.Scope)
	})
	if manualErr != nil {
		job.State = JobStateFailed
		job.Error = manualErr.Error()
	} else if m.snapshotService != nil {
		snapshot, snapErr := retryManualOperation(ctx, config.ManualJobMaxAttempts, config.ManualJobRetryDelay, func(callCtx context.Context) (*Snapshot, error) {
			// Manual refreshes should bypass snapshot caching so UI receives fresh data.
			return m.snapshotService.Build(WithCacheBypass(callCtx), job.Domain, job.Scope)
		})
		if snapErr != nil {
			job.State = JobStateFailed
			job.Error = snapErr.Error()
		} else {
			job.State = JobStateSucceeded
			job.LatestVersion = snapshot.Version
			if result != nil && result.Job != nil && result.Job.LatestVersion > 0 {
				job.LatestVersion = result.Job.LatestVersion
			}
		}
	} else {
		job.State = JobStateSucceeded
	}

	if errors.Is(ctx.Err(), context.DeadlineExceeded) && job.State != JobStateSucceeded {
		job.State = JobStateFailed
		if job.Error == "" {
			job.Error = ctx.Err().Error()
		}
	}

	job.FinishedAt = time.Now().UnixMilli()
	m.manualQueue.Update(job)
}

func retryManualOperation[T any](ctx context.Context, attempts int, baseDelay time.Duration, fn func(context.Context) (T, error)) (T, error) {
	var zero T
	if fn == nil {
		return zero, errors.New("manual operation not provided")
	}
	if attempts < 1 {
		attempts = 1
	}
	delay := baseDelay
	if delay <= 0 {
		delay = time.Second
	}
	for i := 0; i < attempts; i++ {
		if ctx.Err() != nil {
			return zero, ctx.Err()
		}
		result, err := fn(ctx)
		if err == nil {
			return result, nil
		}
		if i == attempts-1 {
			return zero, err
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return zero, ctx.Err()
		case <-timer.C:
		}
		timer.Stop()
		delay *= 2
		if delay > config.RefreshRequestTimeout {
			delay = config.RefreshRequestTimeout
		}
	}
	return zero, fmt.Errorf("manual operation retries exhausted")
}
