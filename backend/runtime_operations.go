package backend

import (
	"fmt"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

const runtimeOperationsListEventName = "runtime-operations:list"

type RuntimeOperationType string

const (
	RuntimeOperationShell       RuntimeOperationType = "shell"
	RuntimeOperationPortForward RuntimeOperationType = "port-forward"
	RuntimeOperationDrain       RuntimeOperationType = "drain"
)

type RuntimeOperationTargetRef = resourcemodel.ResourceRef

type RuntimeOperation struct {
	ID           string                     `json:"id"`
	Type         RuntimeOperationType       `json:"type"`
	ClusterID    string                     `json:"clusterId"`
	ClusterName  string                     `json:"clusterName,omitempty"`
	Target       *RuntimeOperationTargetRef `json:"target,omitempty"`
	Status       string                     `json:"status"`
	StatusReason string                     `json:"statusReason,omitempty"`
	StartedAt    string                     `json:"startedAt"`
	DisplayName  string                     `json:"displayName,omitempty"`
	Summary      map[string]string          `json:"summary,omitempty"`
}

type runtimeOperationCleanup func(reason string) error

type runtimeOperationEntry struct {
	operation RuntimeOperation
	cleanup   runtimeOperationCleanup
}

type runtimeOperationRegistry struct {
	mu         sync.RWMutex
	operations map[string]runtimeOperationEntry
}

func newRuntimeOperationRegistry() *runtimeOperationRegistry {
	return &runtimeOperationRegistry{operations: make(map[string]runtimeOperationEntry)}
}

func (r *runtimeOperationRegistry) upsert(operation RuntimeOperation, cleanup runtimeOperationCleanup) {
	if r == nil || strings.TrimSpace(operation.ID) == "" {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	r.operations[operation.ID] = runtimeOperationEntry{
		operation: operation,
		cleanup:   cleanup,
	}
}

func (r *runtimeOperationRegistry) remove(id string) bool {
	if r == nil {
		return false
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, ok := r.operations[id]; !ok {
		return false
	}
	delete(r.operations, id)
	return true
}

func (r *runtimeOperationRegistry) removeCluster(clusterID string) []runtimeOperationEntry {
	if r == nil {
		return nil
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	var removed []runtimeOperationEntry
	for id, entry := range r.operations {
		if entry.operation.ClusterID == clusterID {
			removed = append(removed, entry)
			delete(r.operations, id)
		}
	}
	return removed
}

func (r *runtimeOperationRegistry) list() []RuntimeOperation {
	if r == nil {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]RuntimeOperation, 0, len(r.operations))
	for _, entry := range r.operations {
		result = append(result, cloneRuntimeOperation(entry.operation))
	}
	sort.Slice(result, func(i, j int) bool {
		left, leftErr := time.Parse(time.RFC3339, result[i].StartedAt)
		right, rightErr := time.Parse(time.RFC3339, result[j].StartedAt)
		if leftErr == nil && rightErr == nil && !left.Equal(right) {
			return left.Before(right)
		}
		if result[i].Type != result[j].Type {
			return result[i].Type < result[j].Type
		}
		return result[i].ID < result[j].ID
	})
	return result
}

func (r *runtimeOperationRegistry) clusterIDs() []string {
	if r == nil {
		return nil
	}
	r.mu.RLock()
	defer r.mu.RUnlock()
	seen := make(map[string]struct{})
	for _, entry := range r.operations {
		if entry.operation.ClusterID == "" {
			continue
		}
		seen[entry.operation.ClusterID] = struct{}{}
	}
	result := make([]string, 0, len(seen))
	for id := range seen {
		result = append(result, id)
	}
	sort.Strings(result)
	return result
}

func cloneRuntimeOperation(operation RuntimeOperation) RuntimeOperation {
	clone := operation
	if operation.Target != nil {
		target := *operation.Target
		clone.Target = &target
	}
	if operation.Summary != nil {
		clone.Summary = make(map[string]string, len(operation.Summary))
		for key, value := range operation.Summary {
			clone.Summary[key] = value
		}
	}
	return clone
}

func (a *App) ensureRuntimeOperationRegistry() *runtimeOperationRegistry {
	if a == nil {
		return nil
	}
	a.runtimeOperationsMu.Lock()
	defer a.runtimeOperationsMu.Unlock()
	if a.runtimeOperations == nil {
		a.runtimeOperations = newRuntimeOperationRegistry()
	}
	return a.runtimeOperations
}

func (a *App) registerRuntimeOperation(operation RuntimeOperation, cleanup runtimeOperationCleanup) {
	registry := a.ensureRuntimeOperationRegistry()
	if registry == nil {
		return
	}
	registry.upsert(operation, cleanup)
	a.emitRuntimeOperationsList()
}

func (a *App) unregisterRuntimeOperation(id string) {
	registry := a.ensureRuntimeOperationRegistry()
	if registry == nil {
		return
	}
	if registry.remove(id) {
		a.emitRuntimeOperationsList()
	}
}

func (a *App) ListRuntimeOperations() []RuntimeOperation {
	registry := a.ensureRuntimeOperationRegistry()
	if registry == nil {
		return nil
	}
	return registry.list()
}

func (a *App) emitRuntimeOperationsList() {
	a.emitEvent(runtimeOperationsListEventName, a.ListRuntimeOperations())
}

func (a *App) cleanupClusterRuntimeOperations(clusterID, reason string) {
	trimmedClusterID := strings.TrimSpace(clusterID)
	if trimmedClusterID == "" {
		return
	}
	registry := a.ensureRuntimeOperationRegistry()
	if registry == nil {
		return
	}

	for _, entry := range registry.removeCluster(trimmedClusterID) {
		if entry.cleanup == nil {
			continue
		}
		if err := entry.cleanup(reason); err != nil {
			a.logger.Warn(fmt.Sprintf("Failed to clean up %s operation %s for cluster %s: %v", entry.operation.Type, entry.operation.ID, trimmedClusterID, err), logsources.App)
		}
	}

	a.emitRuntimeOperationsList()
}

func (a *App) runtimeOperationClusterIDs() []string {
	if registry := a.ensureRuntimeOperationRegistry(); registry != nil {
		return registry.clusterIDs()
	}
	return nil
}

func runtimeOperationTarget(clusterID, group, version, kind, namespace, name string) *RuntimeOperationTargetRef {
	ref := resourcemodel.NewResourceRef(clusterID, group, version, kind, "", namespace, name, "")
	return &ref
}
