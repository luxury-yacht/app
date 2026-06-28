package snapshot

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	podres "github.com/luxury-yacht/app/backend/resources/pods"
	"github.com/luxury-yacht/app/backend/testsupport"
)

// TestPodBuilderStoreServedScopesMatchListPath proves the store-served node and
// workload scopes (production, no typed lister) return rows byte-identical to the
// typed-lister list path. The store builder is fed the SAME zeroed-metrics PodSummary
// rows the pod reflector projects; the list builder reads the typed lister. Both serve
// the same scope and must produce identical rows.
func TestPodBuilderStoreServedScopesMatchListPath(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c-1", ClusterName: "prod"}
	ptr := func(b bool) *bool { return &b }

	rs := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Namespace: "prod",
			Name:      "orders-7d9c8b6f5",
			OwnerReferences: []metav1.OwnerReference{
				{APIVersion: "apps/v1", Kind: "Deployment", Name: "orders", Controller: ptr(true)},
			},
		},
	}
	podOnNode := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Namespace:       "prod",
			Name:            "orders-7d9c8b6f5-abcde",
			ResourceVersion: "21",
			OwnerReferences: []metav1.OwnerReference{
				{APIVersion: "apps/v1", Kind: "ReplicaSet", Name: "orders-7d9c8b6f5", Controller: ptr(true)},
			},
		},
		Spec:   corev1.PodSpec{NodeName: "node-1", Containers: []corev1.Container{{Name: "c"}}},
		Status: corev1.PodStatus{Phase: corev1.PodRunning},
	}
	podOtherNode := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{Namespace: "prod", Name: "lonely", ResourceVersion: "9"},
		Spec:       corev1.PodSpec{NodeName: "node-2", Containers: []corev1.Container{{Name: "c"}}},
		Status:     corev1.PodStatus{Phase: corev1.PodRunning},
	}
	otherNamespaceRS := rs.DeepCopy()
	otherNamespaceRS.Namespace = "staging"
	otherNamespacePod := podOnNode.DeepCopy()
	otherNamespacePod.Namespace = "staging"
	otherNamespacePod.Name = "orders-7d9c8b6f5-other"
	otherNamespacePod.ResourceVersion = "22"
	pods := []*corev1.Pod{podOnNode, podOtherNode, otherNamespacePod}
	rsLister := testsupport.NewReplicaSetLister(t, rs, otherNamespaceRS)

	// List builder: typed lister path (unit-test path).
	listBuilder := &PodBuilder{
		podLister: testsupport.NewPodLister(t, pods...),
		rsLister:  rsLister,
		metrics:   fakePodMetricsProvider{},
		projCache: newPodProjectionCache(),
	}

	// Store builder: production path. Feed the maintained store the SAME zeroed-metrics
	// PodSummary rows the pod reflector projects (Sink carries the Table half).
	maintained := newTypedMaintainedStore(meta, podQuerypageSchema(), podTableQueryAdapter())
	streamMeta := meta // ClusterMeta is a type alias of streamrows.ClusterMeta
	sink := maintained.Sink()
	for _, pod := range pods {
		sink.Upsert(podres.BuildStreamSummary(streamMeta, pod, 0, 0, rsLister))
	}
	storeBuilder := &PodBuilder{
		metrics:    fakePodMetricsProvider{},
		maintained: maintained,
	}

	scopes := []string{
		"node:node-1",
		"workload:prod:apps:v1:Deployment:orders",
		"namespace:prod",
	}
	for _, scope := range scopes {
		t.Run(scope, func(t *testing.T) {
			ctx := WithClusterMeta(context.Background(), meta)
			listSnap, err := listBuilder.Build(ctx, scope)
			require.NoError(t, err)
			storeSnap, err := storeBuilder.Build(ctx, scope)
			require.NoError(t, err)

			listRows := listSnap.Payload.(PodSnapshot).Rows
			storeRows := storeSnap.Payload.(PodSnapshot).Rows
			require.ElementsMatch(t, listRows, storeRows, "store-served rows must match list-path rows for scope %s", scope)
		})
	}

	t.Run("workload scope is namespace bounded", func(t *testing.T) {
		ctx := WithClusterMeta(context.Background(), meta)
		storeSnap, err := storeBuilder.Build(ctx, "workload:prod:apps:v1:Deployment:orders")
		require.NoError(t, err)

		storeRows := storeSnap.Payload.(PodSnapshot).Rows
		require.Len(t, storeRows, 1)
		require.Equal(t, "prod", storeRows[0].Namespace)
		require.Equal(t, "orders-7d9c8b6f5-abcde", storeRows[0].Name)
	})
}
