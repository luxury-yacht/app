package snapshot

import (
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/resourcemodel"
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
		Status: "ContainerCreating", StatusState: "Pending", StatusPresentation: "warning",
		AgeTimestamp: createdAt.UnixMilli(),
	}
	index.UpsertSource("pods", record)
	require.Len(t, index.Snapshot(), 1)
	require.Equal(t, uint64(1), index.Revision())

	record.Status = "Running"
	record.StatusPresentation = "ready"
	index.UpsertSource("pods", record)
	require.Empty(t, index.Snapshot())
	require.Equal(t, uint64(2), index.Revision())
	now = createdAt.Add(attentionWarningGrace)
	index.EvaluateDue(now)

	require.Empty(t, index.Snapshot())
	require.Equal(t, uint64(2), index.Revision())
}

func TestClusterAttentionIndexElevatesTransientPodFindingAtGraceDeadline(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	createdAt := now.Add(-2 * time.Minute)
	index := newClusterAttentionIndex(ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}, func() time.Time { return now })
	t.Cleanup(index.Stop)
	record := attentionSourceRecord{
		Ref: attentionTestRef("Pod", "payments", "checkout-0"), Source: attentionSourcePod,
		Status: "Running", StatusState: "Running", StatusPresentation: "ready", Ready: "0/1",
		AgeTimestamp: createdAt.UnixMilli(),
	}

	index.UpsertSource("pods", record)
	rows := index.Snapshot()
	require.Len(t, rows, 1)
	require.Equal(t, AttentionSeverityInfo, rows[0].Severity)
	require.Equal(t, "pod-not-ready", rows[0].Causes[0].Type)
	require.Equal(t, uint64(1), index.Revision())

	now = createdAt.Add(attentionWarningGrace)
	index.EvaluateDue(now)
	rows = index.Snapshot()
	require.Len(t, rows, 1)
	require.Equal(t, AttentionSeverityWarning, rows[0].Severity)
	require.Equal(t, "pod-not-ready", rows[0].Causes[0].Type)
	require.Equal(t, uint64(2), index.Revision())
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

func TestClusterAttentionIndexAppliesTypeAndObjectIgnoresToActiveCauses(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	index := newClusterAttentionIndex(ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}, func() time.Time { return now })
	t.Cleanup(index.Stop)
	record := attentionSourceRecord{
		Ref: attentionTestRef("Pod", "payments", "checkout-0"), Source: attentionSourcePod,
		Status: "CrashLoopBackOff", StatusPresentation: "error", StatusReason: "CrashLoopBackOff", Restarts: 3,
		AgeTimestamp: now.Add(-time.Hour).UnixMilli(),
	}
	index.UpsertSource("pods", record)

	index.SetIgnoreRules(AttentionIgnoreRules{ClusterFindingTypes: []string{"restarts"}})
	rows := index.Snapshot()
	require.Len(t, rows, 1)
	require.Equal(t, []AttentionCause{{
		Type: "error-presentation", Label: "Error status", Message: "CrashLoopBackOff", Severity: AttentionSeverityError,
	}}, rows[0].Causes)

	index.SetIgnoreRules(AttentionIgnoreRules{
		ClusterFindingTypes: []string{"restarts"},
		ObjectFindings: []AttentionObjectFindingIgnore{{
			Ref: record.Ref, FindingType: "error-presentation",
		}},
	})
	require.Empty(t, index.Snapshot())
}

func TestClusterAttentionIndexAppliesObjectClusterAndGlobalFindingIgnoresIndependently(t *testing.T) {
	now := time.Date(2026, time.July, 17, 12, 0, 0, 0, time.UTC)
	index := newClusterAttentionIndex(ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}, func() time.Time { return now })
	t.Cleanup(index.Stop)
	record := attentionSourceRecord{
		Ref: attentionTestRef("Pod", "payments", "checkout-0"), Source: attentionSourcePod,
		Status: "CrashLoopBackOff", StatusPresentation: "error", StatusReason: "CrashLoopBackOff", Restarts: 3,
		AgeTimestamp: now.Add(-time.Hour).UnixMilli(),
	}
	index.UpsertSource("pods", record)

	index.SetIgnoreRules(AttentionIgnoreRules{ObjectFindings: []AttentionObjectFindingIgnore{{
		Ref: record.Ref, FindingType: "restarts",
	}}})
	rows := index.Snapshot()
	require.Len(t, rows, 1)
	require.Equal(t, []string{"error-presentation"}, []string{rows[0].Causes[0].Type})

	index.SetIgnoreRules(AttentionIgnoreRules{ClusterFindingTypes: []string{"error-presentation"}})
	rows = index.Snapshot()
	require.Len(t, rows, 1)
	require.Equal(t, []string{"restarts"}, []string{rows[0].Causes[0].Type})

	index.SetIgnoreRules(AttentionIgnoreRules{GlobalFindingTypes: []string{"restarts"}})
	rows = index.Snapshot()
	require.Len(t, rows, 1)
	require.Equal(t, []string{"error-presentation"}, []string{rows[0].Causes[0].Type})
}

func TestClusterAttentionIndexPrunesIndividualIgnoreWhenObjectDisappears(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	index := newClusterAttentionIndex(ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}, func() time.Time { return now })
	t.Cleanup(index.Stop)
	record := attentionSourceRecord{
		Ref: attentionTestRef("Pod", "payments", "checkout-0"), Source: attentionSourcePod,
		Status: "Running", StatusPresentation: "ready", Restarts: 3,
		AgeTimestamp: now.Add(-time.Hour).UnixMilli(),
	}
	var pruned []resourcemodel.ResourceRef
	index.SetIgnoredObjectPruner(func(ref resourcemodel.ResourceRef) { pruned = append(pruned, ref) })
	index.SetIgnoreRules(AttentionIgnoreRules{ObjectFindings: []AttentionObjectFindingIgnore{{Ref: record.Ref, FindingType: "restarts"}}})
	index.UpsertSource("pods", record)
	require.Empty(t, index.Snapshot())

	index.DeleteSource("pods", record.Ref)
	require.Equal(t, []resourcemodel.ResourceRef{record.Ref}, pruned)
	require.Empty(t, index.IgnoreRules().ObjectFindings)
}

func TestClusterAttentionIndexPrunesPersistedIgnoreWhenInitialOwnerSnapshotOmitsObject(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	index := newClusterAttentionIndex(ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}, func() time.Time { return now })
	t.Cleanup(index.Stop)
	ignored := attentionTestRef("Pod", "payments", "deleted-pod")
	var pruned []resourcemodel.ResourceRef
	index.registerOwnerKind("pods", "Pod")
	index.SetIgnoredObjectPruner(func(ref resourcemodel.ResourceRef) { pruned = append(pruned, ref) })
	index.SetIgnoreRules(AttentionIgnoreRules{ObjectFindings: []AttentionObjectFindingIgnore{{Ref: ignored, FindingType: "restarts"}}})

	index.ReplaceSource("pods", nil)

	require.Equal(t, []resourcemodel.ResourceRef{ignored}, pruned)
	require.Empty(t, index.IgnoreRules().ObjectFindings)
}

func TestClusterAttentionIndexDoesNotPruneIgnoresWhenOwnerIsUnavailable(t *testing.T) {
	index := newClusterAttentionIndex(ClusterMeta{ClusterID: "cluster-a"}, time.Now)
	t.Cleanup(index.Stop)
	ignored := attentionTestRef("Pod", "payments", "checkout-0")
	index.registerOwnerKind("pods", "Pod")
	index.SetIgnoreRules(AttentionIgnoreRules{ObjectFindings: []AttentionObjectFindingIgnore{{Ref: ignored, FindingType: "restarts"}}})
	var pruned []resourcemodel.ResourceRef
	index.SetIgnoredObjectPruner(func(ref resourcemodel.ResourceRef) { pruned = append(pruned, ref) })
	index.markOwnerUnavailable("pods")

	index.Reconcile()

	require.Empty(t, pruned)
	require.Equal(t, []AttentionObjectFindingIgnore{{Ref: ignored, FindingType: "restarts"}}, index.IgnoreRules().ObjectFindings)
}

func TestClusterAttentionIndexPrunesOldUIDIgnoreWhenObjectIsRecreated(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	index := newClusterAttentionIndex(ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}, func() time.Time { return now })
	t.Cleanup(index.Stop)
	oldRecord := attentionSourceRecord{
		Ref: attentionTestRef("Pod", "payments", "checkout-0"), Source: attentionSourcePod,
		Status: "Running", StatusPresentation: "ready", Restarts: 3,
		AgeTimestamp: now.Add(-time.Hour).UnixMilli(),
	}
	newRecord := oldRecord
	newRecord.Ref.UID = "replacement-uid"
	var pruned []resourcemodel.ResourceRef
	index.SetIgnoredObjectPruner(func(ref resourcemodel.ResourceRef) { pruned = append(pruned, ref) })
	index.SetIgnoreRules(AttentionIgnoreRules{ObjectFindings: []AttentionObjectFindingIgnore{{Ref: oldRecord.Ref, FindingType: "restarts"}}})
	index.UpsertSource("pods", oldRecord)

	index.UpsertSource("pods", newRecord)

	require.Equal(t, []resourcemodel.ResourceRef{oldRecord.Ref}, pruned)
	require.Empty(t, index.IgnoreRules().ObjectFindings)
	rows := index.Snapshot()
	require.Len(t, rows, 1)
	require.Equal(t, newRecord.Ref, rows[0].Ref)
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

func TestClusterAttentionReconcileDoesNotPruneEventIgnoresBeforeInformerSync(t *testing.T) {
	index := newClusterAttentionIndex(ClusterMeta{ClusterID: "c-1"}, time.Now)
	t.Cleanup(index.Stop)
	ref := attentionTestRef("Event", "default", "warning-1")
	index.registerOwnerKind("events", "Event")
	index.SetIgnoreRules(AttentionIgnoreRules{ObjectFindings: []AttentionObjectFindingIgnore{{
		Ref: ref, FindingType: "warning-event",
	}}})
	index.eventRows = func() []attentionSourceRecord { return nil }
	index.eventRowsSynced = func() bool { return false }

	index.Reconcile()

	require.Len(t, index.IgnoreRules().ObjectFindings, 1)
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

func TestClusterAttentionIndexDoesNotRestoreIgnoredSpillRows(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	meta := ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}
	record := attentionSourceRecord{
		Ref: attentionTestRef("Pod", "payments", "checkout-0"), Source: attentionSourcePod,
		Status: "Running", StatusPresentation: "ready", Restarts: 2,
		AgeTimestamp: now.Add(-time.Hour).UnixMilli(),
	}
	original := newClusterAttentionIndex(meta, func() time.Time { return now })
	original.UpsertSource("pods", record)
	spillPath := t.TempDir() + "/attention.spill"
	require.NoError(t, original.SpillTo(spillPath))
	original.Stop()

	restored := newClusterAttentionIndex(meta, func() time.Time { return now })
	t.Cleanup(restored.Stop)
	restored.SetIgnoreRules(AttentionIgnoreRules{ClusterFindingTypes: []string{"restarts"}})
	require.NoError(t, restored.RestoreFrom(spillPath))
	require.Empty(t, restored.Snapshot())
}

func TestClusterAttentionIndexRefiltersRestoredRowsWhenIgnoreRulesChange(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	meta := ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}
	record := attentionSourceRecord{
		Ref: attentionTestRef("Pod", "payments", "checkout-0"), Source: attentionSourcePod,
		Status: "Running", StatusPresentation: "ready", Restarts: 2,
		AgeTimestamp: now.Add(-time.Hour).UnixMilli(),
	}
	original := newClusterAttentionIndex(meta, func() time.Time { return now })
	original.UpsertSource("pods", record)
	spillPath := t.TempDir() + "/attention.spill"
	require.NoError(t, original.SpillTo(spillPath))
	original.Stop()

	restored := newClusterAttentionIndex(meta, func() time.Time { return now })
	t.Cleanup(restored.Stop)
	require.NoError(t, restored.RestoreFrom(spillPath))
	require.Len(t, restored.Snapshot(), 1)

	restored.SetIgnoreRules(AttentionIgnoreRules{ClusterFindingTypes: []string{"restarts"}})

	require.Empty(t, restored.Snapshot())
}
