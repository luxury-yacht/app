package storage_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	storagev1 "k8s.io/api/storage/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime"
	kubefake "k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"
	"k8s.io/utils/ptr"

	"github.com/luxury-yacht/app/backend/resources/storage"
	"github.com/luxury-yacht/app/backend/testsupport"
)

type stubLogger struct{}

func (stubLogger) Debug(string, ...string) {}
func (stubLogger) Info(string, ...string)  {}
func (stubLogger) Warn(string, ...string)  {}
func (stubLogger) Error(string, ...string) {}

func TestServicePersistentVolumeDetails(t *testing.T) {
	pv := testsupport.PersistentVolumeFixture("pv-standard", func(pv *corev1.PersistentVolume) {
		pv.Spec.ClaimRef = &corev1.ObjectReference{Namespace: "default", Name: "pvc-standard"}
	})

	client := kubefake.NewClientset(pv.DeepCopy())
	service := newStorageService(t, client)

	detail, err := service.PersistentVolume("pv-standard")
	require.NoError(t, err)
	require.Equal(t, "PersistentVolume", detail.Kind)
	require.Equal(t, "pv-standard", detail.Name)
	require.Equal(t, "Filesystem", detail.VolumeMode)
	require.NotNil(t, detail.ClaimRef)
	require.Contains(t, detail.AccessModes, string(corev1.ReadWriteOnce))
}

func TestServicePersistentVolumeDetailsIncludesNodeAffinityAndConditions(t *testing.T) {
	blockMode := corev1.PersistentVolumeBlock
	pv := testsupport.PersistentVolumeFixture("pv-csi", func(pv *corev1.PersistentVolume) {
		pv.Spec.VolumeMode = &blockMode
		pv.Spec.AccessModes = []corev1.PersistentVolumeAccessMode{corev1.ReadWriteMany}
		pv.Spec.PersistentVolumeSource = corev1.PersistentVolumeSource{
			CSI: &corev1.CSIPersistentVolumeSource{
				Driver:       "example.csi/driver",
				VolumeHandle: "volume-123",
				ReadOnly:     true,
				FSType:       "ext4",
			},
		}
		pv.Spec.NodeAffinity = &corev1.VolumeNodeAffinity{
			Required: &corev1.NodeSelector{
				NodeSelectorTerms: []corev1.NodeSelectorTerm{{
					MatchExpressions: []corev1.NodeSelectorRequirement{{
						Key:      "topology.kubernetes.io/zone",
						Operator: corev1.NodeSelectorOpIn,
						Values:   []string{"us-east-1a"},
					}},
				}},
			},
		}
		pv.Status.Reason = "NodeAffinityFailed"
		pv.Status.Message = "No matching nodes"
	})

	client := kubefake.NewClientset(pv.DeepCopy())
	service := newStorageService(t, client)

	detail, err := service.PersistentVolume("pv-csi")
	require.NoError(t, err)
	require.Equal(t, "PersistentVolume", detail.Kind)
	require.Equal(t, "Block", detail.VolumeMode)
	require.Equal(t, []string{"ReadWriteMany"}, detail.AccessModes)
	require.NotEmpty(t, detail.NodeAffinity)
	require.Len(t, detail.Conditions, 2)
	require.Equal(t, "CSI", detail.VolumeSource.Type)
	require.Equal(t, "example.csi/driver", detail.VolumeSource.Details["driver"])
}

func TestServicePersistentVolumeClaimDetails(t *testing.T) {
	pvc := testsupport.PersistentVolumeClaimFixture("default", "pvc-standard")
	pvc.Spec.VolumeName = "pv-standard"

	pod := testsupport.PodFixture("default", "web-0")
	pod.Spec.Volumes = append(pod.Spec.Volumes, corev1.Volume{
		Name: "data",
		VolumeSource: corev1.VolumeSource{
			PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: "pvc-standard"},
		},
	})

	client := kubefake.NewClientset(pvc.DeepCopy(), pod.DeepCopy())
	service := newStorageService(t, client)

	detail, err := service.PersistentVolumeClaim("default", "pvc-standard")
	require.NoError(t, err)
	require.Equal(t, "PersistentVolumeClaim", detail.Kind)
	require.Equal(t, []string{"web-0"}, detail.MountedBy)
	require.Equal(t, "Filesystem", detail.VolumeMode)
	require.Contains(t, detail.Details, "Bound")
}

func TestServicePersistentVolumeClaimDetailsMultiplePods(t *testing.T) {
	pvc := testsupport.PersistentVolumeClaimFixture("default", "shared-data")

	podA := testsupport.PodFixture("default", "api-0")
	podA.Spec.Volumes = append(podA.Spec.Volumes, corev1.Volume{
		Name: "shared",
		VolumeSource: corev1.VolumeSource{
			PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: "shared-data"},
		},
	})

	podB := testsupport.PodFixture("default", "worker-0")
	podB.Spec.Volumes = append(podB.Spec.Volumes, corev1.Volume{
		Name: "shared",
		VolumeSource: corev1.VolumeSource{
			PersistentVolumeClaim: &corev1.PersistentVolumeClaimVolumeSource{ClaimName: "shared-data"},
		},
	})

	client := kubefake.NewClientset(pvc.DeepCopy(), podA.DeepCopy(), podB.DeepCopy())
	service := newStorageService(t, client)

	detail, err := service.PersistentVolumeClaim("default", "shared-data")
	require.NoError(t, err)
	require.ElementsMatch(t, []string{"api-0", "worker-0"}, detail.MountedBy)
	require.Contains(t, detail.Details, "2 pod(s)")
}

func TestServicePersistentVolumeClaimDetailsDataSourceFallback(t *testing.T) {
	pvc := testsupport.PersistentVolumeClaimFixture("default", "pvc-restore", func(pvc *corev1.PersistentVolumeClaim) {
		pvc.Status.Capacity = nil
		pvc.Spec.DataSourceRef = &corev1.TypedObjectReference{
			APIGroup: ptr.To("snapshot.storage.k8s.io"),
			Kind:     "VolumeSnapshot",
			Name:     "snapshot-1",
		}
		pvc.Spec.Selector = &metav1.LabelSelector{MatchLabels: map[string]string{"tier": "backend"}}
		pvc.Status.Conditions = []corev1.PersistentVolumeClaimCondition{{
			Type:   corev1.PersistentVolumeClaimResizing,
			Status: corev1.ConditionTrue,
			Reason: "Expanding",
		}}
	})

	client := kubefake.NewClientset(pvc.DeepCopy())
	client.PrependReactor("list", "pods", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("pods unavailable")
	})
	service := newStorageService(t, client)

	detail, err := service.PersistentVolumeClaim("default", "pvc-restore")
	require.NoError(t, err)
	require.NotNil(t, detail.DataSource)
	require.Equal(t, "VolumeSnapshot", detail.DataSource.Kind)
	require.Equal(t, "snapshot-1", detail.DataSource.Name)
	require.Equal(t, map[string]string{"tier": "backend"}, detail.Selector)
	require.Contains(t, detail.Details, "Bound")
	require.Len(t, detail.Conditions, 1)
}

func TestServiceStorageClassDetails(t *testing.T) {
	sc := testsupport.StorageClassFixture("standard")
	pv := testsupport.PersistentVolumeFixture("pv-standard", func(pv *corev1.PersistentVolume) {
		pv.Spec.StorageClassName = "standard"
	})

	client := kubefake.NewClientset(sc.DeepCopy(), pv.DeepCopy())
	service := newStorageService(t, client)

	detail, err := service.StorageClass("standard")
	require.NoError(t, err)
	require.Equal(t, "StorageClass", detail.Kind)
	require.True(t, detail.IsDefault)
	require.True(t, detail.AllowVolumeExpansion)
	require.Contains(t, detail.PersistentVolumes, "pv-standard")
}

func TestServiceStorageClassDetailsIncludesTopologies(t *testing.T) {
	topology := corev1.TopologySelectorTerm{
		MatchLabelExpressions: []corev1.TopologySelectorLabelRequirement{{
			Key:    "topology.kubernetes.io/zone",
			Values: []string{"us-east-1a", "us-east-1b"},
		}},
	}
	sc := testsupport.StorageClassFixture("zonal", func(sc *storagev1.StorageClass) {
		sc.AllowedTopologies = []corev1.TopologySelectorTerm{topology}
	})
	pv := testsupport.PersistentVolumeFixture("pv-zonal", func(pv *corev1.PersistentVolume) {
		pv.Spec.StorageClassName = "zonal"
	})

	client := kubefake.NewClientset(sc.DeepCopy(), pv.DeepCopy())
	service := newStorageService(t, client)

	detail, err := service.StorageClass("zonal")
	require.NoError(t, err)
	require.Len(t, detail.AllowedTopologies, 1)
	require.Contains(t, detail.Details, "PV(s)")
}

func TestServicePersistentVolumesErrorWhenListFails(t *testing.T) {
	client := kubefake.NewClientset()
	client.PrependReactor("list", "persistentvolumes", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("api down")
	})

	service := newStorageService(t, client)

	_, err := service.PersistentVolumes()
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to list persistent volumes")
}

func TestServicePersistentVolumeClaimsErrorWhenListFails(t *testing.T) {
	client := kubefake.NewClientset()
	client.PrependReactor("list", "persistentvolumeclaims", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("api down")
	})

	service := newStorageService(t, client)

	_, err := service.PersistentVolumeClaims("default")
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to list PVCs")
}

func TestServiceStorageClassDetailsHandlesPVListFailure(t *testing.T) {
	sc := testsupport.StorageClassFixture("slow")
	client := kubefake.NewClientset(sc.DeepCopy())
	client.PrependReactor("list", "persistentvolumes", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("pv list down")
	})

	service := newStorageService(t, client)

	detail, err := service.StorageClass("slow")
	require.NoError(t, err)
	require.NotNil(t, detail)
	require.Empty(t, detail.PersistentVolumes)
}

func TestServiceStorageClassesErrorWhenListFails(t *testing.T) {
	client := kubefake.NewClientset()
	client.PrependReactor("list", "storageclasses", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("api down")
	})

	service := newStorageService(t, client)

	_, err := service.StorageClasses()
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to list storage classes")
}

func newStorageService(t testing.TB, client *kubefake.Clientset) *storage.Service {
	t.Helper()
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(stubLogger{}),
	)
	return storage.NewService(storage.Dependencies{Common: deps})
}
