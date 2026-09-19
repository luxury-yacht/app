package nodemaintenance

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	restypes "github.com/luxury-yacht/app/backend/resources/types"
)

func TestMaintenanceWireIdentityIsRequired(t *testing.T) {
	for name, value := range map[string]any{
		"drain job": DrainJob{},
		"snapshot":  Snapshot{Drains: []DrainJob{}},
	} {
		t.Run(name, func(t *testing.T) {
			encoded, err := json.Marshal(value)
			if err != nil {
				t.Fatalf("marshal maintenance payload: %v", err)
			}
			if !strings.Contains(string(encoded), `"clusterId":""`) {
				t.Fatalf("clusterId must remain required on the wire, got %s", encoded)
			}
		})
	}
}

func TestStoreStartAndSnapshot(t *testing.T) {
	store := NewStore(2)
	opts := restypes.DrainNodeOptions{Force: true}

	job := store.StartDrainForCluster("NodeA", opts, "cluster-a", "Cluster A")
	if job.NodeName != "nodea" {
		t.Fatalf("expected normalized node name, got %q", job.NodeName)
	}
	if job.Status != DrainStatusRunning || job.CompletedAt != 0 {
		t.Fatalf("unexpected initial job state: %+v", job)
	}
	if len(job.Events) != 1 || job.Events[0].Phase != "scheduled" {
		t.Fatalf("expected scheduled event, got %+v", job.Events)
	}

	// Snapshot all nodes
	snap, version := store.Snapshot("cluster-a", "")
	if version == 0 {
		t.Fatalf("expected version to be incremented")
	}
	if len(snap.Drains) != 1 || snap.Drains[0].NodeName != "nodea" {
		t.Fatalf("unexpected snapshot drains: %+v", snap.Drains)
	}
	if snap.Drains[0].store != nil {
		t.Fatalf("expected store pointer to be stripped in snapshot")
	}

	// Snapshot specific node
	snapNode, _ := store.Snapshot("cluster-a", "NODEA")
	if len(snapNode.Drains) != 1 {
		t.Fatalf("expected single drain for node")
	}
}

func TestDrainJobEventsAndCompletion(t *testing.T) {
	store := NewStore(3)
	job := store.StartDrainForCluster("node-b", restypes.DrainNodeOptions{}, "cluster-a", "Cluster A")

	job.AddInfo("cordon", "cordon succeeded")
	job.AddPodEvent("evicting", "ns1", "pod-a", "evicting pod", false)
	job.AddPodEvent("failed", "ns1", "pod-b", "eviction failed", true)

	job.Complete(DrainStatusSucceeded, "drain complete")
	snap, _ := store.Snapshot("cluster-a", "node-b")
	if len(snap.Drains) != 1 {
		t.Fatalf("expected one drain entry, got %d", len(snap.Drains))
	}
	clone := snap.Drains[0]
	if clone.Status != DrainStatusSucceeded {
		t.Fatalf("expected succeeded status, got %s", clone.Status)
	}
	if clone.CompletedAt == 0 {
		t.Fatalf("expected CompletedAt set")
	}
	if clone.Message != "drain complete" {
		t.Fatalf("unexpected completion message: %s", clone.Message)
	}
	if len(clone.Events) < 4 {
		t.Fatalf("expected completion event appended, got %d events", len(clone.Events))
	}
}

func TestHistoryBounded(t *testing.T) {
	store := NewStore(1)
	store.StartDrainForCluster("node-c", restypes.DrainNodeOptions{}, "cluster-a", "Cluster A")
	// Second job should evict the first due to maxHistory=1
	time.Sleep(1 * time.Millisecond)
	store.StartDrainForCluster("node-c", restypes.DrainNodeOptions{}, "cluster-a", "Cluster A")

	snap, _ := store.Snapshot("cluster-a", "node-c")
	if len(snap.Drains) != 1 {
		t.Fatalf("expected bounded history of 1, got %d", len(snap.Drains))
	}
	// The remaining job should be the most recent
	if snap.Drains[0].StartedAt == 0 {
		t.Fatalf("expected StartedAt set")
	}
}

func TestHistoryBoundedPerClusterAndNode(t *testing.T) {
	store := NewStore(1)
	firstA := store.StartDrainForCluster("worker-1", restypes.DrainNodeOptions{}, "cluster-a", "Cluster A")
	time.Sleep(1 * time.Millisecond)
	secondA := store.StartDrainForCluster("worker-1", restypes.DrainNodeOptions{}, "cluster-a", "Cluster A")
	jobB := store.StartDrainForCluster("worker-1", restypes.DrainNodeOptions{}, "cluster-b", "Cluster B")

	jobsASnapshot, _ := store.Snapshot("cluster-a", "")
	jobsA := jobsASnapshot.Drains
	if len(jobsA) != 1 || jobsA[0].ID != secondA.ID {
		t.Fatalf("expected only newest cluster-a job, got %+v", jobsA)
	}
	jobsBSnapshot, _ := store.Snapshot("cluster-b", "")
	jobsB := jobsBSnapshot.Drains
	if len(jobsB) != 1 || jobsB[0].ID != jobB.ID {
		t.Fatalf("expected cluster-b job to be retained independently, got %+v", jobsB)
	}
	if _, ok := store.jobs[firstA.ID]; ok {
		t.Fatalf("expected oldest cluster-a job to be evicted")
	}

	snap, _ := store.Snapshot("cluster-a", "worker-1")
	if len(snap.Drains) != 1 || snap.Drains[0].ID != secondA.ID {
		t.Fatalf("expected only cluster-a history for worker-1, got %+v", snap.Drains)
	}
}

func TestStartDrainPreservesIndependentClusterHistories(t *testing.T) {
	store := NewStore(1)
	jobA := store.StartDrainForCluster("worker-1", restypes.DrainNodeOptions{}, "cluster-a", "Cluster A")
	jobB := store.StartDrainForCluster("worker-1", restypes.DrainNodeOptions{}, "cluster-b", "Cluster B")

	jobsASnapshot, _ := store.Snapshot("cluster-a", "")
	jobsA := jobsASnapshot.Drains
	jobsBSnapshot, _ := store.Snapshot("cluster-b", "")
	jobsB := jobsBSnapshot.Drains
	if len(jobsA) != 1 || jobsA[0].ID != jobA.ID {
		t.Fatalf("expected cluster-a job, got %+v", jobsA)
	}
	if len(jobsB) != 1 || jobsB[0].ID != jobB.ID {
		t.Fatalf("expected cluster-b job, got %+v", jobsB)
	}
}

func TestStartDrainForClusterIfIdleRejectsActiveJob(t *testing.T) {
	store := NewStore(5)
	first, err := store.StartDrainForClusterIfIdle("worker-1", restypes.DrainNodeOptions{}, "cluster-a", "Cluster A")
	if err != nil {
		t.Fatalf("expected first job to start: %v", err)
	}

	if _, err := store.StartDrainForClusterIfIdle("worker-1", restypes.DrainNodeOptions{}, "cluster-a", "Cluster A"); err == nil {
		t.Fatalf("expected duplicate active drain to be rejected")
	}

	first.Complete(DrainStatusSucceeded, "done")
	if _, err := store.StartDrainForClusterIfIdle("worker-1", restypes.DrainNodeOptions{}, "cluster-a", "Cluster A"); err != nil {
		t.Fatalf("expected new job after completion: %v", err)
	}
}

func TestCancelDrainForClusterMarksJobAndCallsCancel(t *testing.T) {
	store := NewStore(5)
	job, err := store.StartDrainForClusterIfIdle("worker-1", restypes.DrainNodeOptions{}, "cluster-a", "Cluster A")
	if err != nil {
		t.Fatalf("expected job: %v", err)
	}
	ctx, cancel := context.WithCancel(context.Background())
	store.RegisterCancel(job.ID, cancel)

	if err := store.CancelDrainForCluster(job.ID, "cluster-a"); err != nil {
		t.Fatalf("expected cancel to succeed: %v", err)
	}
	if ctx.Err() == nil {
		t.Fatalf("expected cancel function to be invoked")
	}

	snap, _ := store.Snapshot("cluster-a", "worker-1")
	if len(snap.Drains) != 1 {
		t.Fatalf("expected one drain, got %d", len(snap.Drains))
	}
	if snap.Drains[0].Status != DrainStatusCanceling {
		t.Fatalf("expected canceling status, got %s", snap.Drains[0].Status)
	}
}

func TestCancelDrainForClusterLifecycleCancelsOnlyRequestedJob(t *testing.T) {
	store := NewStore(5)
	jobA := store.StartDrainForCluster("worker-1", restypes.DrainNodeOptions{}, "cluster-a", "Cluster A")
	jobB := store.StartDrainForCluster("worker-2", restypes.DrainNodeOptions{}, "cluster-a", "Cluster A")
	jobOtherCluster := store.StartDrainForCluster("worker-1", restypes.DrainNodeOptions{}, "cluster-b", "Cluster B")
	ctx, cancel := context.WithCancel(context.Background())
	store.RegisterCancel(jobA.ID, cancel)

	if !store.CancelDrainForClusterLifecycle(jobA.ID, "cluster-a", "cluster disconnected") {
		t.Fatalf("expected lifecycle cancellation to succeed")
	}
	if ctx.Err() == nil {
		t.Fatalf("expected cancel function to be invoked")
	}

	cancelled, ok := store.JobForCluster(jobA.ID, "cluster-a")
	if !ok {
		t.Fatalf("expected cancelled job")
	}
	if cancelled.Status != DrainStatusCancelled {
		t.Fatalf("expected cancelled status, got %s", cancelled.Status)
	}
	stillRunning, ok := store.JobForCluster(jobB.ID, "cluster-a")
	if !ok || stillRunning.Status != DrainStatusRunning {
		t.Fatalf("expected same-cluster peer job to remain running, got %+v", stillRunning)
	}
	otherCluster, ok := store.JobForCluster(jobOtherCluster.ID, "cluster-b")
	if !ok || otherCluster.Status != DrainStatusRunning {
		t.Fatalf("expected other-cluster job to remain running, got %+v", otherCluster)
	}
}

func TestClusterLifecycleCancellationPublishesAllJobsBeforeCallbacks(t *testing.T) {
	store := NewStore(5)
	first := store.StartDrainForCluster("worker-1", restypes.DrainNodeOptions{}, "cluster-a", "Cluster A")
	second := store.StartDrainForCluster("worker-2", restypes.DrainNodeOptions{}, "cluster-a", "Cluster A")
	other := store.StartDrainForCluster("worker-1", restypes.DrainNodeOptions{}, "cluster-b", "Cluster B")
	finished := store.StartDrainForCluster("worker-3", restypes.DrainNodeOptions{}, "cluster-a", "Cluster A")
	finished.Complete(DrainStatusSucceeded, "done")
	_, before := store.Snapshot("cluster-a", "")

	callbacks := make(chan Snapshot, 2)
	for _, job := range []*DrainJob{first, second} {
		store.RegisterCancel(job.ID, func() {
			// Reading from cleanup must not deadlock on the store's write lock.
			snapshot, _ := store.Snapshot("cluster-a", "")
			callbacks <- snapshot
		})
	}
	result := make(chan int, 1)
	go func() {
		result <- store.CancelActiveDrainsForClusterLifecycle("cluster-a", "disconnected")
	}()
	select {
	case count := <-result:
		if count != 2 {
			t.Fatalf("expected two active cluster-a drains cancelled, got %d", count)
		}
	case <-time.After(time.Second):
		t.Fatal("lifecycle cleanup blocked while cancellation callbacks read the store")
	}
	for range 2 {
		snapshot := <-callbacks
		for _, job := range snapshot.Drains {
			switch job.ID {
			case first.ID, second.ID:
				if job.Status != DrainStatusCancelled || job.CompletedAt == 0 || len(job.Events) != 2 || job.Events[1].Phase != DrainPhaseCancelled {
					t.Fatalf("callback observed incomplete cancellation: %+v", job)
				}
			case finished.ID:
				if job.Status != DrainStatusSucceeded || len(job.Events) != 2 {
					t.Fatalf("completed history changed: %+v", job)
				}
			}
		}
	}
	if peer, ok := store.JobForCluster(other.ID, "cluster-b"); !ok || peer.Status != DrainStatusRunning {
		t.Fatalf("other cluster changed: %+v", peer)
	}
	_, after := store.Snapshot("cluster-a", "")
	if after != before+1 {
		t.Fatalf("expected one batch version advance: before %d, after %d", before, after)
	}
	if count := store.CancelActiveDrainsForClusterLifecycle("cluster-a", "again"); count != 0 {
		t.Fatalf("expected repeated cleanup to be a no-op, got %d", count)
	}
	_, repeated := store.Snapshot("cluster-a", "")
	if repeated != after || len(callbacks) != 0 {
		t.Fatal("repeated cleanup published another version or invoked callbacks")
	}
}

func TestParseScope(t *testing.T) {
	tests := []struct {
		scope string
		want  string
	}{
		{"", ""},
		{"   ", ""},
		{"node:Worker-1", "worker-1"},
		{"worker-2", "worker-2"},
		{AggregateScope, ""},
	}
	for _, tt := range tests {
		if got := ParseScope(tt.scope); got != tt.want {
			t.Fatalf("ParseScope(%q)=%q, want %q", tt.scope, got, tt.want)
		}
	}
}

func TestJobForClusterReturnsClusterScopedClone(t *testing.T) {
	store := NewStore(5)
	job := store.StartDrainForCluster("worker-1", restypes.DrainNodeOptions{}, "cluster-a", "Cluster A")
	store.StartDrainForCluster("worker-1", restypes.DrainNodeOptions{}, "cluster-b", "Cluster B")

	got, ok := store.JobForCluster(job.ID, "cluster-a")
	if !ok {
		t.Fatal("expected cluster-a job")
	}
	if got.ID != job.ID || got.ClusterID != "cluster-a" || got.NodeName != "worker-1" {
		t.Fatalf("unexpected job clone: %+v", got)
	}
	if got.store != nil {
		t.Fatal("expected returned job clone to omit store pointer")
	}
	if _, ok := store.JobForCluster(job.ID, "cluster-b"); ok {
		t.Fatal("expected job lookup to enforce cluster identity")
	}
}

func TestNilJobGuards(t *testing.T) {
	var job *DrainJob
	job.AddInfo("phase", "msg")
	job.AddPodEvent("phase", "ns", "pod", "msg", false)
	job.Complete(DrainStatusFailed, "fail")
}

func TestSnapshotUnknownNodeEmpty(t *testing.T) {
	store := NewStore(-1)
	snap, version := store.Snapshot("cluster-a", "missing")
	if version != 0 {
		t.Fatalf("expected version 0 for empty store")
	}
	if len(snap.Drains) != 0 {
		t.Fatalf("expected no drains for missing node, got %d", len(snap.Drains))
	}
}

// TestDrainStoreClusterIsolation verifies that drain jobs from different clusters
// are properly isolated, even when node names overlap across clusters.
func TestDrainStoreClusterIsolation(t *testing.T) {
	store := NewStore(5)

	// Start a drain job for cluster A on worker-1
	jobA := store.StartDrainForCluster("worker-1", restypes.DrainNodeOptions{}, "cluster-a", "Cluster A")

	// Start a drain job for cluster B on the SAME node name (worker-1)
	jobB := store.StartDrainForCluster("worker-1", restypes.DrainNodeOptions{}, "cluster-b", "Cluster B")

	// Snapshot should return only jobs for the matching cluster.
	jobsASnapshot, _ := store.Snapshot("cluster-a", "")
	jobsA := jobsASnapshot.Drains
	jobsBSnapshot, _ := store.Snapshot("cluster-b", "")
	jobsB := jobsBSnapshot.Drains

	if len(jobsA) != 1 {
		t.Fatalf("expected 1 job for cluster-a, got %d", len(jobsA))
	}
	if len(jobsB) != 1 {
		t.Fatalf("expected 1 job for cluster-b, got %d", len(jobsB))
	}
	if jobsA[0].ClusterID != "cluster-a" {
		t.Fatalf("expected cluster-a job, got cluster ID %q", jobsA[0].ClusterID)
	}
	if jobsB[0].ClusterID != "cluster-b" {
		t.Fatalf("expected cluster-b job, got cluster ID %q", jobsB[0].ClusterID)
	}
	if jobsB[0].ID != jobB.ID {
		t.Fatalf("expected the cluster-b job, got %+v", jobsB[0])
	}
	missingOwner, _ := store.Snapshot("", "worker-1")
	if len(missingOwner.Drains) != 0 {
		t.Fatalf("missing cluster must not expose global history: %+v", missingOwner.Drains)
	}

	// Verify that querying a non-existent cluster returns empty
	jobsCSnapshot, _ := store.Snapshot("cluster-c", "")
	jobsC := jobsCSnapshot.Drains
	if len(jobsC) != 0 {
		t.Fatalf("expected 0 jobs for cluster-c, got %d", len(jobsC))
	}

	// Node snapshots retain the requested cluster boundary.
	snap, _ := store.Snapshot("cluster-a", "worker-1")
	if len(snap.Drains) != 1 || snap.Drains[0].ID != jobA.ID {
		t.Fatalf("expected only cluster-a drain for worker-1, got %+v", snap.Drains)
	}
}
