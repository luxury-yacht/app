/*
 * backend/resources/persistentvolume/details_test.go
 *
 * Tests for the PersistentVolume detail service (co-located with the kind).
 */

package persistentvolume_test

import (
	"context"
	"errors"
	"fmt"
	"testing"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/client-go/kubernetes/fake"
	cgotesting "k8s.io/client-go/testing"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/persistentvolume"
	"github.com/luxury-yacht/app/backend/testsupport"
)

type logEntry struct {
	level   string
	message string
}

type capturingLogger struct {
	entries []logEntry
}

func (l *capturingLogger) Debug(msg string, _ ...string) { l.entries = append(l.entries, logEntry{"DEBUG", msg}) }
func (l *capturingLogger) Info(msg string, _ ...string)  { l.entries = append(l.entries, logEntry{"INFO", msg}) }
func (l *capturingLogger) Warn(msg string, _ ...string)  { l.entries = append(l.entries, logEntry{"WARN", msg}) }
func (l *capturingLogger) Error(msg string, _ ...string) { l.entries = append(l.entries, logEntry{"ERROR", msg}) }

func newService(t testing.TB, client *fake.Clientset) *persistentvolume.Service {
	t.Helper()
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsContext(context.Background()),
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(applog.Noop),
	)
	return persistentvolume.NewService(deps)
}

func TestServicePersistentVolumeDetails(t *testing.T) {
	pv := testsupport.PersistentVolumeFixture("pv-standard", func(pv *corev1.PersistentVolume) {
		pv.Spec.ClaimRef = &corev1.ObjectReference{Namespace: "default", Name: "pvc-standard"}
	})

	client := fake.NewClientset(pv.DeepCopy())
	service := newService(t, client)

	detail, err := service.PersistentVolume("pv-standard")
	require.NoError(t, err)
	require.Equal(t, "PersistentVolume", detail.Kind)
	require.Equal(t, "pv-standard", detail.Name)
	require.Equal(t, string(corev1.VolumeBound), detail.StatusState)
	require.Equal(t, "ready", detail.StatusPresentation)
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

	client := fake.NewClientset(pv.DeepCopy())
	service := newService(t, client)

	detail, err := service.PersistentVolume("pv-csi")
	require.NoError(t, err)
	require.Equal(t, "PersistentVolume", detail.Kind)
	require.Equal(t, "Block", detail.VolumeMode)
	require.Equal(t, string(corev1.VolumeBound), detail.StatusState)
	require.Equal(t, "ready", detail.StatusPresentation)
	require.Equal(t, []string{"ReadWriteMany"}, detail.AccessModes)
	require.NotEmpty(t, detail.NodeAffinity)
	require.Len(t, detail.Conditions, 2)
	require.Equal(t, "CSI", detail.VolumeSource.Type)
	require.Equal(t, "example.csi/driver", detail.VolumeSource.Details["driver"])
}

func TestServicePersistentVolumesErrorWhenListFails(t *testing.T) {
	client := fake.NewClientset()
	client.PrependReactor("list", "persistentvolumes", func(action cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, fmt.Errorf("api down")
	})

	service := newService(t, client)

	_, err := service.PersistentVolumes()
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to list persistent volumes")
}

func TestPersistentVolumesRequireClient(t *testing.T) {
	service := persistentvolume.NewService(common.Dependencies{})

	_, err := service.PersistentVolumes()
	require.Error(t, err)
	require.Contains(t, err.Error(), "kubernetes client not initialized")
}

func TestPersistentVolumeLogsErrorOnFailure(t *testing.T) {
	logger := &capturingLogger{}
	client := fake.NewClientset()
	client.PrependReactor("get", "persistentvolumes", func(cgotesting.Action) (bool, runtime.Object, error) {
		return true, nil, errors.New("boom")
	})

	service := persistentvolume.NewService(common.Dependencies{
		Context:          context.Background(),
		Logger:           logger,
		KubernetesClient: client,
	})

	_, err := service.PersistentVolume("pv-one")
	require.Error(t, err)
	require.Contains(t, err.Error(), "failed to get persistent volume")

	require.NotEmpty(t, logger.entries)
	last := logger.entries[len(logger.entries)-1]
	require.Equal(t, "ERROR", last.level)
	require.Contains(t, last.message, "Failed to get persistent volume pv-one: boom")
}
