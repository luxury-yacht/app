package endpointslice

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes/fake"
)

func TestDetailTargetRetainsSourceIdentity(t *testing.T) {
	for _, tt := range []struct {
		name, apiVersion, group, version, linkField string
	}{
		{"core target", "v1", "", "v1", "ref"},
		{"custom target sharing a builtin kind", "custom.example.com/v2", "custom.example.com", "v2", "ref"},
		{"unresolved target", "", "", "", "display"},
		{"malformed target", "custom.example.com/v2/extra", "", "", "display"},
	} {
		t.Run(tt.name, func(t *testing.T) {
			slice := &discoveryv1.EndpointSlice{
				ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "slice-ns"},
				Endpoints: []discoveryv1.Endpoint{{
					Addresses: []string{"10.0.0.1"},
					TargetRef: &corev1.ObjectReference{
						APIVersion: tt.apiVersion, Kind: "Pod", Name: "target", Namespace: "target-ns", UID: "target-uid",
					},
				}},
			}
			service := NewService(common.Dependencies{ClusterID: "Cluster-A", KubernetesClient: fake.NewClientset(slice)})
			details, err := service.EndpointSlice(context.Background(), "slice-ns", "api")
			require.NoError(t, err)
			require.Len(t, details.ReadyAddresses, 1)
			payload, err := json.Marshal(details.ReadyAddresses[0].TargetRef)
			require.NoError(t, err)
			var link map[string]map[string]any
			require.NoError(t, json.Unmarshal(payload, &link), "targetRef must carry canonical identity, not a Kind/name string")
			ref := link[tt.linkField]
			require.NotNil(t, ref)
			require.Equal(t, "Cluster-A", ref["clusterId"])
			require.Equal(t, "Pod", ref["kind"])
			require.Equal(t, "target", ref["name"])
			require.Equal(t, "target-ns", ref["namespace"])
			require.Equal(t, "target-uid", ref["uid"])
			if tt.linkField == "ref" {
				require.Equal(t, tt.group, ref["group"])
				require.Equal(t, tt.version, ref["version"])
			}
		})
	}
}
