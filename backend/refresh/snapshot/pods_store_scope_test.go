package snapshot

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/testsupport"
)

// Ingested pod rows must remain scoped by node, complete owner identity and namespace.
func TestPodBuilderIngestedScopesPreserveObjectAndOwnerIdentity(t *testing.T) {
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

	storeBuilder := newTestPodBuilder(t, meta, testsupport.NewPodLister(t, pods...), rsLister, nil)
	scopes := map[string][]string{
		"node:node-1": {"prod/orders-7d9c8b6f5-abcde", "staging/orders-7d9c8b6f5-other"},
		"workload:prod:apps:v1:Deployment:orders":           {"prod/orders-7d9c8b6f5-abcde"},
		"workload:prod:apps:v1:ReplicaSet:orders-7d9c8b6f5": {"prod/orders-7d9c8b6f5-abcde"},
		"object:prod::v1:Pod:lonely":                        {"prod/lonely"},
		"namespace:prod":                                    {"prod/orders-7d9c8b6f5-abcde", "prod/lonely"},
	}
	for scope, want := range scopes {
		t.Run(scope, func(t *testing.T) {
			ctx := WithClusterMeta(context.Background(), meta)
			snapshot, err := storeBuilder.Build(ctx, scope)
			require.NoError(t, err)
			var got []string
			for _, row := range snapshot.Payload.(PodSnapshot).Rows {
				require.Equal(t, meta.ClusterID, row.Ref.ClusterID)
				require.Empty(t, row.Ref.Group)
				require.Equal(t, "v1", row.Ref.Version)
				require.Equal(t, "Pod", row.Ref.Kind)
				got = append(got, row.Ref.Namespace+"/"+row.Ref.Name)
			}
			require.ElementsMatch(t, want, got)
		})
	}

	t.Run("workload scope is namespace bounded", func(t *testing.T) {
		ctx := WithClusterMeta(context.Background(), meta)
		storeSnap, err := storeBuilder.Build(ctx, "workload:prod:apps:v1:Deployment:orders")
		require.NoError(t, err)

		storeRows := storeSnap.Payload.(PodSnapshot).Rows
		require.Len(t, storeRows, 1)
		require.Equal(t, "prod", storeRows[0].Ref.Namespace)
		require.Equal(t, "orders-7d9c8b6f5-abcde", storeRows[0].Ref.Name)
	})

	t.Run("object scope is full-identity and namespace bounded", func(t *testing.T) {
		ctx := WithClusterMeta(context.Background(), meta)
		storeSnap, err := storeBuilder.Build(ctx, "object:prod::v1:Pod:lonely")
		require.NoError(t, err)

		storeRows := storeSnap.Payload.(PodSnapshot).Rows
		require.Len(t, storeRows, 1)
		require.Equal(t, "prod", storeRows[0].Ref.Namespace)
		require.Equal(t, "lonely", storeRows[0].Ref.Name)

		_, err = storeBuilder.Build(ctx, "object:prod::v1:Deployment:lonely")
		require.ErrorContains(t, err, "unsupported object scope")
	})
}
