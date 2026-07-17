package snapshot

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func TestClusterAttentionIndexReplacesOnlyTheNamedSource(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	index := newClusterAttentionIndex(ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}, func() time.Time { return now })
	t.Cleanup(index.Stop)

	pod := attentionSourceRecord{
		Ref: attentionTestRef("Pod", "payments", "checkout-0"), Source: attentionSourcePod,
		Status: "CrashLoopBackOff", StatusPresentation: "error", Restarts: 3,
		AgeTimestamp: now.Add(-time.Hour).UnixMilli(),
	}
	node := attentionSourceRecord{
		Ref: attentionTestRef("Node", "", "worker-a"), Source: attentionSourceNode,
		Status: "Not Ready", StatusPresentation: "warning",
		AgeTimestamp: now.Add(-time.Hour).UnixMilli(),
	}

	index.ReplaceSource("pods", []attentionSourceRecord{pod})
	index.ReplaceSource("nodes", []attentionSourceRecord{node})
	require.Len(t, index.Snapshot(), 2)

	index.ReplaceSource("pods", nil)
	rows := index.Snapshot()
	require.Len(t, rows, 1)
	require.Equal(t, node.Ref, rows[0].Ref)
}

func TestClusterAttentionIndexIgnoresStaleDeadlineGenerations(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	index := newClusterAttentionIndex(ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}, func() time.Time { return now })
	t.Cleanup(index.Stop)

	createdAt := now.Add(-2 * time.Minute)
	record := attentionSourceRecord{
		Ref: attentionTestRef("Pod", "payments", "checkout-0"), Source: attentionSourcePod,
		Status: "ContainerCreating", StatusPresentation: "warning",
		AgeTimestamp: createdAt.UnixMilli(),
	}
	index.UpsertSource("pods", record)
	require.Empty(t, index.Snapshot())

	record.Status = "Running"
	record.StatusPresentation = "ready"
	index.UpsertSource("pods", record)
	now = createdAt.Add(attentionWarningGrace)
	index.EvaluateDue(now)

	require.Empty(t, index.Snapshot())
	require.Equal(t, uint64(0), index.Revision())
}

func TestClusterAttentionIndexAdvancesRevisionOnlyWhenFindingChanges(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	index := newClusterAttentionIndex(ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}, func() time.Time { return now })
	t.Cleanup(index.Stop)
	record := attentionSourceRecord{
		Ref: attentionTestRef("Pod", "payments", "checkout-0"), Source: attentionSourcePod,
		Status: "Running", StatusPresentation: "ready", Restarts: 2,
		AgeTimestamp: now.Add(-time.Hour).UnixMilli(),
	}

	index.UpsertSource("pods", record)
	require.Equal(t, uint64(1), index.Revision())
	index.UpsertSource("pods", record)
	require.Equal(t, uint64(1), index.Revision())

	record.Restarts = 0
	index.UpsertSource("pods", record)
	require.Equal(t, uint64(2), index.Revision())
	require.Empty(t, index.Snapshot())
}

func TestClusterAttentionIndexRestoredRowsReconcilePerOwnerKind(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	meta := ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}
	original := newClusterAttentionIndex(meta, func() time.Time { return now })
	original.UpsertSource("pods", attentionSourceRecord{
		Ref: attentionTestRef("Pod", "payments", "checkout-0"), Source: attentionSourcePod,
		Status: "Running", StatusPresentation: "ready", Restarts: 2,
		AgeTimestamp: now.Add(-time.Hour).UnixMilli(),
	})
	original.UpsertSource("nodes", attentionSourceRecord{
		Ref: attentionTestRef("Node", "", "worker-a"), Source: attentionSourceNode,
		Status: "Not Ready", StatusPresentation: "warning",
		AgeTimestamp: now.Add(-time.Hour).UnixMilli(),
	})
	spillPath := t.TempDir() + "/attention.spill"
	require.NoError(t, original.SpillTo(spillPath))
	original.Stop()

	restored := newClusterAttentionIndex(meta, func() time.Time { return now })
	t.Cleanup(restored.Stop)
	restored.registerOwnerKind("pods", "Pod")
	restored.registerOwnerKind("nodes", "Node")
	require.NoError(t, restored.RestoreFrom(spillPath))
	require.Len(t, restored.Snapshot(), 2)

	restored.ReplaceSource("pods", nil)
	rows := restored.Snapshot()
	require.Len(t, rows, 1)
	require.Equal(t, "Node", rows[0].Kind)
}

func TestClusterAttentionIndexReconcileRemovesRestoredRowsForUnavailableOwner(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	meta := ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}
	original := newClusterAttentionIndex(meta, func() time.Time { return now })
	original.UpsertSource("pods", attentionSourceRecord{
		Ref: attentionTestRef("Pod", "payments", "checkout-0"), Source: attentionSourcePod,
		Status: "Running", StatusPresentation: "ready", Restarts: 2,
		AgeTimestamp: now.Add(-time.Hour).UnixMilli(),
	})
	spillPath := t.TempDir() + "/attention.spill"
	require.NoError(t, original.SpillTo(spillPath))
	original.Stop()

	restored := newClusterAttentionIndex(meta, func() time.Time { return now })
	t.Cleanup(restored.Stop)
	restored.registerOwnerKind("pods", "Pod")
	restored.markOwnerUnavailable("pods")
	require.NoError(t, restored.RestoreFrom(spillPath))
	require.Len(t, restored.Snapshot(), 1)

	restored.Reconcile()
	require.Empty(t, restored.Snapshot())
}
