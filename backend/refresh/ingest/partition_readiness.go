package ingest

import (
	"github.com/luxury-yacht/app/backend/refresh"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// PartitionReadiness retains permission-denied namespaces alongside active
// reflectors. An empty namespace denotes the cluster-wide source.
type PartitionReadiness struct {
	Namespace string
	State     refresh.ResourceReadiness
}

// PartitionReadinessFor reads availability without copying any resource rows.
// Static and runtime-discovered sources expose the same partition states.
func (m *IngestManager) PartitionReadinessFor(gvr schema.GroupVersionResource) []PartitionReadiness {
	m.mu.Lock()
	e := m.entries[gvr]
	if e == nil {
		e = m.entryForGroupResourceLocked(gvr.GroupResource())
	}
	m.mu.Unlock()
	if e == nil || (e.dynamic != nil && e.dynamic.retired.Load()) {
		return nil
	}
	e.store.mu.RLock()
	defer e.store.mu.RUnlock()
	states := make([]PartitionReadiness, 0, len(e.parts))
	for _, part := range e.parts {
		_, synced := e.store.syncedPartitions[part.namespace]
		state := partitionReadiness(part.skipped.Load(), e.store.synced || synced, e.degraded.Load())
		states = append(states, PartitionReadiness{Namespace: part.namespace, State: state})
	}
	return states
}

func partitionReadiness(skipped, synced, degraded bool) refresh.ResourceReadiness {
	switch {
	case skipped:
		return refresh.ResourceReadinessUnavailable
	case synced:
		return refresh.ResourceReadinessReady
	case degraded:
		return refresh.ResourceReadinessDegraded
	default:
		return refresh.ResourceReadinessPending
	}
}
