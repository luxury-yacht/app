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

func TestAggregateManualQueueEnqueueFansOut(t *testing.T) {
	queueA := newStubManualQueue()
	queueB := newStubManualQueue()
	subsystems := map[string]*system.Subsystem{
		"cluster-a": {ManualQueue: queueA},
		"cluster-b": {ManualQueue: queueB},
	}
	aggregate := newAggregateManualQueue("cluster-a", []string{"cluster-a", "cluster-b"}, subsystems)

	job, err := aggregate.Enqueue(context.Background(), "namespaces", "clusters=cluster-a,cluster-b|namespace:default", "manual")
	require.NoError(t, err)
	require.NotNil(t, job)
	require.Len(t, queueA.scopes, 1)
	require.Len(t, queueB.scopes, 1)
	require.Equal(t, "cluster-a|namespace:default", queueA.scopes[0])
	require.Equal(t, "cluster-b|namespace:default", queueB.scopes[0])
}

func TestAggregateManualQueueStatusAggregatesFailures(t *testing.T) {
	queueA := newStubManualQueue()
	queueB := newStubManualQueue()
	subsystems := map[string]*system.Subsystem{
		"cluster-a": {ManualQueue: queueA},
		"cluster-b": {ManualQueue: queueB},
	}
	aggregate := newAggregateManualQueue("cluster-a", []string{"cluster-a", "cluster-b"}, subsystems)

	job, err := aggregate.Enqueue(context.Background(), "namespaces", "clusters=cluster-a,cluster-b|", "")
	require.NoError(t, err)
	require.NotNil(t, job)

	require.Len(t, queueA.jobs, 1)
	require.Len(t, queueB.jobs, 1)
	for _, child := range queueA.jobs {
		child.State = refresh.JobStateSucceeded
		queueA.Update(child)
	}
	for _, child := range queueB.jobs {
		child.State = refresh.JobStateFailed
		child.Error = "boom"
		queueB.Update(child)
	}

	aggStatus, ok := aggregate.Status(job.ID)
	require.True(t, ok)
	require.Equal(t, refresh.JobStateFailed, aggStatus.State)
	require.Contains(t, aggStatus.Error, "cluster-b")
}

func TestAggregateManualQueueUpdateReplacesJob(t *testing.T) {
	queue := newStubManualQueue()
	subsystems := map[string]*system.Subsystem{
		"cluster-a": {ManualQueue: queue},
	}
	aggregate := newAggregateManualQueue("cluster-a", []string{"cluster-a"}, subsystems)

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
	aggregate := newAggregateManualQueue("cluster-a", []string{"cluster-a"}, subsystems)

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
