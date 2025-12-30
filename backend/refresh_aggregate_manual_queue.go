package backend

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/system"
)

// aggregateManualQueue fans out manual refresh jobs to per-cluster queues and aggregates status.
type aggregateManualQueue struct {
	clusterOrder []string
	queues       map[string]refresh.ManualQueue

	mu   sync.RWMutex
	jobs map[string]*aggregateManualJob
}

// aggregateManualJob tracks the child jobs created per cluster.
type aggregateManualJob struct {
	job         *refresh.ManualRefreshJob
	clusterJobs map[string]string
}

func newAggregateManualQueue(clusterOrder []string, subsystems map[string]*system.Subsystem) *aggregateManualQueue {
	queues := make(map[string]refresh.ManualQueue)
	for id, subsystem := range subsystems {
		if subsystem == nil || subsystem.ManualQueue == nil {
			continue
		}
		queues[id] = subsystem.ManualQueue
	}

	ordered := make([]string, 0, len(clusterOrder))
	for _, id := range clusterOrder {
		if _, ok := queues[id]; ok {
			ordered = append(ordered, id)
		}
	}
	if len(ordered) == 0 {
		for id := range queues {
			ordered = append(ordered, id)
		}
		sort.Strings(ordered)
	}
	return &aggregateManualQueue{
		clusterOrder: ordered,
		queues:       queues,
		jobs:         make(map[string]*aggregateManualJob),
	}
}

// Enqueue registers a manual refresh job across the target clusters.
func (q *aggregateManualQueue) Enqueue(ctx context.Context, domain, scope, reason string) (*refresh.ManualRefreshJob, error) {
	if domain == "" {
		return nil, errors.New("domain is required")
	}
	clusterIDs, scopeValue := refresh.SplitClusterScopeList(scope)
	targets, err := q.resolveTargets(domain, clusterIDs)
	if err != nil {
		return nil, err
	}
	if len(targets) == 0 {
		return nil, fmt.Errorf("no clusters available for %s", domain)
	}

	clusterJobs := make(map[string]string, len(targets))
	for _, id := range targets {
		queue := q.queues[id]
		if queue == nil {
			return nil, fmt.Errorf("manual queue unavailable for %s", id)
		}
		scoped := refresh.JoinClusterScope(id, scopeValue)
		job, err := queue.Enqueue(ctx, domain, scoped, reason)
		if err != nil {
			return nil, err
		}
		clusterJobs[id] = job.ID
	}

	aggregateJob := &refresh.ManualRefreshJob{
		ID:       generateAggregateJobID(),
		Domain:   domain,
		Scope:    scope,
		Reason:   reason,
		State:    refresh.JobStateQueued,
		QueuedAt: time.Now().UnixMilli(),
	}

	q.mu.Lock()
	q.jobs[aggregateJob.ID] = &aggregateManualJob{job: aggregateJob, clusterJobs: clusterJobs}
	q.mu.Unlock()

	return aggregateJob, nil
}

// Status returns the aggregated job state for a composite manual refresh job.
func (q *aggregateManualQueue) Status(jobID string) (*refresh.ManualRefreshJob, bool) {
	q.mu.RLock()
	agg := q.jobs[jobID]
	if agg == nil {
		q.mu.RUnlock()
		return nil, false
	}
	base := *agg.job
	clusterJobs := make(map[string]string, len(agg.clusterJobs))
	for id, child := range agg.clusterJobs {
		clusterJobs[id] = child
	}
	q.mu.RUnlock()

	return q.buildAggregateStatus(&base, clusterJobs), true
}

// Update stores the aggregated job when invoked directly.
func (q *aggregateManualQueue) Update(job *refresh.ManualRefreshJob) {
	if job == nil {
		return
	}
	q.mu.Lock()
	if agg, ok := q.jobs[job.ID]; ok {
		agg.job = job
	}
	q.mu.Unlock()
}

// Next blocks until the context is cancelled because aggregation is API-facing only.
func (q *aggregateManualQueue) Next(ctx context.Context) (*refresh.ManualRefreshJob, error) {
	<-ctx.Done()
	return nil, ctx.Err()
}

func (q *aggregateManualQueue) resolveTargets(domain string, clusterIDs []string) ([]string, error) {
	if len(clusterIDs) > 0 {
		if isSingleClusterDomain(domain) && len(clusterIDs) > 1 {
			return nil, fmt.Errorf("domain %s is only available on a single cluster", domain)
		}
		targets := make([]string, 0, len(clusterIDs))
		for _, id := range clusterIDs {
			if _, ok := q.queues[id]; !ok {
				return nil, fmt.Errorf("cluster %s not active", id)
			}
			targets = append(targets, id)
		}
		return targets, nil
	}

	if isSingleClusterDomain(domain) {
		return nil, fmt.Errorf("domain %s requires an explicit cluster scope", domain)
	}

	return append([]string(nil), q.clusterOrder...), nil
}

func (q *aggregateManualQueue) buildAggregateStatus(
	base *refresh.ManualRefreshJob,
	clusterJobs map[string]string,
) *refresh.ManualRefreshJob {
	state := refresh.JobStateQueued
	var (
		hasQueued    bool
		hasRunning   bool
		hasFailed    bool
		hasCancelled bool
		firstErr     string
		maxVersion   uint64
		startedAt    int64
		finishedAt   int64
	)

	for clusterID, jobID := range clusterJobs {
		queue := q.queues[clusterID]
		if queue == nil {
			hasFailed = true
			if firstErr == "" {
				firstErr = fmt.Sprintf("cluster %s job missing", clusterID)
			}
			continue
		}
		job, ok := queue.Status(jobID)
		if !ok || job == nil {
			hasFailed = true
			if firstErr == "" {
				firstErr = fmt.Sprintf("cluster %s job missing", clusterID)
			}
			continue
		}

		switch job.State {
		case refresh.JobStateQueued:
			hasQueued = true
		case refresh.JobStateRunning:
			hasRunning = true
		case refresh.JobStateFailed:
			hasFailed = true
		case refresh.JobStateCancelled:
			hasCancelled = true
		}

		if job.Error != "" && firstErr == "" {
			firstErr = fmt.Sprintf("%s: %s", clusterID, job.Error)
		}
		if job.LatestVersion > maxVersion {
			maxVersion = job.LatestVersion
		}
		if job.StartedAt > 0 && (startedAt == 0 || job.StartedAt < startedAt) {
			startedAt = job.StartedAt
		}
		if job.FinishedAt > finishedAt {
			finishedAt = job.FinishedAt
		}
	}

	switch {
	case hasFailed:
		state = refresh.JobStateFailed
	case hasCancelled:
		state = refresh.JobStateCancelled
	case hasRunning:
		state = refresh.JobStateRunning
	case hasQueued:
		state = refresh.JobStateQueued
	default:
		state = refresh.JobStateSucceeded
	}

	base.State = state
	base.Error = firstErr
	base.LatestVersion = maxVersion
	base.StartedAt = startedAt
	base.FinishedAt = finishedAt
	return base
}

// generateAggregateJobID returns a unique identifier for aggregate manual refresh jobs.
func generateAggregateJobID() string {
	return fmt.Sprintf("job-agg-%d", time.Now().UnixNano())
}
