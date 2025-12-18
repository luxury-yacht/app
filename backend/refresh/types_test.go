package refresh_test

import (
	"context"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh"
)

type queueSpy struct{ queue *refresh.InMemoryQueue }

func newQueueSpy() *queueSpy {
	return &queueSpy{queue: refresh.NewInMemoryQueue()}
}

func (q *queueSpy) Enqueue(ctx context.Context, domain, scope, reason string) (*refresh.ManualRefreshJob, error) {
	return q.queue.Enqueue(ctx, domain, scope, reason)
}

func (q *queueSpy) Status(jobID string) (*refresh.ManualRefreshJob, bool) {
	return q.queue.Status(jobID)
}

func (q *queueSpy) Update(job *refresh.ManualRefreshJob) {
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

	if err := mgr.Start(ctx); err != nil {
		t.Fatalf("start manager: %v", err)
	}

	job, err := queue.Enqueue(context.Background(), "nodes", "default", "test")
	if err != nil {
		t.Fatalf("enqueue job: %v", err)
	}

	deadline := time.After(2 * time.Second)
	for {
		select {
		case <-deadline:
			t.Fatalf("job never finished; state=%s error=%s", job.State, job.Error)
		default:
			stored, ok := queue.Status(job.ID)
			if ok && stored.State == refresh.JobStateSucceeded {
				if stored.LatestVersion != svc.version {
					t.Fatalf("expected latest version %d, got %d", svc.version, stored.LatestVersion)
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

type mockSnapshotService struct{ version uint64 }

func (m *mockSnapshotService) Build(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
	m.version = 42
	return &refresh.Snapshot{Domain: domain, Scope: scope, Version: m.version}, nil
}
