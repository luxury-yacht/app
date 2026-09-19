package refresh_test

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/stretchr/testify/require"
)

func TestResourceReadinessString(t *testing.T) {
	tests := []struct {
		state refresh.ResourceReadiness
		want  string
	}{
		{state: refresh.ResourceReadinessUnknown, want: "unknown"},
		{state: refresh.ResourceReadinessPending, want: "pending"},
		{state: refresh.ResourceReadinessReady, want: "ready"},
		{state: refresh.ResourceReadinessDegraded, want: "degraded"},
		{state: refresh.ResourceReadinessUnavailable, want: "unavailable"},
	}
	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			if got := tt.state.String(); got != tt.want {
				t.Fatalf("String() = %q, want %q", got, tt.want)
			}
		})
	}
}

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
	reg := &mockRegistry{operationIDs: make(chan string, 1)}
	svc := &mockSnapshotService{}
	queue := newQueueSpy()

	mgr := refresh.NewManager(reg, nil, svc, nil, queue)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	enqueueContext := applog.ContextWithOperationID(context.Background(), "broker-read-manual")
	job, err := queue.Enqueue(enqueueContext, "nodes", "default", "test")
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
				select {
				case operationID := <-reg.operationIDs:
					if operationID != "broker-read-manual" {
						t.Fatalf("expected manual job operation ID, got %q", operationID)
					}
				default:
					t.Fatal("manual refresh did not receive an operation ID")
				}
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
	}
}

type finishingManualQueue struct {
	*refresh.InMemoryQueue
	finished chan refresh.ManualRefreshJob
}

func (q *finishingManualQueue) Update(job *refresh.ManualRefreshJob) {
	q.InMemoryQueue.Update(job)
	if job.State == refresh.JobStateFailed || job.State == refresh.JobStateSucceeded {
		q.finished <- *job
	}
}

type manualRegistry struct {
	mockRegistry
	result *refresh.ManualRefreshResult
	err    error
}

func (r *manualRegistry) ManualRefresh(context.Context, string, string) (*refresh.ManualRefreshResult, error) {
	return r.result, r.err
}

type manualSnapshotBuilder func(context.Context, string, string) (*refresh.Snapshot, error)

func (f manualSnapshotBuilder) Build(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
	return f(ctx, domain, scope)
}

func TestManualRefreshPublishesVersionAndFailureFromItsExecution(t *testing.T) {
	for _, tt := range []struct {
		name          string
		manualError   bool
		snapshotError bool
		retrySnapshot bool
		noSnapshot    bool
		manualVersion uint64
		wantVersion   uint64
		wantState     refresh.JobState
	}{
		{name: "snapshot version", wantVersion: 42, wantState: refresh.JobStateSucceeded},
		{name: "manual version takes precedence", manualVersion: 9, wantVersion: 9, wantState: refresh.JobStateSucceeded},
		{name: "snapshot retry succeeds", retrySnapshot: true, wantVersion: 42, wantState: refresh.JobStateSucceeded},
		{name: "manual error prevents snapshot", manualError: true, wantVersion: 7, wantState: refresh.JobStateFailed},
		{name: "snapshot error retains prior version", snapshotError: true, wantVersion: 7, wantState: refresh.JobStateFailed},
		{name: "no snapshot retains prior version", noSnapshot: true, wantVersion: 7, wantState: refresh.JobStateSucceeded},
	} {
		t.Run(tt.name, func(t *testing.T) {
			synctest.Test(t, func(t *testing.T) {
				registry := &manualRegistry{result: &refresh.ManualRefreshResult{Job: &refresh.ManualRefreshJob{LatestVersion: tt.manualVersion}}}
				if tt.manualError {
					registry.err = errors.New("manual rejected")
				}
				calls := 0
				bypassed := true
				var operationID, seenScope string
				var service refresh.SnapshotBuilder = manualSnapshotBuilder(func(ctx context.Context, _, scope string) (*refresh.Snapshot, error) {
					calls++
					bypassed = bypassed && refresh.HasCacheBypass(ctx)
					operationID = applog.OperationIDFromContext(ctx)
					seenScope = scope
					if tt.snapshotError || tt.retrySnapshot && calls == 1 {
						return nil, errors.New("snapshot unavailable")
					}
					return &refresh.Snapshot{Version: 42}, nil
				})
				if tt.noSnapshot {
					service = nil
				}
				queue := &finishingManualQueue{refresh.NewInMemoryQueue(), make(chan refresh.ManualRefreshJob, 1)}
				job, err := queue.Enqueue(applog.ContextWithOperationID(context.Background(), "manual-attempt"), "pods", "cluster-a|namespace:prod", "user")
				require.NoError(t, err)
				job.LatestVersion = 7
				queue.Update(job)
				ctx, cancel := context.WithCancel(context.Background())
				defer cancel()
				manager := refresh.NewManager(registry, nil, service, nil, queue)
				require.NoError(t, manager.Start(ctx))
				finished := <-queue.finished
				require.Equal(t, tt.wantState, finished.State)
				require.Equal(t, tt.wantVersion, finished.LatestVersion)
				if tt.wantState == refresh.JobStateFailed {
					require.NotEmpty(t, finished.Error)
				} else {
					require.Empty(t, finished.Error)
				}
				if tt.manualError || tt.noSnapshot {
					require.Zero(t, calls)
				} else {
					require.Positive(t, calls)
					require.True(t, bypassed)
					require.Equal(t, "manual-attempt", operationID)
					require.Equal(t, job.Scope, seenScope)
				}
			})
		})
	}
}

func TestInMemoryQueueReturnsJobCopies(t *testing.T) {
	queue := refresh.NewInMemoryQueue()

	enqueued, err := queue.Enqueue(context.Background(), "nodes", "default", "test")
	if err != nil {
		t.Fatalf("enqueue job: %v", err)
	}
	enqueued.State = refresh.JobStateFailed

	status, ok := queue.Status(enqueued.ID)
	if !ok {
		t.Fatalf("expected queued job status")
	}
	if status.State != refresh.JobStateQueued {
		t.Fatalf("expected stored job to remain queued, got %s", status.State)
	}

	status.State = refresh.JobStateFailed
	statusAgain, ok := queue.Status(enqueued.ID)
	if !ok {
		t.Fatalf("expected queued job status after mutation")
	}
	if statusAgain.State != refresh.JobStateQueued {
		t.Fatalf("expected status mutation not to affect queue, got %s", statusAgain.State)
	}

	next, err := queue.Next(context.Background())
	if err != nil {
		t.Fatalf("next job: %v", err)
	}
	next.State = refresh.JobStateRunning

	statusAfterNext, ok := queue.Status(enqueued.ID)
	if !ok {
		t.Fatalf("expected queued job status after next")
	}
	if statusAfterNext.State != refresh.JobStateQueued {
		t.Fatalf("expected next mutation not to affect queue before Update, got %s", statusAfterNext.State)
	}

	queue.Update(next)
	updated, ok := queue.Status(enqueued.ID)
	if !ok {
		t.Fatalf("expected updated job status")
	}
	if updated.State != refresh.JobStateRunning {
		t.Fatalf("expected update to store running state, got %s", updated.State)
	}
}

type mockRegistry struct {
	operationIDs chan string
}

func (m *mockRegistry) Register(refresh.DomainConfig) error     { return nil }
func (m *mockRegistry) Get(string) (refresh.DomainConfig, bool) { return refresh.DomainConfig{}, false }
func (m *mockRegistry) List() []refresh.DomainConfig            { return nil }
func (m *mockRegistry) ManualRefresh(ctx context.Context, domain, scope string) (*refresh.ManualRefreshResult, error) {
	if m.operationIDs != nil {
		m.operationIDs <- applog.OperationIDFromContext(ctx)
	}
	return &refresh.ManualRefreshResult{}, nil
}

type mockSnapshotService struct{ version atomic.Uint64 }

func (m *mockSnapshotService) Build(ctx context.Context, domain, scope string) (*refresh.Snapshot, error) {
	m.version.Store(42)
	return &refresh.Snapshot{Domain: domain, Scope: scope, Version: m.version.Load()}, nil
}
