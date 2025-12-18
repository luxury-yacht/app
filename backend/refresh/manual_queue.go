package refresh

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

// InMemoryQueue is a simple manual refresh queue implementation.
type InMemoryQueue struct {
	mu      sync.RWMutex
	jobs    map[string]*ManualRefreshJob
	pending chan string
}

// NewInMemoryQueue returns an empty queue.
func NewInMemoryQueue() *InMemoryQueue {
	return &InMemoryQueue{
		jobs:    make(map[string]*ManualRefreshJob),
		pending: make(chan string, 64),
	}
}

// Enqueue adds a manual refresh job with immediate queued state.
func (q *InMemoryQueue) Enqueue(ctx context.Context, domain, scope, reason string) (*ManualRefreshJob, error) {
	if domain == "" {
		return nil, errors.New("domain is required")
	}

	job := &ManualRefreshJob{
		ID:       generateJobID(),
		Domain:   domain,
		Scope:    scope,
		Reason:   reason,
		State:    JobStateQueued,
		QueuedAt: time.Now().UnixMilli(),
	}

	q.mu.Lock()
	q.jobs[job.ID] = job
	q.mu.Unlock()

	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	case q.pending <- job.ID:
	}

	return job, nil
}

// Status returns the job by identifier if it exists.
func (q *InMemoryQueue) Status(jobID string) (*ManualRefreshJob, bool) {
	q.mu.RLock()
	defer q.mu.RUnlock()
	job, ok := q.jobs[jobID]
	return job, ok
}

func generateJobID() string {
	return fmt.Sprintf("job-%d", time.Now().UnixNano())
}

// Update replaces the job stored in the queue.
func (q *InMemoryQueue) Update(job *ManualRefreshJob) {
	if job == nil {
		return
	}
	q.mu.Lock()
	q.jobs[job.ID] = job
	q.mu.Unlock()
}

// Next blocks until a queued job is available or the context is cancelled.
func (q *InMemoryQueue) Next(ctx context.Context) (*ManualRefreshJob, error) {
	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case jobID := <-q.pending:
			q.mu.RLock()
			job := q.jobs[jobID]
			q.mu.RUnlock()
			if job == nil {
				continue
			}
			return job, nil
		}
	}
}
