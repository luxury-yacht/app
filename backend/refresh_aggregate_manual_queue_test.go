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
	aggregate := newAggregateManualQueue([]string{"cluster-a", "cluster-b"}, subsystems)

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
	aggregate := newAggregateManualQueue([]string{"cluster-a", "cluster-b"}, subsystems)

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
	aggregate := newAggregateManualQueue([]string{"cluster-a"}, subsystems)

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

func TestAggregateManualQueueStatusSurvivesQueueReplacement(t *testing.T) {
	oldQueue := newStubManualQueue()
	aggregate := newAggregateManualQueue([]string{"restricted-cluster-admin"}, map[string]*system.Subsystem{
		"restricted-cluster-admin": {ManualQueue: oldQueue},
	})

	job, err := aggregate.Enqueue(context.Background(), "namespaces", "restricted-cluster-admin|", "user")
	require.NoError(t, err)
	for _, child := range oldQueue.jobs {
		child.State = refresh.JobStateSucceeded
		oldQueue.Update(child)
	}

	newQueue := newStubManualQueue()
	aggregate.UpdateConfig([]string{"restricted-cluster-admin"}, map[string]*system.Subsystem{
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
			aggregate := newAggregateManualQueue([]string{"cluster-a"}, map[string]*system.Subsystem{
				"cluster-a": {ManualQueue: oldQueue},
			})

			job, err := aggregate.Enqueue(context.Background(), "namespaces", "cluster-a|", "user")
			require.NoError(t, err)
			for _, child := range oldQueue.jobs {
				child.State = state
				oldQueue.Update(child)
			}

			newQueue := newStubManualQueue()
			aggregate.UpdateConfig([]string{"cluster-a"}, map[string]*system.Subsystem{
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
	aggregate := newAggregateManualQueue([]string{"restricted-cluster-admin"}, map[string]*system.Subsystem{
		"restricted-cluster-admin": {ManualQueue: oldQueue},
	})

	job, err := aggregate.Enqueue(context.Background(), "namespaces", "restricted-cluster-admin|", "user")
	require.NoError(t, err)

	newQueue := newStubManualQueue()
	aggregate.UpdateConfig([]string{"restricted-cluster-admin"}, map[string]*system.Subsystem{
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
	aggregate := newAggregateManualQueue([]string{"cluster-a"}, subsystems)

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
	aggregate := newAggregateManualQueue([]string{"cluster-a"}, subsystems)

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
