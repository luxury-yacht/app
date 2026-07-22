/*
 * backend/resources/storageclass/details_test.go
 *
 * Tests for the StorageClass detail service (co-located with the kind).
 */

package storageclass_test

import (
	"context"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	storagev1 "k8s.io/api/storage/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/resources/storageclass"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func newService(t testing.TB, client *fake.Clientset) *storageclass.Service {
	t.Helper()
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(applog.Noop),
	)
	return storageclass.NewService(deps)
}

func TestServiceStorageClassDetails(t *testing.T) {
	sc := testsupport.StorageClassFixture("standard")
	pv := testsupport.PersistentVolumeFixture("pv-standard", func(pv *corev1.PersistentVolume) {
		pv.Spec.StorageClassName = "standard"
	})

	client := fake.NewClientset(sc.DeepCopy(), pv.DeepCopy())
	service := newService(t, client)

	detail, err := service.StorageClass("standard")
	require.NoError(t, err)
	require.Equal(t, "StorageClass", detail.Kind)
	require.Equal(t, "Default", detail.Status)
	require.Equal(t, "true", detail.StatusState)
	require.Equal(t, "ready", detail.StatusPresentation)
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

	client := fake.NewClientset(sc.DeepCopy(), pv.DeepCopy())
	service := newService(t, client)

	detail, err := service.StorageClass("zonal")
	require.NoError(t, err)
	require.Len(t, detail.AllowedTopologies, 1)
	require.Contains(t, detail.Details, "PV(s)")
}

func TestServiceStorageClassDetailsHandlesPVListFailure(t *testing.T) {
	sc := testsupport.StorageClassFixture("slow")
	client := fake.NewClientset(sc.DeepCopy())
	client.PrependReactor("list", "persistentvolumes", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("pv list down")
	})

	service := newService(t, client)

	detail, err := service.StorageClass("slow")
	require.NoError(t, err)
	require.NotNil(t, detail)
	require.Empty(t, detail.PersistentVolumes)
}
