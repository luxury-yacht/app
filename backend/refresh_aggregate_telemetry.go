package backend

import (
	"sync"

	"github.com/luxury-yacht/app/backend/refresh/system"
	"github.com/luxury-yacht/app/backend/refresh/telemetry"
)

// aggregateTelemetry merges diagnostics telemetry across every active cluster
// subsystem so the diagnostics view is multi-cluster aware. Each per-cluster
// recorder stamps its Streams/Snapshots with its clusterId (see
// telemetry.Recorder.SnapshotSummary), so concatenating them yields one
// cluster-attributed row set instead of a single arbitrarily-picked cluster's
// counters. It holds a live reference to the recorder set and is re-scoped via
// Update on cluster open/close, mirroring the other aggregate handlers.
type aggregateTelemetry struct {
	mu        sync.RWMutex
	recorders []*telemetry.Recorder
}

func newAggregateTelemetry(clusterOrder []string, subsystems map[string]*system.Subsystem) *aggregateTelemetry {
	a := &aggregateTelemetry{}
	a.set(clusterOrder, subsystems)
	return a
}

// set captures the current active recorders in clusterOrder order.
func (a *aggregateTelemetry) set(clusterOrder []string, subsystems map[string]*system.Subsystem) {
	recorders := make([]*telemetry.Recorder, 0, len(clusterOrder))
	for _, id := range clusterOrder {
		if sub := subsystems[id]; sub != nil && sub.Telemetry != nil {
			recorders = append(recorders, sub.Telemetry)
		}
	}
	a.mu.Lock()
	a.recorders = recorders
	a.mu.Unlock()
}

// Update re-scopes the aggregate to the new active cluster set so a closed
// cluster's telemetry stops being reported.
func (a *aggregateTelemetry) Update(clusterOrder []string, subsystems map[string]*system.Subsystem) {
	a.set(clusterOrder, subsystems)
}

// SnapshotSummary concatenates per-cluster Streams and Snapshots (already
// cluster-tagged by each recorder). Scalar, single-valued fields
// (Metrics/Connection/Catalog) come from the primary (first) recorder so they
// stay well-defined; per-cluster breakdown lives in the Streams/Snapshots slices.
func (a *aggregateTelemetry) SnapshotSummary() telemetry.Summary {
	a.mu.RLock()
	recorders := a.recorders
	a.mu.RUnlock()

	out := telemetry.Summary{
		Streams:   []telemetry.StreamStatus{},
		Snapshots: []telemetry.SnapshotStatus{},
	}
	for i, rec := range recorders {
		summary := rec.SnapshotSummary()
		out.Streams = append(out.Streams, summary.Streams...)
		out.Snapshots = append(out.Snapshots, summary.Snapshots...)
		if i == 0 {
			out.Metrics = summary.Metrics
			out.Connection = summary.Connection
			out.Catalog = summary.Catalog
		}
	}
	return out
}
