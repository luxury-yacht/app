package backend

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/stretchr/testify/require"
)

type stubManualQueue struct {
	mu     sync.Mutex
	jobs   map[string]*refresh.ManualRefreshJob
	scopes []string
	nextID int
	domain string
	reason string
}

func newStubManualQueue() *stubManualQueue {
	return &stubManualQueue{jobs: make(map[string]*refresh.ManualRefreshJob)}
}

func (q *stubManualQueue) Enqueue(ctx context.Context, domain, scope, reason string) (*refresh.ManualRefreshJob, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.nextID++
	jobID := fmt.Sprintf("job-%d", q.nextID)
	job := &refresh.ManualRefreshJob{
		ID:       jobID,
		Domain:   domain,
		Scope:    scope,
		Reason:   reason,
		State:    refresh.JobStateQueued,
		QueuedAt: 1,
	}
	q.jobs[jobID] = job
	q.scopes = append(q.scopes, scope)
	q.domain = domain
	q.reason = reason
	return job, nil
}

func (q *stubManualQueue) Status(jobID string) (*refresh.ManualRefreshJob, bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	job, ok := q.jobs[jobID]
	return job, ok
}

func (q *stubManualQueue) Update(job *refresh.ManualRefreshJob) {
	if job == nil {
		return
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	q.jobs[job.ID] = job
}

func (q *stubManualQueue) Next(ctx context.Context) (*refresh.ManualRefreshJob, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

func TestAggregateManualQueueEnqueueRoutesSingleCluster(t *testing.T) {
	queueA := newStubManualQueue()
	queueB := newStubManualQueue()
	subsystems := map[string]*system.Subsystem{
		"cluster-a": {ManualQueue: queueA},
		"cluster-b": {ManualQueue: queueB},
	}
	aggregate := newAggregateManualQueue(subsystems)

	job, err := aggregate.Enqueue(context.Background(), "namespaces", "cluster-a|namespace:default", "manual")
	require.NoError(t, err)
	require.NotNil(t, job)
	require.Len(t, queueA.scopes, 1)
	require.Empty(t, queueB.scopes)
	require.Equal(t, "cluster-a|namespace:default", queueA.scopes[0])
}

func TestAggregateManualQueueRejectsMultiClusterScope(t *testing.T) {
	queueA := newStubManualQueue()
	queueB := newStubManualQueue()
	subsystems := map[string]*system.Subsystem{
		"cluster-a": {ManualQueue: queueA},
		"cluster-b": {ManualQueue: queueB},
	}
	aggregate := newAggregateManualQueue(subsystems)

	job, err := aggregate.Enqueue(context.Background(), "namespaces", "clusters=cluster-a,cluster-b|", "")
	require.Error(t, err)
	require.Contains(t, err.Error(), "single cluster scope")
	require.Nil(t, job)
	require.Empty(t, queueA.scopes)
	require.Empty(t, queueB.scopes)
}

func TestAggregateManualQueueStatusReflectsChildFailure(t *testing.T) {
	queueA := newStubManualQueue()
	subsystems := map[string]*system.Subsystem{
		"cluster-a": {ManualQueue: queueA},
	}
	aggregate := newAggregateManualQueue(subsystems)

	job, err := aggregate.Enqueue(context.Background(), "namespaces", "cluster-a|", "")
	require.NoError(t, err)
	require.NotNil(t, job)

	require.Len(t, queueA.jobs, 1)
	for _, child := range queueA.jobs {
		child.State = refresh.JobStateFailed
		child.Error = "boom"
		queueA.Update(child)
	}

	aggStatus, ok := aggregate.Status(job.ID)
	require.True(t, ok)
	require.Equal(t, refresh.JobStateFailed, aggStatus.State)
	require.Contains(t, aggStatus.Error, "cluster-a")
}

func TestAggregateManualQueueStatusKeepsChildProgressAndAggregateIdentity(t *testing.T) {
	for _, state := range []refresh.JobState{
		refresh.JobStateQueued, refresh.JobStateRunning, refresh.JobStateSucceeded,
		refresh.JobStateFailed, refresh.JobStateCancelled,
	} {
		t.Run(string(state), func(t *testing.T) {
			queue := newStubManualQueue()
			aggregate := newAggregateManualQueue(map[string]*system.Subsystem{
				"cluster-a": {ManualQueue: queue},
			})
			job, err := aggregate.Enqueue(context.Background(), "pods", "cluster-a|namespace:prod", "user")
			require.NoError(t, err)
			child, _ := queue.Status("job-1")
			child.State = state
			child.LatestVersion = 42
			child.StartedAt = 10
			child.FinishedAt = 20
			status, ok := aggregate.Status(job.ID)
			require.True(t, ok)
			require.Equal(t, job.ID, status.ID)
			require.Equal(t, job.Scope, status.Scope)
			require.Equal(t, state, status.State)
			require.Equal(t, uint64(42), status.LatestVersion)
			require.Equal(t, int64(10), status.StartedAt)
			require.Equal(t, int64(20), status.FinishedAt)
			delete(queue.jobs, child.ID)
			missing, ok := aggregate.Status(job.ID)
			require.True(t, ok)
			require.Equal(t, refresh.JobStateFailed, missing.State)
			require.Equal(t, "cluster cluster-a job missing", missing.Error)
			require.Zero(t, missing.LatestVersion)
			require.Zero(t, missing.StartedAt)
			require.Zero(t, missing.FinishedAt)
		})
	}
}

type blockedManualQueue struct {
	*stubManualQueue
	entered chan struct{}
	release chan struct{}
}

func (q *blockedManualQueue) Enqueue(ctx context.Context, domain, scope, reason string) (*refresh.ManualRefreshJob, error) {
	close(q.entered)
	<-q.release
	return q.stubManualQueue.Enqueue(ctx, domain, scope, reason)
}

func TestAggregateManualQueueLateMigrationKeepsNewestQueue(t *testing.T) {
	old := newStubManualQueue()
	aggregate := newAggregateManualQueue(map[string]*system.Subsystem{
		"cluster-a": {ManualQueue: old},
	})
	job, err := aggregate.Enqueue(context.Background(), "pods", "cluster-a|namespace:prod", "user")
	require.NoError(t, err)
	slow := &blockedManualQueue{newStubManualQueue(), make(chan struct{}), make(chan struct{})}
	done := make(chan struct{})
	go func() {
		aggregate.UpdateConfig(map[string]*system.Subsystem{"cluster-a": {ManualQueue: slow}})
		close(done)
	}()
	release := sync.OnceFunc(func() { close(slow.release) })
	defer release()
	select {
	case <-slow.entered:
	case <-time.After(2 * time.Second):
		t.Fatal("replacement queue did not receive migration")
	}
	latest := newStubManualQueue()
	aggregate.UpdateConfig(map[string]*system.Subsystem{"cluster-a": {ManualQueue: latest}})
	release()
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("older migration did not settle after release")
	}
	child, ok := latest.Status("job-1")
	require.True(t, ok)
	child.State = refresh.JobStateSucceeded
	status, ok := aggregate.Status(job.ID)
	require.True(t, ok)
	require.Equal(t, refresh.JobStateSucceeded, status.State,
		"a late enqueue from an older replacement must not steal the job from the current queue")
	require.Equal(t, []string{"cluster-a|namespace:prod"}, latest.scopes)
}

func TestAggregateManualQueueStatusSurvivesQueueReplacement(t *testing.T) {
	oldQueue := newStubManualQueue()
	aggregate := newAggregateManualQueue(map[string]*system.Subsystem{
		"restricted-cluster-admin": {ManualQueue: oldQueue},
	})

	job, err := aggregate.Enqueue(context.Background(), "namespaces", "restricted-cluster-admin|", "user")
	require.NoError(t, err)
	for _, child := range oldQueue.jobs {
		child.State = refresh.JobStateSucceeded
		oldQueue.Update(child)
	}

	newQueue := newStubManualQueue()
	aggregate.UpdateConfig(map[string]*system.Subsystem{
		"restricted-cluster-admin": {ManualQueue: newQueue},
	})

	status, ok := aggregate.Status(job.ID)
	require.True(t, ok)
	require.Equal(t, refresh.JobStateSucceeded, status.State)
	require.Empty(t, status.Error)

	_, err = aggregate.Enqueue(context.Background(), "namespaces", "restricted-cluster-admin|", "user")
	require.NoError(t, err)
	require.Len(t, oldQueue.scopes, 1)
	require.Len(t, newQueue.scopes, 1)
	require.Equal(t, "restricted-cluster-admin|", newQueue.scopes[0])
	require.Equal(t, "namespaces", newQueue.domain)
	require.Equal(t, "user", newQueue.reason)
}

func TestAggregateManualQueueDoesNotMoveTerminalJobsToReplacementQueue(t *testing.T) {
	for _, state := range []refresh.JobState{refresh.JobStateFailed, refresh.JobStateCancelled} {
		t.Run(string(state), func(t *testing.T) {
			oldQueue := newStubManualQueue()
			aggregate := newAggregateManualQueue(map[string]*system.Subsystem{
				"cluster-a": {ManualQueue: oldQueue},
			})

			job, err := aggregate.Enqueue(context.Background(), "namespaces", "cluster-a|", "user")
			require.NoError(t, err)
			for _, child := range oldQueue.jobs {
				child.State = state
				oldQueue.Update(child)
			}

			newQueue := newStubManualQueue()
			aggregate.UpdateConfig(map[string]*system.Subsystem{
				"cluster-a": {ManualQueue: newQueue},
			})

			require.Empty(t, newQueue.scopes)
			status, ok := aggregate.Status(job.ID)
			require.True(t, ok)
			require.Equal(t, state, status.State)
		})
	}
}

func TestAggregateManualQueueMovesUnfinishedJobToReplacementQueue(t *testing.T) {
	oldQueue := newStubManualQueue()
	aggregate := newAggregateManualQueue(map[string]*system.Subsystem{
		"restricted-cluster-admin": {ManualQueue: oldQueue},
	})

	job, err := aggregate.Enqueue(context.Background(), "namespaces", "restricted-cluster-admin|", "user")
	require.NoError(t, err)

	newQueue := newStubManualQueue()
	aggregate.UpdateConfig(map[string]*system.Subsystem{
		"restricted-cluster-admin": {ManualQueue: newQueue},
	})

	require.Len(t, oldQueue.scopes, 1)
	require.Len(t, newQueue.scopes, 1)
	for _, child := range newQueue.jobs {
		child.State = refresh.JobStateSucceeded
		newQueue.Update(child)
	}

	status, ok := aggregate.Status(job.ID)
	require.True(t, ok)
	require.Equal(t, refresh.JobStateSucceeded, status.State)
	require.Empty(t, status.Error)
}

func TestAggregateManualQueueUpdateReplacesJob(t *testing.T) {
	queue := newStubManualQueue()
	subsystems := map[string]*system.Subsystem{
		"cluster-a": {ManualQueue: queue},
	}
	aggregate := newAggregateManualQueue(subsystems)

	job, err := aggregate.Enqueue(context.Background(), "namespaces", "cluster-a|", "initial")
	require.NoError(t, err)

	updated := *job
	updated.Reason = "updated"
	aggregate.Update(&updated)

	aggStatus, ok := aggregate.Status(job.ID)
	require.True(t, ok)
	require.Equal(t, "updated", aggStatus.Reason)
}

func TestAggregateManualQueueNextReturnsContextError(t *testing.T) {
	queue := newStubManualQueue()
	subsystems := map[string]*system.Subsystem{
		"cluster-a": {ManualQueue: queue},
	}
	aggregate := newAggregateManualQueue(subsystems)

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	job, err := aggregate.Next(ctx)
	require.Nil(t, job)
	require.ErrorIs(t, err, context.Canceled)
}

func TestGenerateAggregateJobIDReturnsUniquePrefix(t *testing.T) {
	id1 := generateAggregateJobID()
	time.Sleep(time.Nanosecond)
	id2 := generateAggregateJobID()

	require.NotEmpty(t, id1)
	require.NotEmpty(t, id2)
	require.NotEqual(t, id1, id2)
	require.Contains(t, id1, "job-agg-")
}
