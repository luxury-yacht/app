package storage

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	storagev1 "k8s.io/api/storage/v1"
	"k8s.io/apimachinery/pkg/runtime"
	kubefake "k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/testsupport"
)

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
