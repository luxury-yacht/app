package snapshot

import (
	"testing"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	v1 "k8s.io/client-go/listers/apps/v1"
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

func ptrBool(value bool) *bool {
	return &value
}

func ptrInt32(value int32) *int32 {
	return &value
}

// TestBuildClusterCRDSummaryPopulatesAllFields is a regression guard for
// the dual-path drift bug: the streaming/incremental update path used to
// emit CRD rows without StorageVersion / ExtraServedVersionCount, which
// caused the Version column in the cluster CRDs view to "disappear" for
// rows that received a streaming update. The fix was to make the full-
// snapshot builder delegate to BuildClusterCRDSummary so the two paths
// share one row constructor.
//
// **This test exists to catch future drift.** Any new field added to
// ClusterCRDEntry must be populated by BuildClusterCRDSummary; assert it
// here so a missing field surfaces as a test failure rather than an
// invisible production bug. See docs/plans/kind-only-objects.md.
func TestBuildClusterCRDSummaryPopulatesAllFields(t *testing.T) {
	crd := &apiextensionsv1.CustomResourceDefinition{
		ObjectMeta: metav1.ObjectMeta{
			Name: "dbinstances.rds.services.k8s.aws",
		},
		Spec: apiextensionsv1.CustomResourceDefinitionSpec{
			Group: "rds.services.k8s.aws",
			Scope: apiextensionsv1.NamespaceScoped,
			Names: apiextensionsv1.CustomResourceDefinitionNames{
				Plural: "dbinstances",
				Kind:   "DBInstance",
			},
			Versions: []apiextensionsv1.CustomResourceDefinitionVersion{
				{Name: "v1alpha1", Served: true, Storage: false},
				{Name: "v1beta1", Served: true, Storage: false},
				{Name: "v1", Served: true, Storage: true},
			},
		},
	}

	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster"}
	row := BuildClusterCRDSummary(meta, crd)

	require.Equal(t, "c1", row.ClusterID)
	require.Equal(t, "cluster", row.ClusterName)
	require.Equal(t, "CustomResourceDefinition", row.Kind)
	require.Equal(t, crd.Name, row.Name)
	require.Equal(t, "rds.services.k8s.aws", row.Group)
	require.Equal(t, "Namespaced", row.Scope)
	require.Equal(t, "CRD", row.TypeAlias)
	require.Contains(t, row.Details, "v1*", "Details should mark storage version with *")
	// The two fields that the streaming path used to drop. Asserting them
	// explicitly catches future drift if a new field is added without
	// being plumbed here.
	require.Equal(t, "v1", row.StorageVersion)
	require.Equal(t, 2, row.ExtraServedVersionCount)
}

// TestBuildClusterCRDSummaryNilCRDIsSafe ensures the streaming path
// doesn't panic on a nil CRD (which can happen briefly during cache
// warmup or delete events).
func TestBuildClusterCRDSummaryNilCRDIsSafe(t *testing.T) {
	row := BuildClusterCRDSummary(ClusterMeta{ClusterID: "c1"}, nil)
	require.Equal(t, "c1", row.ClusterID)
	require.Equal(t, "CustomResourceDefinition", row.Kind)
	require.Empty(t, row.StorageVersion)
	require.Equal(t, 0, row.ExtraServedVersionCount)
}
