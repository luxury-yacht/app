package customresource

import (
	"encoding/json"
	"testing"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/stretchr/testify/require"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
)

// These cases protect the actual wire projection: the correct family's facts,
// source identity and status must reach both details and hydrated table rows.
func TestOperatorFactsReachDetailsAndRowsWithoutCredentials(t *testing.T) {
	for _, test := range []struct {
		group, kind, resource, field, status string
		spec, sourceStatus                   map[string]any
		path                                 []string
		want                                 any
	}{
		{"cert-manager.io", "Certificate", "certificates", "certManager", "Ready",
			map[string]any{"secretName": "shop-tls", "dnsNames": []any{"shop.example.com"}, "issuerRef": map[string]any{"kind": "ClusterIssuer", "name": "public"}},
			map[string]any{"notAfter": "2027-01-01T00:00:00Z", "conditions": []any{map[string]any{"type": "Ready", "status": "True"}}},
			[]string{"certificate", "notAfter"}, "2027-01-01T00:00:00Z"},
		{"external-secrets.io", "ExternalSecret", "externalsecrets", "externalSecrets", "Ready",
			map[string]any{"secretStoreRef": map[string]any{"kind": "ClusterSecretStore", "name": "vault"}, "target": map[string]any{"name": "shop-db", "template": map[string]any{"data": map[string]any{"password": "private-token"}}}, "refreshInterval": "1h"},
			map[string]any{"refreshTime": "2026-09-13T00:00:00Z", "conditions": []any{map[string]any{"type": "Ready", "status": "True"}}},
			[]string{"externalSecret", "targetName"}, "shop-db"},
		{"monitoring.coreos.com", "Prometheus", "prometheuses", "prometheus", "Paused",
			map[string]any{"paused": true, "replicas": int64(0), "remoteWrite": []any{map[string]any{"basicAuth": map[string]any{"password": "private-token"}}}},
			map[string]any{"availableReplicas": int64(0)},
			[]string{"instance", "replicas"}, float64(0)},
	} {
		t.Run(test.kind, func(t *testing.T) {
			object := &unstructured.Unstructured{Object: map[string]any{"apiVersion": test.group + "/v1beta1", "kind": test.kind, "metadata": map[string]any{"name": "shop", "namespace": "team-a"}, "spec": test.spec, "status": test.sourceStatus}}
			descriptor := NewDescriptor(test.group, "v1beta1", test.resource, test.kind, test.resource+"."+test.group)
			detail := BuildDetails("cluster-a", object, descriptor, resourcemodel.ResourceScopeNamespaced)
			row := BuildNamespaceStreamSummary(streamrows.ClusterMeta{ClusterID: "cluster-a"}, object, descriptor, "team-a")
			require.Equal(t, detail.Ref, row.Ref)
			require.Equal(t, "cluster-a", detail.Ref.ClusterID)
			require.Equal(t, "v1beta1", detail.Ref.Version)
			require.Equal(t, test.status, detail.Status)
			require.Equal(t, detail.Status, row.Status)
			encoded, err := json.Marshal(detail)
			require.NoError(t, err)
			require.NotContains(t, string(encoded), "private-token")
			var wire map[string]any
			require.NoError(t, json.Unmarshal(encoded, &wire))
			value, found, err := unstructured.NestedFieldNoCopy(wire, append([]string{test.field}, test.path...)...)
			require.NoError(t, err)
			require.True(t, found)
			require.Equal(t, test.want, value)
			encoded, err = json.Marshal(row)
			require.NoError(t, err)
			require.NotContains(t, string(encoded), "private-token")
			wire = nil
			require.NoError(t, json.Unmarshal(encoded, &wire))
			require.NotNil(t, wire[test.field], "hydrated rows must retain their family fields")
		})
	}
}

func TestCertificateRequestDenialAndUnknownReadinessAreNotHealthy(t *testing.T) {
	object := &unstructured.Unstructured{Object: map[string]any{"apiVersion": "cert-manager.io/v1", "kind": "CertificateRequest", "metadata": map[string]any{"name": "request", "namespace": "team-a"}}}
	descriptor := NewDescriptor("cert-manager.io", "v1", "certificaterequests", "CertificateRequest", "certificaterequests.cert-manager.io")
	for _, test := range []struct {
		conditions   []any
		presentation string
	}{
		{[]any{map[string]any{"type": "Ready", "status": "True"}, map[string]any{"type": "Denied", "status": "True"}}, "error"},
		{[]any{map[string]any{"type": "Ready", "status": "Unknown"}}, "unknown"},
	} {
		require.NoError(t, unstructured.SetNestedSlice(object.Object, test.conditions, "status", "conditions"))
		detail := BuildDetails("a", object, descriptor, resourcemodel.ResourceScopeNamespaced)
		require.Equal(t, test.presentation, detail.StatusPresentation)
		if test.presentation == "unknown" {
			row := BuildNamespaceStreamSummary(streamrows.ClusterMeta{ClusterID: "a"}, object, descriptor, "team-a")
			require.Nil(t, row.Ready, "Unknown readiness must not be serialized as false")
		}
	}
}
