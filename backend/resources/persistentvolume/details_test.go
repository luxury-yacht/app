/*
 * backend/resources/persistentvolume/details_test.go
 *
 * Tests for the PersistentVolume detail service (co-located with the kind).
 */

package persistentvolume_test

import (
	"context"
	"errors"
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

func (l *capturingLogger) Debug(msg string, _ ...string) {
	l.entries = append(l.entries, logEntry{"DEBUG", msg})
}
func (l *capturingLogger) Info(msg string, _ ...string) {
	l.entries = append(l.entries, logEntry{"INFO", msg})
}
func (l *capturingLogger) Warn(msg string, _ ...string) {
	l.entries = append(l.entries, logEntry{"WARN", msg})
}
func (l *capturingLogger) Error(msg string, _ ...string) {
	l.entries = append(l.entries, logEntry{"ERROR", msg})
}

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

func TestServicePersistentVolumeDetailsProjectsEveryVolumeSource(t *testing.T) {
	hostPathType := corev1.HostPathDirectory
	fsType := "ext4"
	readOnly := true
	tests := []struct {
		name        string
		source      corev1.PersistentVolumeSource
		wantType    string
		wantDetails map[string]string
	}{
		{
			name:        "host path",
			source:      corev1.PersistentVolumeSource{HostPath: &corev1.HostPathVolumeSource{Path: "/data", Type: &hostPathType}},
			wantType:    "HostPath",
			wantDetails: map[string]string{"path": "/data", "type": "Directory"},
		},
		{
			name:        "nfs",
			source:      corev1.PersistentVolumeSource{NFS: &corev1.NFSVolumeSource{Server: "nfs.internal", Path: "/exports", ReadOnly: true}},
			wantType:    "NFS",
			wantDetails: map[string]string{"server": "nfs.internal", "path": "/exports", "readOnly": "true"},
		},
		{
			name:        "csi",
			source:      corev1.PersistentVolumeSource{CSI: &corev1.CSIPersistentVolumeSource{Driver: "example.csi", VolumeHandle: "vol-1", ReadOnly: true, FSType: "xfs"}},
			wantType:    "CSI",
			wantDetails: map[string]string{"driver": "example.csi", "volumeHandle": "vol-1", "readOnly": "true", "fsType": "xfs"},
		},
		{
			name:        "aws elastic block store",
			source:      corev1.PersistentVolumeSource{AWSElasticBlockStore: &corev1.AWSElasticBlockStoreVolumeSource{VolumeID: "vol-aws", FSType: "ext4", Partition: 2, ReadOnly: true}},
			wantType:    "AWSElasticBlockStore",
			wantDetails: map[string]string{"volumeID": "vol-aws", "fsType": "ext4", "partition": "2", "readOnly": "true"},
		},
		{
			name:        "gce persistent disk",
			source:      corev1.PersistentVolumeSource{GCEPersistentDisk: &corev1.GCEPersistentDiskVolumeSource{PDName: "disk-gce", FSType: "ext4", Partition: 3, ReadOnly: true}},
			wantType:    "GCEPersistentDisk",
			wantDetails: map[string]string{"pdName": "disk-gce", "fsType": "ext4", "partition": "3", "readOnly": "true"},
		},
		{
			name:        "azure disk",
			source:      corev1.PersistentVolumeSource{AzureDisk: &corev1.AzureDiskVolumeSource{DiskName: "disk-azure", DataDiskURI: "https://example/disk", FSType: &fsType, ReadOnly: &readOnly}},
			wantType:    "AzureDisk",
			wantDetails: map[string]string{"diskName": "disk-azure", "diskURI": "https://example/disk", "fsType": "ext4", "readOnly": "true"},
		},
		{
			name:        "azure file",
			source:      corev1.PersistentVolumeSource{AzureFile: &corev1.AzureFilePersistentVolumeSource{SecretName: "azure-secret", ShareName: "share", ReadOnly: true}},
			wantType:    "AzureFile",
			wantDetails: map[string]string{"secretName": "azure-secret", "shareName": "share", "readOnly": "true"},
		},
		{
			name:        "fibre channel",
			source:      corev1.PersistentVolumeSource{FC: &corev1.FCVolumeSource{FSType: "ext4", ReadOnly: true}},
			wantType:    "FibreChannel",
			wantDetails: map[string]string{"fsType": "ext4", "readOnly": "true"},
		},
		{
			name:        "iscsi",
			source:      corev1.PersistentVolumeSource{ISCSI: &corev1.ISCSIPersistentVolumeSource{TargetPortal: "10.0.0.2:3260", IQN: "iqn.2026-01.example:disk", Lun: 4, FSType: "xfs", ReadOnly: true}},
			wantType:    "iSCSI",
			wantDetails: map[string]string{"targetPortal": "10.0.0.2:3260", "iqn": "iqn.2026-01.example:disk", "lun": "4", "fsType": "xfs", "readOnly": "true"},
		},
		{
			name:        "local",
			source:      corev1.PersistentVolumeSource{Local: &corev1.LocalVolumeSource{Path: "/mnt/disk", FSType: &fsType}},
			wantType:    "Local",
			wantDetails: map[string]string{"path": "/mnt/disk", "fsType": "ext4"},
		},
		{name: "unknown", source: corev1.PersistentVolumeSource{}, wantType: "Unknown", wantDetails: map[string]string{}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pv := testsupport.PersistentVolumeFixture("pv-source", func(pv *corev1.PersistentVolume) {
				pv.Spec.PersistentVolumeSource = tt.source
			})
			detail, err := newService(t, fake.NewClientset(pv)).PersistentVolume(pv.Name)
			require.NoError(t, err)
			require.Equal(t, tt.wantType, detail.VolumeSource.Type)
			require.Equal(t, tt.wantDetails, detail.VolumeSource.Details)
		})
	}
}

func TestServicePersistentVolumeDetailsPreservesOrderingDefaultsAndUnknownAccessMode(t *testing.T) {
	pv := testsupport.PersistentVolumeFixture("pv-defaults", func(pv *corev1.PersistentVolume) {
		pv.Spec.Capacity = nil
		pv.Spec.AccessModes = []corev1.PersistentVolumeAccessMode{
			corev1.ReadWriteOnce,
			corev1.ReadOnlyMany,
			corev1.ReadWriteMany,
			corev1.ReadWriteOncePod,
		}
		pv.Spec.VolumeMode = nil
		pv.Spec.ClaimRef = nil
		pv.Spec.MountOptions = []string{"noatime", "discard"}
		pv.Spec.PersistentVolumeSource = corev1.PersistentVolumeSource{}
		pv.Spec.NodeAffinity = &corev1.VolumeNodeAffinity{}
		pv.Status.Reason = ""
		pv.Status.Message = ""
	})

	detail, err := newService(t, fake.NewClientset(pv)).PersistentVolume(pv.Name)
	require.NoError(t, err)
	require.Empty(t, detail.Capacity)
	require.Equal(t, []string{"ReadWriteOnce", "ReadOnlyMany", "ReadWriteMany", "ReadWriteOncePod"}, detail.AccessModes)
	require.Equal(t, "Filesystem", detail.VolumeMode)
	require.Nil(t, detail.ClaimRef)
	require.Equal(t, []string{"noatime", "discard"}, detail.MountOptions)
	require.Nil(t, detail.NodeAffinity)
	require.Nil(t, detail.Conditions)
	require.Equal(t, "Bound, , RWO,ROX,RWX,ReadWriteOncePod, Claim: Available", detail.Details)
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
