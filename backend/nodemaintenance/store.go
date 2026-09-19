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

// DrainEventPhase is the closed set of drain event phases. The refresh contract
// generator discovers these typed constants and emits the frontend union.
type DrainEventPhase string

const (
	// Job lifecycle phases (emitted by the store).
	DrainPhaseScheduled       DrainEventPhase = "scheduled"
	DrainPhaseCancelRequested DrainEventPhase = "cancel-requested"
	DrainPhaseCancelled       DrainEventPhase = "cancelled"
	DrainPhaseCompleted       DrainEventPhase = "completed"

	// Drain step phases (emitted by the node drainer).
	DrainPhaseCordon         DrainEventPhase = "cordon"
	DrainPhaseCordonRetained DrainEventPhase = "cordon-retained"
	DrainPhaseError          DrainEventPhase = "error"
	DrainPhaseWarning        DrainEventPhase = "warning"
	DrainPhasePlan           DrainEventPhase = "plan"
	DrainPhaseSkipWait       DrainEventPhase = "skip-wait"
	DrainPhaseWait           DrainEventPhase = "wait"
	DrainPhaseWaitComplete   DrainEventPhase = "wait-complete"

	// Per-pod phases (eviction vs deletion variants).
	DrainPhaseEvicting    DrainEventPhase = "evicting"
	DrainPhaseDeleting    DrainEventPhase = "deleting"
	DrainPhaseEvicted     DrainEventPhase = "evicted"
	DrainPhaseDeleted     DrainEventPhase = "deleted"
	DrainPhaseEvictError  DrainEventPhase = "evict-error"
	DrainPhaseDeleteError DrainEventPhase = "delete-error"
)

// DrainEvent captures discrete milestones or pod updates for a drain job.
type DrainEvent struct {
	ID           string          `json:"id"`
	Timestamp    int64           `json:"timestamp"`
	Kind         DrainEventKind  `json:"kind"`
	Phase        DrainEventPhase `json:"phase,omitempty"`
	Message      string          `json:"message,omitempty"`
	PodNamespace string          `json:"podNamespace,omitempty"`
	PodName      string          `json:"podName,omitempty"`
}

// DrainJob summarises the lifecycle of a single drain invocation.
type DrainJob struct {
	store       *Store
	ClusterID   string                    `json:"clusterId"`
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
	ClusterID   string     `json:"clusterId"`
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

type drainHistoryKey struct {
	clusterID string
	nodeName  string
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
			Phase:     DrainPhaseScheduled,
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
		Phase:     DrainPhaseCancelRequested,
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
		if cancel := s.cancelJobForLifecycleLocked(job, message, now); cancel != nil {
			cancels = append(cancels, cancel)
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

// CancelDrainForClusterLifecycle cancels one active drain job during cluster
// lifecycle cleanup. It bypasses RBAC checks for the same reason as
// CancelActiveDrainsForClusterLifecycle: cleanup must not depend on a live
// selected client while the cluster is being removed.
func (s *Store) CancelDrainForClusterLifecycle(jobID, clusterID, message string) bool {
	trimmedID := strings.TrimSpace(jobID)
	expectedCluster := strings.TrimSpace(clusterID)
	if trimmedID == "" || expectedCluster == "" {
		return false
	}
	if strings.TrimSpace(message) == "" {
		message = "Cluster disconnected"
	}

	var cancel context.CancelFunc
	s.mu.Lock()
	job := s.jobs[trimmedID]
	if job == nil || strings.TrimSpace(job.ClusterID) != expectedCluster || !isActiveStatus(job.Status) {
		s.mu.Unlock()
		return false
	}
	cancel = s.cancelJobForLifecycleLocked(job, message, time.Now().UnixMilli())
	s.version++
	s.mu.Unlock()

	if cancel != nil {
		cancel()
	}
	return true
}

// cancelJobForLifecycleLocked records terminal cancellation while the store lock
// is held. Callers invoke the returned callback only after releasing that lock.
func (s *Store) cancelJobForLifecycleLocked(job *DrainJob, message string, now int64) context.CancelFunc {
	job.Status = DrainStatusCancelled
	job.Message = message
	if job.CompletedAt == 0 {
		job.CompletedAt = now
	}
	job.Events = append(job.Events, DrainEvent{
		ID: uuid.NewString(), Timestamp: job.CompletedAt, Kind: EventKindInfo,
		Phase: DrainPhaseCancelled, Message: message,
	})
	cancel := s.cancels[job.ID]
	if cancel != nil {
		delete(s.cancels, job.ID)
	}
	return cancel
}

// AddInfo records a descriptive event.
func (j *DrainJob) AddInfo(phase DrainEventPhase, message string) {
	j.addEvent(EventKindInfo, phase, message, "", "")
}

// AddPodEvent records a pod-specific event.
func (j *DrainJob) AddPodEvent(phase DrainEventPhase, namespace, name, message string, isError bool) {
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
		Phase:     DrainPhaseCompleted,
		Message:   message,
	})
	j.store.version++
}

func (j *DrainJob) addEvent(kind DrainEventKind, phase DrainEventPhase, message, namespace, name string) {
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

// Snapshot returns copied drain history for one cluster and an optional node.
func (s *Store) Snapshot(clusterID, nodeName string) (Snapshot, uint64) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	clusterID = strings.TrimSpace(clusterID)
	normalizedNode := normalizeNodeName(nodeName)
	result := Snapshot{ClusterID: clusterID, Drains: []DrainJob{}}
	if clusterID == "" {
		return result, s.version
	}
	for key, entries := range s.byNode {
		if key.clusterID != clusterID || (nodeName != "" && key.nodeName != normalizedNode) {
			continue
		}
		for _, job := range entries {
			if job != nil {
				result.Drains = append(result.Drains, cloneJob(job))
			}
		}
	}
	sort.Slice(result.Drains, func(i, j int) bool {
		return result.Drains[i].StartedAt > result.Drains[j].StartedAt
	})
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

func (s *Store) JobForCluster(jobID, clusterID string) (DrainJob, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	job := s.jobs[strings.TrimSpace(jobID)]
	if job == nil || job.ClusterID != strings.TrimSpace(clusterID) {
		return DrainJob{}, false
	}
	return cloneJob(job), true
}
