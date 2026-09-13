package certmanager

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/types"
)

func TestIssuanceChainPreservesSourceReferencesAndExcludesKeyMaterial(t *testing.T) {
	for _, test := range []struct {
		kind, group, ownerKind, ownerVersion string
		spec, status                         map[string]any
	}{
		{"CertificateRequest", "cert-manager.io", "Certificate", "cert-manager.io/v1beta1", map[string]any{"request": "private-csr", "isCA": true, "duration": "2h", "usages": []any{"server auth"}}, map[string]any{"failureTime": "2026-09-13T00:00:00Z"}},
		{"Order", "acme.cert-manager.io", "CertificateRequest", "cert-manager.io/v1", map[string]any{"request": "private-csr", "dnsNames": []any{"shop.example.com"}, "duration": "1h"}, map[string]any{"certificate": "private-certificate", "state": "invalid", "reason": "Rejected"}},
		{"Challenge", "acme.cert-manager.io", "Order", "acme.cert-manager.io/v1beta1", map[string]any{"key": "private-key", "token": "private-token", "dnsName": "shop.example.com", "type": "DNS-01", "wildcard": true}, map[string]any{"state": "pending", "presented": false, "processing": true}},
	} {
		t.Run(test.kind, func(t *testing.T) {
			test.spec["issuerRef"] = map[string]any{"kind": "ClusterIssuer", "name": "public"}
			object := &unstructured.Unstructured{Object: map[string]any{"apiVersion": test.group + "/v1", "kind": test.kind, "metadata": map[string]any{"name": "child", "namespace": "team-a"}, "spec": test.spec, "status": test.status}}
			object.SetOwnerReferences([]metav1.OwnerReference{{APIVersion: test.ownerVersion, Kind: test.ownerKind, Name: "parent", UID: types.UID("parent-uid")}, {APIVersion: "other.io/v1", Kind: test.ownerKind, Name: "collision"}})
			facts := BuildFacts("cluster-a", object)
			require.Len(t, facts.Owners, 1)
			require.Equal(t, "cluster-a", facts.Owners[0].Ref.ClusterID)
			require.Equal(t, "team-a", facts.Owners[0].Ref.Namespace)
			require.Equal(t, "parent-uid", facts.Owners[0].Ref.UID)
			require.Empty(t, facts.Issuer.Display.Namespace)
			require.Empty(t, facts.Issuer.Display.Version, "issuer version must be supplied by discovery, not copied from the child")
			if facts.Request != nil {
				require.True(t, facts.Request.IsCA)
				require.NotEmpty(t, facts.Request.FailureTime)
			}
			if facts.Order != nil {
				require.Equal(t, "invalid", facts.Order.State)
				require.Equal(t, []string{"shop.example.com"}, facts.Order.DNSNames)
			}
			if facts.Challenge != nil {
				require.False(t, *facts.Challenge.Presented)
				require.True(t, *facts.Challenge.Processing)
			}
			encoded, err := json.Marshal(facts)
			require.NoError(t, err)
			require.NotContains(t, string(encoded), "private-")
		})
	}
}

func TestIssuerAndCertificateFactsKeepConfigurationSeparateFromCredentials(t *testing.T) {
	issuer := &unstructured.Unstructured{Object: map[string]any{
		"apiVersion": "cert-manager.io/v1", "kind": "Issuer",
		"metadata": map[string]any{"name": "public", "namespace": "team-a"},
		"spec": map[string]any{"acme": map[string]any{
			"server": "https://acme.example.com", "email": "ops@example.com",
			"solvers": []any{
				map[string]any{"http01": map[string]any{}},
				map[string]any{"dns01": map[string]any{"cnameStrategy": "Follow", "route53": map[string]any{"secretAccessKey": "private-token"}}},
			},
		}},
	}}
	facts := BuildFacts("a", issuer)
	require.Equal(t, "acme", facts.Authority.Type)
	require.Equal(t, []string{"HTTP-01", "DNS-01 (route53)"}, facts.Authority.Solvers)
	encoded, err := json.Marshal(facts)
	require.NoError(t, err)
	require.NotContains(t, string(encoded), "private-token")
	certificate := &unstructured.Unstructured{Object: map[string]any{"apiVersion": "cert-manager.io/v1", "kind": "Certificate", "metadata": map[string]any{"name": "tls", "namespace": "team-a"}, "spec": map[string]any{"secretName": "shop-tls", "issuerRef": map[string]any{"name": "public"}, "privateKey": map[string]any{"algorithm": "RSA", "size": int64(2048)}}, "status": map[string]any{"revision": int64(0), "renewalTime": "2026-09-14T00:00:00Z"}}}
	facts = BuildFacts("b", certificate)
	require.Equal(t, "team-a", facts.Issuer.Display.Namespace)
	require.Equal(t, "Issuer", facts.Issuer.Display.Kind)
	require.Equal(t, "b", facts.Secret.Ref.ClusterID)
	require.Equal(t, "v1", facts.Secret.Ref.Version)
	require.Zero(t, *facts.Certificate.Revision)
	require.Equal(t, int64(2048), *facts.Certificate.PrivateKey.Size)
	require.Nil(t, BuildFacts("a", nil))
}

func TestACMEStateAndStaleReadyConditionsStayDistinct(t *testing.T) {
	object := &unstructured.Unstructured{Object: map[string]any{"apiVersion": "acme.cert-manager.io/v1", "kind": "Order", "metadata": map[string]any{"name": "order", "namespace": "team-a"}}}
	for _, test := range []struct{ state, want string }{{"valid", "ready"}, {"ready", "progressing"}, {"processing", "progressing"}, {"invalid", "error"}, {"future-state", "unknown"}} {
		require.NoError(t, unstructured.SetNestedField(object.Object, test.state, "status", "state"))
		_, _, presentation, ok := PrimaryStatus(object)
		require.True(t, ok)
		require.Equal(t, test.want, presentation)
	}
	object.SetAPIVersion("cert-manager.io/v1")
	object.SetKind("Certificate")
	object.SetGeneration(3)
	object.Object["status"] = map[string]any{"conditions": []any{map[string]any{"type": "Ready", "status": "True", "observedGeneration": int64(2)}}}
	_, _, presentation, _ := PrimaryStatus(object)
	require.Equal(t, "progressing", presentation)
}
