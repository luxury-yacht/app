package snapshot

import (
	"testing"
	"time"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/listers/apps/v1"
	"k8s.io/client-go/tools/cache"

	"github.com/stretchr/testify/require"
)

func TestBuildPodSummaryResolvesDeploymentOwner(t *testing.T) {
	rs := &appsv1.ReplicaSet{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web-abc",
			Namespace: "default",
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "Deployment",
				Name:       "web",
				Controller: ptrBool(true),
			}},
		},
	}
	indexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{
		cache.NamespaceIndex: cache.MetaNamespaceIndexFunc,
	})
	require.NoError(t, indexer.Add(rs))
	rsLister := v1.NewReplicaSetLister(indexer)

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "pod-1",
			Namespace: "default",
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "ReplicaSet",
				Name:       "web-abc",
				Controller: ptrBool(true),
			}},
		},
	}

	summary := BuildPodSummary(ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}, pod, nil, rsLister)
	require.Equal(t, "Deployment", summary.OwnerKind)
	require.Equal(t, "web", summary.OwnerName)
}

func TestBuildWorkloadSummaryDeployment(t *testing.T) {
	deployment := &appsv1.Deployment{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web",
			Namespace: "default",
		},
		Spec: appsv1.DeploymentSpec{
			Replicas: ptrInt32(3),
		},
		Status: appsv1.DeploymentStatus{
			ReadyReplicas: 2,
		},
	}

	pod := &corev1.Pod{
		ObjectMeta: metav1.ObjectMeta{
			Name:      "web-abc",
			Namespace: "default",
			OwnerReferences: []metav1.OwnerReference{{
				Kind:       "ReplicaSet",
				Name:       "web-abc",
				Controller: ptrBool(true),
			}},
		},
		Status: corev1.PodStatus{Phase: corev1.PodRunning},
	}

	summary, err := BuildWorkloadSummary(ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}, deployment, []*corev1.Pod{pod}, nil)
	require.NoError(t, err)
	require.Equal(t, "Deployment", summary.Kind)
	require.Equal(t, "web", summary.Name)
	require.Equal(t, "default", summary.Namespace)
	require.Equal(t, "c1", summary.ClusterID)
}

func TestBuildNodeSummary(t *testing.T) {
	node := &corev1.Node{
		ObjectMeta: metav1.ObjectMeta{
			Name: "node-1",
		},
		Status: corev1.NodeStatus{
			Capacity: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("4"),
				corev1.ResourceMemory: resource.MustParse("8Gi"),
				corev1.ResourcePods:   resource.MustParse("110"),
			},
			Allocatable: corev1.ResourceList{
				corev1.ResourceCPU:    resource.MustParse("4"),
				corev1.ResourceMemory: resource.MustParse("8Gi"),
				corev1.ResourcePods:   resource.MustParse("110"),
			},
		},
	}

	summary, err := BuildNodeSummary(ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}, node, nil, nil)
	require.NoError(t, err)
	require.Equal(t, "node-1", summary.Name)
	require.Equal(t, "c1", summary.ClusterID)
}

func TestBuildNamespaceSummary(t *testing.T) {
	ns := &corev1.Namespace{
		ObjectMeta: metav1.ObjectMeta{
			Name:              "default",
			ResourceVersion:   "7",
			CreationTimestamp: metav1.NewTime(time.Unix(123, 0)),
		},
		Status: corev1.NamespaceStatus{
			Phase: corev1.NamespaceActive,
		},
	}

	summary := BuildNamespaceSummary(ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}, ns, true, false)
	require.Equal(t, "default", summary.Name)
	require.Equal(t, "Active", summary.Phase)
	require.Equal(t, "7", summary.ResourceVersion)
	require.Equal(t, int64(123), summary.CreationUnix)
	require.True(t, summary.HasWorkloads)
	require.False(t, summary.WorkloadsUnknown)
}

func ptrBool(value bool) *bool {
	return &value
}

func ptrInt32(value int32) *int32 {
	return &value
}
