package statefulset_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	cgofake "k8s.io/client-go/kubernetes/fake"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/statefulset"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func newDeps(t testing.TB, client *cgofake.Clientset) common.Dependencies {
	t.Helper()
	return testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(applog.Noop),
		testsupport.WithDepsEnsureClient(func(string) error { return nil }),
	)
}

func TestStatefulSetServiceReturnsDetail(t *testing.T) {
	ss := testsupport.StatefulSetFixture("default", "db")
	partition := int32(1)
	maxUnavailable := intstr.FromInt(1)
	storageClass := "fast"

	ss.Spec.PodManagementPolicy = appsv1.ParallelPodManagement
	ss.Spec.MinReadySeconds = 15
	ss.Spec.UpdateStrategy = appsv1.StatefulSetUpdateStrategy{
		Type: appsv1.RollingUpdateStatefulSetStrategyType,
		RollingUpdate: &appsv1.RollingUpdateStatefulSetStrategy{
			Partition:      &partition,
			MaxUnavailable: &maxUnavailable,
		},
	}
	ss.Spec.PersistentVolumeClaimRetentionPolicy = &appsv1.StatefulSetPersistentVolumeClaimRetentionPolicy{
		WhenDeleted: appsv1.DeletePersistentVolumeClaimRetentionPolicyType,
		WhenScaled:  appsv1.RetainPersistentVolumeClaimRetentionPolicyType,
	}
	ss.Spec.VolumeClaimTemplates = []corev1.PersistentVolumeClaim{{
		ObjectMeta: metav1.ObjectMeta{Name: "data"},
		Spec: corev1.PersistentVolumeClaimSpec{
			StorageClassName: &storageClass,
			Resources: corev1.VolumeResourceRequirements{
				Requests: corev1.ResourceList{
					corev1.ResourceStorage: resource.MustParse("10Gi"),
				},
			},
		},
	}}
	ss.Status.Conditions = []appsv1.StatefulSetCondition{{
		Type:   appsv1.StatefulSetConditionType("Ready"),
		Status: corev1.ConditionTrue,
		Reason: "AllReplicasReady",
	}}
	// Distinct UpToDate/Available so the facts projection is verified per-field.
	ss.Status.UpdatedReplicas = 1
	ss.Status.AvailableReplicas = 3

	podA := testsupport.PodFixture(
		"default",
		"db-0",
		testsupport.PodWithOwner("StatefulSet", ss.Name, true),
		testsupport.PodWithLabels(ss.Spec.Selector.MatchLabels),
	)
	podA.Spec.NodeName = "node-a"
	podA.Status.ContainerStatuses = []corev1.ContainerStatus{{
		Name:         "app",
		Ready:        true,
		RestartCount: 1,
	}}

	podB := testsupport.PodFixture(
		"default",
		"db-1",
		testsupport.PodWithOwner("StatefulSet", ss.Name, true),
		testsupport.PodWithLabels(ss.Spec.Selector.MatchLabels),
	)
	podB.Spec.NodeName = "node-b"
	podB.Status.ContainerStatuses = []corev1.ContainerStatus{{
		Name:         "app",
		Ready:        true,
		RestartCount: 0,
	}}

	client := cgofake.NewClientset(ss.DeepCopy(), podA.DeepCopy(), podB.DeepCopy())
	deps := newDeps(t, client)

	service := statefulset.NewService(deps)
	detail, err := service.StatefulSet("default", "db")
	require.NoError(t, err)
	require.Equal(t, "StatefulSet", detail.Kind)
	require.Equal(t, "db", detail.Name)
	require.Len(t, detail.Pods, 2)
	require.Equal(t, "2/2", detail.Replicas)
	require.Equal(t, "2/2", detail.Ready)
	require.Equal(t, int32(1), detail.UpToDate)
	require.Equal(t, int32(3), detail.Available)
	require.Equal(t, int32(2), detail.DesiredReplicas)
	require.Equal(t, "Parallel", detail.PodManagementPolicy)
	require.Equal(t, "RollingUpdate", detail.UpdateStrategy)
	require.Equal(t, "1", detail.MaxUnavailable)
	require.NotNil(t, detail.Partition)
	require.Equal(t, int32(1), *detail.Partition)
	require.Equal(t, map[string]string{"whenDeleted": "Delete", "whenScaled": "Retain"}, detail.PersistentVolumeClaimRetentionPolicy)
	require.Len(t, detail.VolumeClaimTemplates, 1)
	require.Equal(t, "data", detail.VolumeClaimTemplates[0].Name)
	require.Equal(t, "fast", detail.VolumeClaimTemplates[0].StorageClass)
	require.Equal(t, "10Gi", detail.VolumeClaimTemplates[0].StorageRequest)
	require.Contains(t, detail.Conditions, "Ready: True (AllReplicasReady)")
	require.Equal(t, "Ready: 2/2, Service: db-svc, 1 PVC template(s)", detail.Details)
	require.Equal(t, "db", detail.Name)
}
