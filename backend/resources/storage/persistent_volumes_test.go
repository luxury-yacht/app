/*
 * backend/resources/storage/persistent_volumes_test.go
 *
 * Tests for PersistentVolume resource handlers.
 * - Covers PersistentVolume resource handlers behavior and edge cases.
 */

package storage

import (
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime"
	clientgofake "k8s.io/client-go/kubernetes/fake"
	k8stesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/testsupport"
)

func TestServicePersistentVolumeDetails(t *testing.T) {
	pv := testsupport.PersistentVolumeFixture("pv-standard", func(pv *corev1.PersistentVolume) {
		pv.Spec.ClaimRef = &corev1.ObjectReference{Namespace: "default", Name: "pvc-standard"}
	})

	client := clientgofake.NewClientset(pv.DeepCopy())
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

	client := clientgofake.NewClientset(pv.DeepCopy())
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

func TestServicePersistentVolumesErrorWhenListFails(t *testing.T) {
	client := clientgofake.NewClientset()
	client.PrependReactor("list", "persistentvolumes", func(action k8stesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("api down")
	})

	service := newStorageService(t, client)

	_, err := service.PersistentVolumes()
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to list persistent volumes")
}
