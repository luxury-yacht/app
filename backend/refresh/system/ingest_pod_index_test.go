package system

import (
	"testing"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/snapshot"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	kubernetesfake "k8s.io/client-go/kubernetes/fake"
	"k8s.io/utils/ptr"
)

// TestRegisterPodReflectorIndexesPodsByOwnerKey proves the pod store the system
// registers serves the owner-key index the all-namespaces workload view and the
// owner heals read: a Deployment's pod is reachable by the Deployment's owner key,
// and a standalone pod is reachable by none.
func TestRegisterPodReflectorIndexesPodsByOwnerKey(t *testing.T) {
	meta := snapshot.ClusterMeta{ClusterID: "cluster-a"}
	mgr := ingest.NewIngestManager(streamrows.ClusterMeta{ClusterID: "cluster-a"}, kubernetesfake.NewClientset(), nil, nil)
	rsOwner := func(_, name string) (metav1.OwnerReference, bool) {
		if name != "web-7d9c8b6f5" {
			return metav1.OwnerReference{}, false
		}
		return metav1.OwnerReference{APIVersion: "apps/v1", Kind: "Deployment", Name: "web", Controller: ptr.To(true)}, true
	}
	registerPodReflector(mgr, meta, rsOwner, nil)
	store := mgr.StoreFor(snapshot.PodGVR)
	require.NotNil(t, store)

	owned := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{
		Namespace: "team-a",
		Name:      "web-7d9c8b6f5-abcde",
		OwnerReferences: []metav1.OwnerReference{{
			APIVersion: "apps/v1", Kind: "ReplicaSet", Name: "web-7d9c8b6f5", Controller: ptr.To(true),
		}},
	}}
	standalone := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Namespace: "team-a", Name: "debug"}}
	require.NoError(t, store.Add(owned))
	require.NoError(t, store.Add(standalone))

	rows := mgr.RowsByIndex(snapshot.PodGVR, snapshot.PodOwnerKeyIndexName, []string{
		snapshot.WorkloadOwnerKey("Deployment", "team-a", "web"),
	})
	require.Len(t, rows, 1)
	require.Equal(t, "web-7d9c8b6f5-abcde", rows[0].(ingest.Bundle).Table.(snapshot.PodSummary).Ref.Name)
	require.Empty(t, mgr.RowsByIndex(snapshot.PodGVR, snapshot.PodOwnerKeyIndexName, []string{
		snapshot.WorkloadOwnerKey("", "team-a", "debug"),
	}))
}
