package nodemaintenance

import (
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
	DrainStatusSucceeded DrainStatus = "succeeded"
	DrainStatusFailed    DrainStatus = "failed"
)

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
	Drains []DrainJob `json:"drains"`
}

// Store tracks drain jobs per node with bounded history.
type Store struct {
	mu         sync.RWMutex
	jobs       map[string]*DrainJob
	byNode     map[string][]*DrainJob
	version    uint64
	maxHistory int
}

var defaultStore = NewStore(5)

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
		byNode:     make(map[string][]*DrainJob),
		maxHistory: maxHistory,
	}
}

// StartDrain records the beginning of a drain job.
func (s *Store) StartDrain(nodeName string, opts restypes.DrainNodeOptions) *DrainJob {
	s.mu.Lock()
	defer s.mu.Unlock()

	id := uuid.NewString()
	normalizedNode := normalizeNodeName(nodeName)
	job := &DrainJob{
		store:     s,
		ID:        id,
		NodeName:  normalizedNode,
		Status:    DrainStatusRunning,
		StartedAt: time.Now().UnixMilli(),
		Options:   opts,
		Events: []DrainEvent{{
			ID:        uuid.NewString(),
			Timestamp: time.Now().UnixMilli(),
			Kind:      EventKindInfo,
			Phase:     "scheduled",
			Message:   "Drain initiated",
		}},
	}

	s.jobs[id] = job
	existing := s.byNode[normalizedNode]
	s.byNode[normalizedNode] = append([]*DrainJob{job}, existing...)
	if len(s.byNode[normalizedNode]) > s.maxHistory {
		toRemove := s.byNode[normalizedNode][s.maxHistory:]
		s.byNode[normalizedNode] = s.byNode[normalizedNode][:s.maxHistory]
		for _, old := range toRemove {
			delete(s.jobs, old.ID)
		}
	}
	s.version++
	return job
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
	job.Status = status
	job.Message = message
	if job.CompletedAt == 0 {
		job.CompletedAt = time.Now().UnixMilli()
	}
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
		jobs = append(jobs, s.byNode[normalizeNodeName(nodeName)]...)
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

// ParseScope extracts the node name from a scope string.
func ParseScope(scope string) string {
	if scope == "" {
		return ""
	}
	trimmed := strings.TrimSpace(strings.ToLower(scope))
	if trimmed == "" {
		return ""
	}
	if strings.HasPrefix(trimmed, "node:") {
		return strings.TrimPrefix(trimmed, "node:")
	}
	return trimmed
}
