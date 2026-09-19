/*
 * backend/resources/persistentvolumeclaim/details_test.go
 *
 * Tests for the PersistentVolumeClaim detail service (co-located with the kind).
 */

package persistentvolumeclaim_test

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"k8s.io/apimachinery/pkg/api/resource"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
	"k8s.io/utils/ptr"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/resources/persistentvolumeclaim"
	"github.com/luxury-yacht/app/backend/testsupport"
)

func newService(t testing.TB, client *fake.Clientset) *persistentvolumeclaim.Service {
	t.Helper()
	deps := testsupport.NewResourceDependencies(
		testsupport.WithDepsKubeClient(client),
		testsupport.WithDepsLogger(applog.Noop),
	)
	return persistentvolumeclaim.NewService(deps)
}

func TestServicePersistentVolumeClaimDetailsUsesSharedStatus(t *testing.T) {
	pvc := testsupport.PersistentVolumeClaimFixture("default", "data")
	client := fake.NewClientset(pvc.DeepCopy())
	service := newService(t, client)

	detail, err := service.PersistentVolumeClaim(context.Background(), "default", "data")
	require.NoError(t, err)
	require.Equal(t, "PersistentVolumeClaim", detail.Kind)
	require.Equal(t, string(corev1.ClaimBound), detail.Status)
	require.Equal(t, string(corev1.ClaimBound), detail.StatusState)
	require.Equal(t, "ready", detail.StatusPresentation)
}

func TestDataSourceRetainsGroupAndNamespace(t *testing.T) {
	for _, tt := range []struct {
		name, group, namespace, linkField string
		source                            *corev1.TypedLocalObjectReference
		sourceRef                         *corev1.TypedObjectReference
	}{
		{
			name: "local clone", namespace: "claims", linkField: "ref",
			source: &corev1.TypedLocalObjectReference{Kind: "PersistentVolumeClaim", Name: "original"},
		},
		{
			name: "cross namespace clone", namespace: "backups", linkField: "ref",
			sourceRef: &corev1.TypedObjectReference{Kind: "PersistentVolumeClaim", Name: "original", Namespace: ptr.To("backups")},
		},
		{
			name: "custom source sharing builtin kind", group: "custom.example.com", namespace: "backups", linkField: "display",
			sourceRef: &corev1.TypedObjectReference{APIGroup: ptr.To("custom.example.com"), Kind: "PersistentVolumeClaim", Name: "original", Namespace: ptr.To("backups")},
		},
		{
			name: "local source retains precedence", namespace: "claims", linkField: "ref",
			source:    &corev1.TypedLocalObjectReference{Kind: "PersistentVolumeClaim", Name: "original"},
			sourceRef: &corev1.TypedObjectReference{APIGroup: ptr.To("custom.example.com"), Kind: "Ignored", Name: "other", Namespace: ptr.To("backups")},
		},
	} {
		t.Run(tt.name, func(t *testing.T) {
			pvc := &corev1.PersistentVolumeClaim{
				ObjectMeta: metav1.ObjectMeta{Name: "clone", Namespace: "claims"},
				Spec:       corev1.PersistentVolumeClaimSpec{DataSource: tt.source, DataSourceRef: tt.sourceRef},
			}
			service := persistentvolumeclaim.NewService(common.Dependencies{ClusterID: "Cluster-A", KubernetesClient: fake.NewClientset(pvc)})
			details, err := service.PersistentVolumeClaim(context.Background(), "claims", "clone")
			require.NoError(t, err)
			payload, err := json.Marshal(details.DataSource)
			require.NoError(t, err)
			var link map[string]json.RawMessage
			require.NoError(t, json.Unmarshal(payload, &link))
			require.Contains(t, link, tt.linkField)
			var ref map[string]any
			require.NoError(t, json.Unmarshal(link[tt.linkField], &ref))
			require.Equal(t, "Cluster-A", ref["clusterId"])
			require.Equal(t, tt.group, ref["group"])
			require.Equal(t, "PersistentVolumeClaim", ref["kind"])
			require.Equal(t, "original", ref["name"])
			require.Equal(t, tt.namespace, ref["namespace"])
			if tt.linkField == "ref" {
				require.Equal(t, "v1", ref["version"])
			}
		})
	}
}

func TestCapacityFallbackMatchesListWhenStatusOmitsStorage(t *testing.T) {
	for _, tt := range []struct {
		name     string
		capacity corev1.ResourceList
		want     string
	}{
		{name: "no status", want: "1Gi"},
		{name: "empty status", capacity: corev1.ResourceList{}, want: "1Gi"},
		{name: "unrelated status resource", capacity: corev1.ResourceList{corev1.ResourceCPU: resource.MustParse("1")}, want: "1Gi"},
		{name: "reported storage wins", capacity: corev1.ResourceList{corev1.ResourceStorage: resource.MustParse("2Gi")}, want: "2Gi"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			pvc := persistentVolumeClaimWithPhase(corev1.ClaimPending)
			pvc.Status.Capacity = tt.capacity
			detail, err := newService(t, fake.NewClientset(pvc)).PersistentVolumeClaim(context.Background(), pvc.Namespace, pvc.Name)
			require.NoError(t, err)
			row := persistentvolumeclaim.BuildStreamSummary(streamrows.ClusterMeta{ClusterID: "cluster-a"}, pvc)
			require.Equal(t, tt.want, row.Capacity)
			require.Equal(t, row.Capacity, detail.Capacity)
		})
	}
}
