package nodemaintenance

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
)

// DrainStatus captures the high-level lifecycle for a drain job.
type DrainStatus string

const (
	DrainStatusRunning   DrainStatus = "running"
	DrainStatusCanceling DrainStatus = "canceling"
	DrainStatusCancelled DrainStatus = "cancelled"
	DrainStatusSucceeded DrainStatus = "succeeded"
	DrainStatusFailed    DrainStatus = "failed"
)

const AggregateScope = "aggregate"

// DrainEventKind represents the type of drain event emitted.
type DrainEventKind string

const (
	EventKindInfo  DrainEventKind = "info"
	EventKindPod   DrainEventKind = "pod"
	EventKindError DrainEventKind = "error"
)

// DrainEvent captures discrete milestones or pod updates for a drain job.
type DrainEvent struct {
	ID           string         `json:"id"`
	Timestamp    int64          `json:"timestamp"`
	Kind         DrainEventKind `json:"kind"`
	Phase        string         `json:"phase,omitempty"`
	Message      string         `json:"message,omitempty"`
	PodNamespace string         `json:"podNamespace,omitempty"`
	PodName      string         `json:"podName,omitempty"`
}

// DrainJob summarises the lifecycle of a single drain invocation.
type DrainJob struct {
	store       *Store
	ClusterID   string                    `json:"clusterId,omitempty"`
	ClusterName string                    `json:"clusterName,omitempty"`
	ID          string                    `json:"id"`
	NodeName    string                    `json:"nodeName"`
	Status      DrainStatus               `json:"status"`
	StartedAt   int64                     `json:"startedAt"`
	CompletedAt int64                     `json:"completedAt,omitempty"`
	Message     string                    `json:"message,omitempty"`
	Options     restypes.DrainNodeOptions `json:"options"`
	Events      []DrainEvent              `json:"events,omitempty"`
}

// Snapshot is the payload returned to refresh clients.
type Snapshot struct {
	ClusterID   string     `json:"clusterId,omitempty"`
	ClusterName string     `json:"clusterName,omitempty"`
	Drains      []DrainJob `json:"drains"`
}

// Store tracks drain jobs per node with bounded history.
type Store struct {
	mu         sync.RWMutex
	jobs       map[string]*DrainJob
	byNode     map[drainHistoryKey][]*DrainJob
	cancels    map[string]context.CancelFunc
	version    uint64
	maxHistory int
}

var defaultStore = NewStore(5)

type drainHistoryKey struct {
	clusterID string
	nodeName  string
}

// GlobalStore exposes the process-wide drain store.
func GlobalStore() *Store {
	return defaultStore
}

// NewStore builds a new drain store with the provided history length.
func NewStore(maxHistory int) *Store {
	if maxHistory <= 0 {
		maxHistory = 5
	}
	return &Store{
		jobs:       make(map[string]*DrainJob),
		byNode:     make(map[drainHistoryKey][]*DrainJob),
		cancels:    make(map[string]context.CancelFunc),
		maxHistory: maxHistory,
	}
}

// StartDrain records the beginning of a drain job.
func (s *Store) StartDrain(nodeName string, opts restypes.DrainNodeOptions) *DrainJob {
	return s.StartDrainForCluster(nodeName, opts, "", "")
}

// StartDrainForCluster records the beginning of a drain job scoped to a cluster.
func (s *Store) StartDrainForCluster(nodeName string, opts restypes.DrainNodeOptions, clusterID, clusterName string) *DrainJob {
	s.mu.Lock()
	defer s.mu.Unlock()

	return s.startDrainForClusterLocked(nodeName, opts, clusterID, clusterName)
}

// StartDrainForClusterIfIdle records a drain job unless that cluster/node already has one active.
func (s *Store) StartDrainForClusterIfIdle(nodeName string, opts restypes.DrainNodeOptions, clusterID, clusterName string) (*DrainJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()

	key := drainHistoryKey{
		clusterID: strings.TrimSpace(clusterID),
		nodeName:  normalizeNodeName(nodeName),
	}
	if active := s.activeJobForKeyLocked(key); active != nil {
		return nil, fmt.Errorf("drain already running for node %s (job %s)", key.nodeName, active.ID)
	}

	return s.startDrainForClusterLocked(nodeName, opts, clusterID, clusterName), nil
}

func (s *Store) startDrainForClusterLocked(nodeName string, opts restypes.DrainNodeOptions, clusterID, clusterName string) *DrainJob {
	id := uuid.NewString()
	normalizedNode := normalizeNodeName(nodeName)
	job := &DrainJob{
		store:       s,
		ID:          id,
		ClusterID:   strings.TrimSpace(clusterID),
		ClusterName: strings.TrimSpace(clusterName),
		NodeName:    normalizedNode,
		Status:      DrainStatusRunning,
		StartedAt:   time.Now().UnixMilli(),
		Options:     opts,
		Events: []DrainEvent{{
			ID:        uuid.NewString(),
			Timestamp: time.Now().UnixMilli(),
			Kind:      EventKindInfo,
			Phase:     "scheduled",
			Message:   "Drain initiated",
		}},
	}

	s.jobs[id] = job
	s.addJobToHistoryLocked(job)
	s.version++
	return job
}

// RegisterCancel stores the cancellation callback for a running job.
func (s *Store) RegisterCancel(jobID string, cancel context.CancelFunc) {
	if cancel == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.jobs[jobID] == nil {
		return
	}
	s.cancels[jobID] = cancel
}

// ClearCancel removes a job cancellation callback once execution is finished.
func (s *Store) ClearCancel(jobID string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.cancels, jobID)
}

// CancelDrainForCluster requests cancellation for an active drain job in the given cluster.
func (s *Store) CancelDrainForCluster(jobID, clusterID string) error {
	trimmedID := strings.TrimSpace(jobID)
	if trimmedID == "" {
		return fmt.Errorf("job ID is required")
	}
	expectedCluster := strings.TrimSpace(clusterID)

	var cancel context.CancelFunc
	s.mu.Lock()
	job := s.jobs[trimmedID]
	if job == nil {
		s.mu.Unlock()
		return fmt.Errorf("drain job %s not found", trimmedID)
	}
	if strings.TrimSpace(job.ClusterID) != expectedCluster {
		s.mu.Unlock()
		return fmt.Errorf("drain job %s not found for cluster %s", trimmedID, expectedCluster)
	}
	if !isActiveStatus(job.Status) {
		s.mu.Unlock()
		return fmt.Errorf("drain job %s is not running", trimmedID)
	}
	job.Status = DrainStatusCanceling
	job.Message = "Cancellation requested"
	job.Events = append(job.Events, DrainEvent{
		ID:        uuid.NewString(),
		Timestamp: time.Now().UnixMilli(),
		Kind:      EventKindInfo,
		Phase:     "cancel-requested",
		Message:   "Cancellation requested",
	})
	cancel = s.cancels[trimmedID]
	s.version++
	s.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	return nil
}

// CancelActiveDrainsForClusterLifecycle cancels active drain jobs for a cluster
// during cluster lifecycle cleanup. It intentionally bypasses RBAC checks; the
// cluster is already being removed, so cleanup must not depend on a live client.
func (s *Store) CancelActiveDrainsForClusterLifecycle(clusterID, message string) int {
	expectedCluster := strings.TrimSpace(clusterID)
	if expectedCluster == "" {
		return 0
	}
	if strings.TrimSpace(message) == "" {
		message = "Cluster disconnected"
	}

	var cancels []context.CancelFunc
	s.mu.Lock()
	now := time.Now().UnixMilli()
	cancelled := 0
	for _, job := range s.jobs {
		if job == nil || strings.TrimSpace(job.ClusterID) != expectedCluster || !isActiveStatus(job.Status) {
			continue
		}
		job.Status = DrainStatusCancelled
		job.Message = message
		if job.CompletedAt == 0 {
			job.CompletedAt = now
		}
		job.Events = append(job.Events, DrainEvent{
			ID:        uuid.NewString(),
			Timestamp: job.CompletedAt,
			Kind:      EventKindInfo,
			Phase:     "cancelled",
			Message:   message,
		})
		if cancel := s.cancels[job.ID]; cancel != nil {
			cancels = append(cancels, cancel)
			delete(s.cancels, job.ID)
		}
		cancelled++
	}
	if cancelled > 0 {
		s.version++
	}
	s.mu.Unlock()

	for _, cancel := range cancels {
		cancel()
	}
	return cancelled
}

// AddInfo records a descriptive event.
func (j *DrainJob) AddInfo(phase, message string) {
	j.addEvent(EventKindInfo, phase, message, "", "")
}

// AddPodEvent records a pod-specific event.
func (j *DrainJob) AddPodEvent(phase, namespace, name, message string, isError bool) {
	kind := EventKindPod
	if isError {
		kind = EventKindError
	}
	j.addEvent(kind, phase, message, namespace, name)
}

// Complete finalises the job status.
func (j *DrainJob) Complete(status DrainStatus, message string) {
	if j == nil || j.store == nil {
		return
	}
	j.store.mu.Lock()
	defer j.store.mu.Unlock()

	job := j.store.jobs[j.ID]
	if job == nil {
		return
	}
	if job.CompletedAt != 0 {
		return
	}
	job.Status = status
	job.Message = message
	job.CompletedAt = time.Now().UnixMilli()
	job.Events = append(job.Events, DrainEvent{
		ID:        uuid.NewString(),
		Timestamp: job.CompletedAt,
		Kind:      EventKindInfo,
		Phase:     "completed",
		Message:   message,
	})
	j.store.version++
}

func (j *DrainJob) addEvent(kind DrainEventKind, phase, message, namespace, name string) {
	if j == nil || j.store == nil {
		return
	}
	j.store.mu.Lock()
	defer j.store.mu.Unlock()

	job := j.store.jobs[j.ID]
	if job == nil {
		return
	}
	event := DrainEvent{
		ID:           uuid.NewString(),
		Timestamp:    time.Now().UnixMilli(),
		Kind:         kind,
		Phase:        phase,
		Message:      message,
		PodNamespace: namespace,
		PodName:      name,
	}
	job.Events = append(job.Events, event)
	j.store.version++
}

// Snapshot returns a stable copy of jobs scoped to a node (or all nodes when empty).
func (s *Store) Snapshot(nodeName string) (Snapshot, uint64) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var jobs []*DrainJob
	if nodeName == "" {
		for _, entries := range s.byNode {
			jobs = append(jobs, entries...)
		}
		sort.Slice(jobs, func(i, j2 int) bool {
			return jobs[i].StartedAt > jobs[j2].StartedAt
		})
	} else {
		normalizedNode := normalizeNodeName(nodeName)
		for key, entries := range s.byNode {
			if key.nodeName == normalizedNode {
				jobs = append(jobs, entries...)
			}
		}
		sort.Slice(jobs, func(i, j2 int) bool {
			return jobs[i].StartedAt > jobs[j2].StartedAt
		})
	}

	result := Snapshot{
		Drains: make([]DrainJob, 0, len(jobs)),
	}
	for _, job := range jobs {
		if job == nil {
			continue
		}
		result.Drains = append(result.Drains, cloneJob(job))
	}

	return result, s.version
}

func cloneJob(job *DrainJob) DrainJob {
	copyJob := *job
	copyJob.store = nil
	if len(job.Events) > 0 {
		copyJob.Events = make([]DrainEvent, len(job.Events))
		copy(copyJob.Events, job.Events)
	}
	return copyJob
}

func normalizeNodeName(name string) string {
	return strings.TrimSpace(strings.ToLower(name))
}

func jobHistoryKey(job *DrainJob) drainHistoryKey {
	if job == nil {
		return drainHistoryKey{}
	}
	return drainHistoryKey{
		clusterID: strings.TrimSpace(job.ClusterID),
		nodeName:  normalizeNodeName(job.NodeName),
	}
}

func (s *Store) addJobToHistoryLocked(job *DrainJob) {
	key := jobHistoryKey(job)
	existing := s.byNode[key]
	s.byNode[key] = append([]*DrainJob{job}, existing...)
	s.enforceHistoryLimitLocked(key)
}

func (s *Store) removeJobFromAllHistoryLocked(jobID string) {
	for key := range s.byNode {
		s.removeJobFromHistoryKeyLocked(key, jobID)
	}
}

func (s *Store) removeJobFromHistoryKeyLocked(key drainHistoryKey, jobID string) {
	entries := s.byNode[key]
	for i, candidate := range entries {
		if candidate != nil && candidate.ID == jobID {
			entries = append(entries[:i], entries[i+1:]...)
			break
		}
	}
	if len(entries) == 0 {
		delete(s.byNode, key)
		return
	}
	s.byNode[key] = entries
}

func (s *Store) enforceHistoryLimitLocked(key drainHistoryKey) {
	entries := s.byNode[key]
	if len(entries) <= s.maxHistory {
		return
	}
	toRemove := entries[s.maxHistory:]
	s.byNode[key] = entries[:s.maxHistory]
	for _, old := range toRemove {
		if old != nil {
			delete(s.jobs, old.ID)
		}
	}
}

func (s *Store) activeJobForKeyLocked(key drainHistoryKey) *DrainJob {
	for _, job := range s.byNode[key] {
		if job != nil && isActiveStatus(job.Status) {
			return job
		}
	}
	return nil
}

func isActiveStatus(status DrainStatus) bool {
	return status == DrainStatusRunning || status == DrainStatusCanceling
}

// ParseScope extracts the node name from a scope string.
func ParseScope(scope string) string {
	if scope == "" {
		return ""
	}
	trimmed := strings.TrimSpace(strings.ToLower(scope))
	if trimmed == "" {
		return ""
	}
	if trimmed == AggregateScope {
		return ""
	}
	if strings.HasPrefix(trimmed, "node:") {
		return strings.TrimPrefix(trimmed, "node:")
	}
	return trimmed
}

// SetJobCluster sets the cluster ID and name for a drain job.
// This allows associating a drain job with a specific cluster for isolation purposes.
func (s *Store) SetJobCluster(jobID, clusterID, clusterName string) {
	s.mu.Lock()
	defer s.mu.Unlock()

	job := s.jobs[jobID]
	if job == nil {
		return
	}
	s.removeJobFromAllHistoryLocked(job.ID)
	job.ClusterID = strings.TrimSpace(clusterID)
	job.ClusterName = strings.TrimSpace(clusterName)
	s.addJobToHistoryLocked(job)
	s.version++
}

// GetJobsForCluster returns all drain jobs that belong to a specific cluster.
// This enables cluster isolation by filtering jobs by their ClusterID.
func (s *Store) GetJobsForCluster(clusterID string) []*DrainJob {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var result []*DrainJob
	for _, job := range s.jobs {
		if job.ClusterID == clusterID {
			result = append(result, job)
		}
	}
	return result
}

func (s *Store) JobForCluster(jobID, clusterID string) (DrainJob, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	job := s.jobs[strings.TrimSpace(jobID)]
	if job == nil || job.ClusterID != strings.TrimSpace(clusterID) {
		return DrainJob{}, false
	}
	return cloneJob(job), true
}
