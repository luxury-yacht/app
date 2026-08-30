package ingest

import (
	"context"
	"sort"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/klog/v2"
)

type initialIngestTask struct {
	launch ingestLaunchEntry
	part   *ingestPart
}

// initialIngestPriority is the Workloads view's ingest-owned dependency set.
// ReplicaSets and HPA are typed informers, so they are started by the informer
// factory; these six feeds receive the ingest queue's first wave.
var initialIngestPriority = []schema.GroupVersionResource{
	{Group: "", Version: "v1", Resource: "pods"},
	{Group: "apps", Version: "v1", Resource: "deployments"},
	{Group: "apps", Version: "v1", Resource: "statefulsets"},
	{Group: "apps", Version: "v1", Resource: "daemonsets"},
	{Group: "batch", Version: "v1", Resource: "jobs"},
	{Group: "batch", Version: "v1", Resource: "cronjobs"},
}

// prepareInitialIngestTasks declares every store's expected partitions before
// any reflector can run, applies permission skips, and returns a deterministic
// queue. Priority kinds are round-robined across namespaces before the remaining
// kinds, preventing one scoped kind from monopolizing every startup slot.
func prepareInitialIngestTasks(entries []ingestLaunchEntry, filter func(string, string, string) bool) []initialIngestTask {
	priorityRank := make(map[schema.GroupVersionResource]int, len(initialIngestPriority))
	for i, gvr := range initialIngestPriority {
		priorityRank[gvr] = i
	}
	sort.Slice(entries, func(i, j int) bool {
		iRank, iPriority := priorityRank[entries[i].gvr]
		jRank, jPriority := priorityRank[entries[j].gvr]
		if iPriority != jPriority {
			return iPriority
		}
		if iPriority && iRank != jRank {
			return iRank < jRank
		}
		return entries[i].gvr.String() < entries[j].gvr.String()
	})

	priorityParts := make([][]initialIngestTask, 0, len(initialIngestPriority))
	remainingParts := make([][]initialIngestTask, 0, len(entries))
	for _, launch := range entries {
		launch.e.gvr = launch.gvr
		launched := permittedIngestPartitions(launch, filter)
		// Expected partitions must be declared BEFORE any reflector of any entry
		// runs, so each store's sync gate counts exactly its approved set.
		launch.e.store.SetExpectedPartitions(launched)
		parts := make([]initialIngestTask, 0, len(launched))
		for _, part := range launch.e.parts {
			if part.skipped.Load() {
				continue
			}
			parts = append(parts, initialIngestTask{launch: launch, part: part})
		}
		if _, priority := priorityRank[launch.gvr]; priority {
			priorityParts = append(priorityParts, parts)
		} else {
			remainingParts = append(remainingParts, parts)
		}
	}
	return append(roundRobinIngestTasks(priorityParts), roundRobinIngestTasks(remainingParts)...)
}

func roundRobinIngestTasks(byEntry [][]initialIngestTask) []initialIngestTask {
	count := 0
	maxParts := 0
	for _, parts := range byEntry {
		count += len(parts)
		if len(parts) > maxParts {
			maxParts = len(parts)
		}
	}
	out := make([]initialIngestTask, 0, count)
	for partIndex := 0; partIndex < maxParts; partIndex++ {
		for _, parts := range byEntry {
			if partIndex < len(parts) {
				out = append(out, parts[partIndex])
			}
		}
	}
	return out
}

// runInitialIngestQueue admits a bounded number of initial snapshots during the
// readiness window. A slot opens when that partition lands or when the
// cluster-wide initial-sync deadline expires. Reflectors are never stopped at
// the deadline: they keep retrying in the background under runCtx, preserving
// the existing recovery contract.
func (m *IngestManager) runInitialIngestQueue(runCtx context.Context, tasks []initialIngestTask, initialWaveStarted chan<- struct{}) {
	if len(tasks) == 0 {
		close(initialWaveStarted)
		return
	}
	limit := m.initialSyncConcurrency
	if limit <= 0 {
		limit = config.RefreshIngestInitialSyncConcurrency
	}
	settled := make(chan struct{}, limit)
	next := 0
	active := 0
	for next < len(tasks) || active > 0 {
		for next < len(tasks) && active < limit {
			task := tasks[next]
			next++
			active++
			go runWithResume(runCtx, task.part.lw, task.part.view, task.part.resumeRV, func() {
				task.part.reflector.Run(runCtx)
			})
			go m.waitForInitialIngestTask(runCtx, task, settled)
		}
		if initialWaveStarted != nil {
			close(initialWaveStarted)
			initialWaveStarted = nil
		}
		if active == 0 {
			return
		}
		select {
		case <-runCtx.Done():
			return
		case <-settled:
			active--
		}
	}
}

func (m *IngestManager) waitForInitialIngestTask(runCtx context.Context, task initialIngestTask, settled chan<- struct{}) {
	ticker := time.NewTicker(config.RefreshInformerSyncPollInterval)
	defer ticker.Stop()
	for {
		if task.launch.e.store.HasSyncedPartition(task.part.namespace) || m.syncDeadlineExceeded() {
			select {
			case settled <- struct{}{}:
			case <-runCtx.Done():
			}
			return
		}
		select {
		case <-runCtx.Done():
			return
		case <-ticker.C:
		}
	}
}

func permittedIngestPartitions(launch ingestLaunchEntry, filter func(string, string, string) bool) []string {
	launched := make([]string, 0, len(launch.e.parts))
	for _, part := range launch.e.parts {
		if filter != nil && !filter(launch.gvr.Group, launch.gvr.Resource, part.namespace) {
			part.skipped.Store(true)
			logSkippedIngestPart(launch.gvr, part.namespace)
			continue
		}
		part.skipped.Store(false)
		launched = append(launched, part.namespace)
	}
	return launched
}

func logSkippedIngestPart(gvr schema.GroupVersionResource, namespace string) {
	if namespace == "" {
		klog.V(2).Infof("ingest: skipping %s — identity cannot list/watch it (logged once)", gvr)
		return
	}
	klog.V(2).Infof("ingest: skipping %s in %q — identity cannot list/watch it there (logged once)", gvr, namespace)
}
