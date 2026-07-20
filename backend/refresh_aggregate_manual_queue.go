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

// aggregateManualQueue routes cluster-scoped manual refresh jobs to per-cluster queues.
type aggregateManualQueue struct {
	clusterOrder []string
	queues       map[string]refresh.ManualQueue

	mu       sync.RWMutex
	configMu sync.RWMutex
	jobs     map[string]*aggregateManualJob
}

// aggregateManualJob tracks the child job created for a cluster-scoped refresh.
type aggregateManualJob struct {
	job         *refresh.ManualRefreshJob
	clusterJobs map[string]aggregateManualChildJob
}

// aggregateManualChildJob binds a child job to the queue that owns its status.
// A terminal child remains there; an unfinished child moves to a replacement
// queue when its cluster subsystem is rebuilt.
type aggregateManualChildJob struct {
	jobID string
	queue refresh.ManualQueue
}

type aggregateManualJobMigration struct {
	aggregateJobID string
	clusterID      string
	domain         string
	scope          string
	reason         string
	previous       aggregateManualChildJob
	replacement    refresh.ManualQueue
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

// Enqueue registers a manual refresh job for exactly one target cluster.
func (q *aggregateManualQueue) Enqueue(ctx context.Context, domain, scope, reason string) (*refresh.ManualRefreshJob, error) {
	if domain == "" {
		return nil, errors.New("domain is required")
	}
	queues := q.snapshotConfig()
	clusterIDs, scopeValue := refresh.SplitClusterScopeList(scope)
	target, err := q.resolveTarget(domain, clusterIDs, queues)
	if err != nil {
		return nil, err
	}
	queue := queues[target]
	if queue == nil {
		return nil, fmt.Errorf("manual queue unavailable for %s", target)
	}
	scoped := refresh.JoinClusterScope(target, scopeValue)
	job, err := queue.Enqueue(ctx, domain, scoped, reason)
	if err != nil {
		return nil, err
	}
	clusterJobs := map[string]aggregateManualChildJob{
		target: {jobID: job.ID, queue: queue},
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

// Status returns the aggregate job state mirrored from its per-cluster child job.
func (q *aggregateManualQueue) Status(jobID string) (*refresh.ManualRefreshJob, bool) {
	q.mu.RLock()
	agg := q.jobs[jobID]
	if agg == nil {
		q.mu.RUnlock()
		return nil, false
	}
	base := *agg.job
	clusterJobs := make(map[string]aggregateManualChildJob, len(agg.clusterJobs))
	for id, child := range agg.clusterJobs {
		clusterJobs[id] = child
	}
	q.mu.RUnlock()

	return buildAggregateStatus(&base, clusterJobs), true
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

func (q *aggregateManualQueue) resolveTarget(
	domain string,
	clusterIDs []string,
	queues map[string]refresh.ManualQueue,
) (string, error) {
	if len(clusterIDs) == 0 {
		return "", fmt.Errorf("cluster scope is required for domain %s", domain)
	}
	if len(clusterIDs) > 1 {
		return "", fmt.Errorf("domain %s requires a single cluster scope (requested: %v)", domain, clusterIDs)
	}

	target := clusterIDs[0]
	if _, ok := queues[target]; !ok {
		return "", fmt.Errorf("cluster %s not active", target)
	}
	return target, nil
}

func buildAggregateStatus(
	base *refresh.ManualRefreshJob,
	clusterJobs map[string]aggregateManualChildJob,
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

	for clusterID, child := range clusterJobs {
		queue := child.queue
		if queue == nil {
			hasFailed = true
			if firstErr == "" {
				firstErr = fmt.Sprintf("cluster %s job missing", clusterID)
			}
			continue
		}
		job, ok := queue.Status(child.jobID)
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

func (q *aggregateManualQueue) snapshotConfig() map[string]refresh.ManualQueue {
	q.configMu.RLock()
	defer q.configMu.RUnlock()
	queues := make(map[string]refresh.ManualQueue, len(q.queues))
	for id, queue := range q.queues {
		queues[id] = queue
	}
	return queues
}

// UpdateConfig refreshes the aggregate manual queue wiring after selection changes.
func (q *aggregateManualQueue) UpdateConfig(clusterOrder []string, subsystems map[string]*system.Subsystem) {
	if q == nil {
		return
	}
	next := newAggregateManualQueue(clusterOrder, subsystems)
	q.configMu.Lock()
	q.clusterOrder = next.clusterOrder
	q.queues = next.queues
	q.configMu.Unlock()

	q.moveUnfinishedJobs(next.queues)
}

// moveUnfinishedJobs preserves refresh intent across a subsystem re-warm. The
// old manager has stopped consuming its queue, so an unfinished child must be
// re-enqueued on the replacement manager instead of remaining queued forever.
func (q *aggregateManualQueue) moveUnfinishedJobs(queues map[string]refresh.ManualQueue) {
	q.mu.RLock()
	migrations := make([]aggregateManualJobMigration, 0)
	for aggregateJobID, aggregateJob := range q.jobs {
		if aggregateJob == nil || aggregateJob.job == nil {
			continue
		}
		for clusterID, child := range aggregateJob.clusterJobs {
			replacement := queues[clusterID]
			if replacement == nil || child.queue == replacement {
				continue
			}
			if status, ok := child.queue.Status(child.jobID); ok && status != nil {
				switch status.State {
				case refresh.JobStateQueued, refresh.JobStateRunning:
				default:
					continue
				}
			}
			_, scopeValue := refresh.SplitClusterScopeList(aggregateJob.job.Scope)
			migrations = append(migrations, aggregateManualJobMigration{
				aggregateJobID: aggregateJobID,
				clusterID:      clusterID,
				domain:         aggregateJob.job.Domain,
				scope:          refresh.JoinClusterScope(clusterID, scopeValue),
				reason:         aggregateJob.job.Reason,
				previous:       child,
				replacement:    replacement,
			})
		}
	}
	q.mu.RUnlock()

	for _, migration := range migrations {
		job, err := migration.replacement.Enqueue(
			context.Background(),
			migration.domain,
			migration.scope,
			migration.reason,
		)
		if err != nil || job == nil {
			continue
		}

		q.mu.Lock()
		aggregateJob := q.jobs[migration.aggregateJobID]
		if aggregateJob != nil {
			current, ok := aggregateJob.clusterJobs[migration.clusterID]
			if ok && current.jobID == migration.previous.jobID && current.queue == migration.previous.queue {
				aggregateJob.clusterJobs[migration.clusterID] = aggregateManualChildJob{
					jobID: job.ID,
					queue: migration.replacement,
				}
			}
		}
		q.mu.Unlock()
	}
}

// generateAggregateJobID returns a unique identifier for aggregate manual refresh jobs.
func generateAggregateJobID() string {
	return fmt.Sprintf("job-agg-%d", time.Now().UnixNano())
}
