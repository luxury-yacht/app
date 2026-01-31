package nodemaintenance

import (
	"testing"
	"time"

	restypes "github.com/luxury-yacht/app/backend/resources/types"
)

func TestStoreStartAndSnapshot(t *testing.T) {
	store := NewStore(2)
	opts := restypes.DrainNodeOptions{Force: true}

	job := store.StartDrain("NodeA", opts)
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
	snap, version := store.Snapshot("")
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
	snapNode, _ := store.Snapshot("NODEA")
	if len(snapNode.Drains) != 1 {
		t.Fatalf("expected single drain for node")
	}
}

func TestDrainJobEventsAndCompletion(t *testing.T) {
	store := NewStore(3)
	job := store.StartDrain("node-b", restypes.DrainNodeOptions{})

	job.AddInfo("cordon", "cordon succeeded")
	job.AddPodEvent("evicting", "ns1", "pod-a", "evicting pod", false)
	job.AddPodEvent("failed", "ns1", "pod-b", "eviction failed", true)

	job.Complete(DrainStatusSucceeded, "drain complete")
	snap, _ := store.Snapshot("node-b")
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
	store.StartDrain("node-c", restypes.DrainNodeOptions{})
	// Second job should evict the first due to maxHistory=1
	time.Sleep(1 * time.Millisecond)
	store.StartDrain("node-c", restypes.DrainNodeOptions{})

	snap, _ := store.Snapshot("node-c")
	if len(snap.Drains) != 1 {
		t.Fatalf("expected bounded history of 1, got %d", len(snap.Drains))
	}
	// The remaining job should be the most recent
	if snap.Drains[0].StartedAt == 0 {
		t.Fatalf("expected StartedAt set")
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
	}
	for _, tt := range tests {
		if got := ParseScope(tt.scope); got != tt.want {
			t.Fatalf("ParseScope(%q)=%q, want %q", tt.scope, got, tt.want)
		}
	}
}

func TestGlobalStoreDefault(t *testing.T) {
	s := GlobalStore()
	if s == nil {
		t.Fatalf("expected global store")
	}
	if GlobalStore() != s {
		t.Fatalf("expected singleton global store")
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
	snap, version := store.Snapshot("missing")
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
	jobA := store.StartDrain("worker-1", restypes.DrainNodeOptions{})
	jobA.ClusterID = "cluster-a"
	jobA.ClusterName = "Cluster A"
	// Update the job in the store with the cluster info
	store.SetJobCluster(jobA.ID, "cluster-a", "Cluster A")

	// Start a drain job for cluster B on the SAME node name (worker-1)
	jobB := store.StartDrain("worker-1", restypes.DrainNodeOptions{})
	jobB.ClusterID = "cluster-b"
	jobB.ClusterName = "Cluster B"
	store.SetJobCluster(jobB.ID, "cluster-b", "Cluster B")

	// GetJobsForCluster should return only jobs for the matching cluster
	jobsA := store.GetJobsForCluster("cluster-a")
	jobsB := store.GetJobsForCluster("cluster-b")

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

	// Verify that querying a non-existent cluster returns empty
	jobsC := store.GetJobsForCluster("cluster-c")
	if len(jobsC) != 0 {
		t.Fatalf("expected 0 jobs for cluster-c, got %d", len(jobsC))
	}

	// Verify Snapshot still sees all jobs for the node
	snap, _ := store.Snapshot("worker-1")
	if len(snap.Drains) != 2 {
		t.Fatalf("expected 2 total drains for worker-1 node, got %d", len(snap.Drains))
	}
}
