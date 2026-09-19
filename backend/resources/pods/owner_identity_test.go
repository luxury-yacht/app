package pods

import (
	"context"
	"testing"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
	appslisters "k8s.io/client-go/listers/apps/v1"
	"k8s.io/client-go/tools/cache"
	"k8s.io/utils/ptr"
)

func TestPodOwnerCollapseRequiresBuiltinAPIVersion(t *testing.T) {
	for _, kind := range []string{"ReplicaSet", "Job"} {
		t.Run(kind, func(t *testing.T) {
			pod := corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "pod", Namespace: "ns", OwnerReferences: []metav1.OwnerReference{{
				APIVersion: "custom.example/v1", Kind: kind, Name: "owner", Controller: ptr.To(true),
			}}}}
			mapping := map[string]string{"owner": "deployment"}
			svc := NewService(common.Dependencies{ClusterID: "cluster-a"})
			detail := svc.buildPodDetailInfo(pod, nil, mapping)
			require.Equal(t, kind, detail.OwnerKind)
			require.Equal(t, "owner", detail.OwnerName)
			require.Equal(t, "custom.example/v1", detail.OwnerAPIVersion)
			ownerKind, ownerName, ownerAPI := ResolveOwner(pod, mapping)
			require.Equal(t, kind, ownerKind)
			require.Equal(t, "owner", ownerName)
			require.Equal(t, "custom.example/v1", ownerAPI)
			calls := 0
			row := buildPodRow(streamrows.ClusterMeta{ClusterID: "cluster-a"}, &pod, 0, 0, mapping,
				func(namespace, name string) (string, string, string, bool) {
					calls++
					return "batch/v1", "CronJob", "cron", true
				})
			require.Equal(t, kind, row.OwnerKind)
			require.Equal(t, "owner", row.OwnerName)
			require.Equal(t, "custom.example/v1", row.OwnerAPIVersion)
			require.Zero(t, calls, "a custom Job must not use the built-in Job lookup")
		})
	}
}

func TestReplicaSetCollapseRequiresBuiltinDeploymentParent(t *testing.T) {
	for _, apiVersion := range []string{"apps/v1", "custom.example/v1"} {
		t.Run(apiVersion, func(t *testing.T) {
			rs := &appsv1.ReplicaSet{ObjectMeta: metav1.ObjectMeta{Name: "rs", Namespace: "ns", OwnerReferences: []metav1.OwnerReference{{
				APIVersion: apiVersion, Kind: "Deployment", Name: "parent", Controller: ptr.To(true),
			}}}}
			svc := NewService(common.Dependencies{KubernetesClient: fake.NewClientset(rs)})
			mapping := svc.BuildReplicaSetToDeploymentMap(context.Background(), "ns")
			indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
			require.NoError(t, indexer.Add(rs))
			pod := &corev1.Pod{ObjectMeta: metav1.ObjectMeta{Name: "pod", Namespace: "ns", OwnerReferences: []metav1.OwnerReference{{
				APIVersion: "apps/v1", Kind: "ReplicaSet", Name: "rs", Controller: ptr.To(true),
			}}}}
			row := BuildStreamSummary(streamrows.ClusterMeta{ClusterID: "cluster-a"}, pod, 0, 0, appslisters.NewReplicaSetLister(indexer), nil)
			if apiVersion == "apps/v1" {
				require.Equal(t, "parent", mapping["rs"])
				require.Equal(t, "Deployment", row.OwnerKind)
				require.Equal(t, "parent", row.OwnerName)
			} else {
				require.Empty(t, mapping)
				require.Equal(t, "ReplicaSet", row.OwnerKind)
				require.Equal(t, "rs", row.OwnerName)
			}
			require.Equal(t, "apps/v1", row.OwnerAPIVersion)
		})
	}
}
