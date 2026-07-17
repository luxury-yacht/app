package snapshot

import (
	"testing"
	"time"

	"github.com/luxury-yacht/app/backend/objectcatalog"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestAttentionRecordFromBundleUsesCatalogIdentityAndTypedSummary(t *testing.T) {
	bundle := ingest.Bundle{
		Table: PodSummary{
			ClusterMeta: ClusterMeta{ClusterID: "cluster-a", ClusterName: "A"},
			Name:        "checkout-0", Namespace: "payments", Status: "CrashLoopBackOff",
			StatusPresentation: "error", StatusReason: "CrashLoopBackOff", Restarts: 4,
			AgeTimestamp: 1234,
		},
		Catalog: objectcatalog.Summary{
			ClusterID: "cluster-a", ClusterName: "A", Group: "", Version: "v1",
			Resource: "pods", Kind: "Pod", Namespace: "payments", Name: "checkout-0", UID: "pod-uid",
		},
	}

	record, ok := attentionRecordFromBundle(attentionSourcePod, bundle)
	require.True(t, ok)
	require.Equal(t, attentionTestRef("Pod", "payments", "checkout-0").ClusterID, record.Ref.ClusterID)
	require.Equal(t, "pod-uid", record.Ref.UID)
	require.Equal(t, "CrashLoopBackOff", record.Status)
	require.Equal(t, int32(4), record.Restarts)
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
}
