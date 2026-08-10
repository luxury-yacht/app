package snapshot

import (
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/kind/objectmapnode"
	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/daemonset"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestAttentionRecordFromBundleUsesCatalogIdentityAndTypedSummary(t *testing.T) {
	bundle := ingest.Bundle{
		Table: PodSummary{Ref: resourcemodel.ResourceRef{ClusterID: "cluster-a", Namespace: "payments", Name: "checkout-0"},
			Status:             "CrashLoopBackOff",
			StatusPresentation: "error", StatusReason: "CrashLoopBackOff", Restarts: 4,
			AgeTimestamp: 1234,
		},
		Catalog: objectcatalog.Summary{Ref: resourcemodel.ResourceRef{ClusterID: "cluster-a", Group: "", Version: "v1", Kind: "Pod", Resource: "pods", Namespace: "payments", Name: "checkout-0", UID: "pod-uid"}},
	}

	record, ok := attentionRecordFromBundle(attentionSourcePod, bundle)
	require.True(t, ok)
	require.Equal(t, attentionTestRef("Pod", "payments", "checkout-0").ClusterID, record.Ref.ClusterID)
	require.Equal(t, "pod-uid", record.Ref.UID)
	require.Equal(t, "CrashLoopBackOff", record.Status)
	require.Equal(t, int32(4), record.Restarts)
}

func TestDeletingPodBlockedByFinalizerProjectsIntoAttentionCategory(t *testing.T) {
	now := time.Date(2026, time.August, 10, 12, 0, 0, 0, time.UTC)
	deletionTimestamp := metav1.NewTime(now.Add(-time.Minute))
	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "checkout-0",
			Namespace:         "payments",
			UID:               "pod-uid",
			CreationTimestamp: metav1.NewTime(now.Add(-10 * time.Minute)),
			DeletionTimestamp: &deletionTimestamp,
			Finalizers:        []string{"example.com/cleanup"},
		},
		Status: corev1.PodStatus{Phase: corev1.PodRunning},
	}

	raw, err := NewPodIngestProjector(
		ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"},
		PodOwnerSources{},
	)(pod)
	require.NoError(t, err)
	bundle, ok := raw.(ingest.Bundle)
	require.True(t, ok)

	catalog, ok := bundle.Catalog.(objectcatalog.Summary)
	require.True(t, ok)
	blocker, blocked := catalog.FinalizerBlocker()
	require.True(t, blocked)
	index := newClusterAttentionIndex(ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}, func() time.Time { return now })
	t.Cleanup(index.Stop)
	index.ReplaceFinalizerBlockers([]objectcatalog.FinalizerBlocker{blocker})
	rows := index.Snapshot()
	require.Len(t, rows, 1)
	require.Contains(t, rows[0].Causes, AttentionCause{
		Type:     "deletion-blocked-by-finalizer",
		Label:    "Deletion blocked by Finalizer",
		Message:  "Waiting for finalizer cleanup",
		Severity: AttentionSeverityWarning,
	})
	require.Contains(t, AttentionFindingTypes(), AttentionFindingTypeDefinition{
		ID:    "deletion-blocked-by-finalizer",
		Label: "Deletion blocked by Finalizer",
	})
}

func TestDaemonSetNoEligibleNodesProjectsConsistentlyIntoAttention(t *testing.T) {
	now := time.Date(2026, time.July, 16, 12, 0, 0, 0, time.UTC)
	meta := ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}
	daemonSet := &appsv1.DaemonSet{
		ObjectMeta: metav1.ObjectMeta{
			Name: "node-agent", Namespace: "monitoring", UID: "daemonset-uid",
			CreationTimestamp: metav1.NewTime(now.Add(-10 * time.Minute)),
		},
		Spec: appsv1.DaemonSetSpec{
			Template: corev1.PodTemplateSpec{Spec: corev1.PodSpec{Containers: []corev1.Container{{Name: "agent"}}}},
		},
	}

	raw, err := NewDaemonSetIngestProjector(meta)(daemonSet)
	require.NoError(t, err)
	bundle, ok := raw.(ingest.Bundle)
	require.True(t, ok)

	row, ok := bundle.Table.(WorkloadSummary)
	require.True(t, ok)
	require.Equal(t, "No eligible nodes", row.Status)
	require.Equal(t, "NoEligibleNodes", row.StatusReason)
	require.Equal(t, "warning", row.StatusPresentation)

	node, ok := bundle.ObjectMap.(objectmapnode.Node)
	require.True(t, ok)
	require.NotNil(t, node.Status)
	require.Equal(t, "No eligible nodes", node.Status.Label)
	require.Equal(t, "NoEligibleNodes", node.Status.Reason)
	require.Equal(t, "warning", node.Status.Presentation)

	record, ok := attentionRecordFromBundle(attentionSourceWorkload, bundle)
	require.True(t, ok)
	evaluation := evaluateAttentionSource(record, now)
	require.NotNil(t, evaluation.Finding)
	require.Equal(t, AttentionSeverityInfo, evaluation.Finding.Severity)
	require.Equal(t, []string{"No eligible nodes"}, attentionCauseMessages(evaluation.Finding.Causes))
	require.Equal(t, daemonset.Identity.Kind, evaluation.Finding.Ref.Kind)
	require.Equal(t, meta.ClusterID, evaluation.Finding.Ref.ClusterID)
}

func TestAttentionRecordFromEventUsesEventIdentityNotInvolvedObjectIdentity(t *testing.T) {
	observedAt := time.Date(2026, time.July, 16, 11, 0, 0, 0, time.UTC)
	event := &corev1.Event{
		ObjectMeta:     metav1.ObjectMeta{Name: "checkout.abc", Namespace: "payments", UID: "event-uid"},
		InvolvedObject: corev1.ObjectReference{APIVersion: "v1", Kind: "Pod", Namespace: "payments", Name: "checkout-0"},
		Type:           "Warning", Reason: "BackOff", Message: "Back-off restarting failed container",
		LastTimestamp: metav1.NewTime(observedAt),
	}

	record, ok := attentionRecordFromEvent(ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}, event)
	require.True(t, ok)
	require.Equal(t, "Event", record.Ref.Kind)
	require.Equal(t, "events", record.Ref.Resource)
	require.Equal(t, "checkout.abc", record.Ref.Name)
	require.Equal(t, "event-uid", record.Ref.UID)
	require.Equal(t, observedAt.UnixMilli(), record.AgeTimestamp)

	index := newClusterAttentionIndex(ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}, func() time.Time {
		return observedAt.Add(time.Hour)
	})
	t.Cleanup(index.Stop)
	index.UpsertSource("events", record)
	rows := index.Snapshot()
	require.Len(t, rows, 1)
	require.Equal(t, "payments", rows[0].Ref.Namespace)
}

func TestAttentionFindingForClusterScopedEventHasNoDisplayNamespace(t *testing.T) {
	observedAt := time.Date(2026, time.July, 16, 11, 0, 0, 0, time.UTC)
	event := &corev1.Event{
		ObjectMeta:     metav1.ObjectMeta{Name: "worker-a.not-ready", Namespace: "default", UID: "event-uid"},
		InvolvedObject: corev1.ObjectReference{APIVersion: "v1", Kind: "Node", Name: "worker-a"},
		Type:           "Warning", Reason: "NodeNotReady", Message: "Node is not ready",
		LastTimestamp: metav1.NewTime(observedAt),
	}

	record, ok := attentionRecordFromEvent(ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}, event)
	require.True(t, ok)
	require.Equal(t, "default", record.Ref.Namespace, "event identity must retain the Event object's namespace")

	index := newClusterAttentionIndex(ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"}, func() time.Time {
		return observedAt.Add(time.Hour)
	})
	t.Cleanup(index.Stop)
	index.UpsertSource("events", record)

	rows := index.Snapshot()
	require.Len(t, rows, 1)
	require.Equal(t, "default", rows[0].Ref.Namespace, "event identity must retain the Event object's namespace")
	require.Empty(t, rows[0].Namespace, "the cluster-scoped involved object has no display namespace")
}

func TestDeletingEventWithFinalizerAppearsWithoutWarningEventStatus(t *testing.T) {
	now := time.Date(2026, time.August, 10, 12, 0, 0, 0, time.UTC)
	deletingAt := metav1.NewTime(now.Add(-time.Minute))
	event := &corev1.Event{
		ObjectMeta: metav1.ObjectMeta{
			Name: "normal-event", Namespace: "default", UID: "event-uid",
			DeletionTimestamp: &deletingAt, Finalizers: []string{"example.com/cleanup"},
		},
		Type: "Normal", Reason: "Scheduled", Message: "Successfully assigned",
		LastTimestamp: metav1.NewTime(now.Add(-time.Hour)),
	}

	record, ok := attentionRecordFromEvent(ClusterMeta{ClusterID: "cluster-a"}, event)
	require.True(t, ok)
	evaluation := evaluateEventAttention(record, now)
	require.NotNil(t, evaluation.Finding)
	require.Equal(t, "Terminating", evaluation.Finding.Status)
	require.Equal(t, deletingAt.UnixMilli(), evaluation.Finding.AgeTimestamp)
	require.Equal(t, []string{"deletion-blocked-by-finalizer"}, attentionCauseTypes(evaluation.Finding.Causes))
}

func TestClusterAttentionDomainDelegatesOpenKindPermissionsToCatalog(t *testing.T) {
	registry := domain.New()
	index, err := RegisterClusterAttentionDomain(
		registry, nil, ClusterAttentionPermissions{}, ClusterMeta{ClusterID: "cluster-a"}, nil, ClusterAttentionOptions{},
	)
	require.NoError(t, err)
	t.Cleanup(index.Stop)
	config, exists := registry.Get(clusterAttentionDomainName)
	require.True(t, exists)
	require.False(t, config.RuntimePolicyExempt)
}
