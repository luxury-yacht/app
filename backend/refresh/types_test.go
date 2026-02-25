package refresh_test

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh"
)

type queueSpy struct {
	queue *refresh.InMemoryQueue
	mu    sync.RWMutex
	jobs  map[string]refresh.ManualRefreshJob
}

func newQueueSpy() *queueSpy {
	return &queueSpy{
		queue: refresh.NewInMemoryQueue(),
		jobs:  make(map[string]refresh.ManualRefreshJob),
	}
}

func (q *queueSpy) Enqueue(ctx context.Context, domain, scope, reason string) (*refresh.ManualRefreshJob, error) {
	job, err := q.queue.Enqueue(ctx, domain, scope, reason)
	if err != nil || job == nil {
		return job, err
	}
	q.mu.Lock()
	q.jobs[job.ID] = *job
	q.mu.Unlock()
	return job, nil
}

func (q *queueSpy) Status(jobID string) (*refresh.ManualRefreshJob, bool) {
	q.mu.RLock()
	defer q.mu.RUnlock()
	job, ok := q.jobs[jobID]
	if !ok {
		return nil, false
	}
	copy := job
	return &copy, true
}

func (q *queueSpy) Update(job *refresh.ManualRefreshJob) {
	if job != nil {
		q.mu.Lock()
		q.jobs[job.ID] = *job
		q.mu.Unlock()
	}
	q.queue.Update(job)
}

func (q *queueSpy) Next(ctx context.Context) (*refresh.ManualRefreshJob, error) {
	return q.queue.Next(ctx)
}

func TestManagerProcessesManualRefreshJob(t *testing.T) {
	reg := &mockRegistry{}
	svc := &mockSnapshotService{}
	queue := newQueueSpy()

	mgr := refresh.NewManager(reg, nil, svc, nil, queue)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	job, err := queue.Enqueue(context.Background(), "nodes", "default", "test")
	if err != nil {
		t.Fatalf("enqueue job: %v", err)
	}
	jobID := job.ID

	if err := mgr.Start(ctx); err != nil {
		t.Fatalf("start manager: %v", err)
	}

	deadline := time.After(2 * time.Second)
	for {
		select {
		case <-deadline:
			stored, ok := queue.Status(jobID)
			if ok && stored != nil {
				t.Fatalf("job never finished; state=%s error=%s", stored.State, stored.Error)
			}
			t.Fatal("job never finished; job missing from queue")
		default:
			stored, ok := queue.Status(jobID)
			if ok && stored.State == refresh.JobStateSucceeded {
				expectedVersion := svc.version.Load()
				if stored.LatestVersion != expectedVersion {
					t.Fatalf("expected latest version %d, got %d", expectedVersion, stored.LatestVersion)
				}
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
}

type mockRegistry struct{}

func (m *mockRegistry) Register(refresh.DomainConfig) error     { return nil }
func (m *mockRegistry) Get(string) (refresh.DomainConfig, bool) { return refresh.DomainConfig{}, false }
func (m *mockRegistry) List() []refresh.DomainConfig            { return nil }
func (m *mockRegistry) ManualRefresh(ctx context.Context, domain, scope string) (*refresh.ManualRefreshResult, error) {
	return &refresh.ManualRefreshResult{}, nil
}

type mockSnapshotService struct{ version atomic.Uint64 }

func (m *mockSnapshotService) Build(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
	m.version.Store(42)
	return &refresh.Snapshot{Domain: domain, Scope: scope, Version: m.version.Load()}, nil
}
