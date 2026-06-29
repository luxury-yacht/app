package snapshot

import (
	"encoding/json"
	"testing"
)

// sampleQueryRow stands in for a provider-owned projected row type.
type sampleQueryRow struct {
	ClusterID string `json:"clusterId"`
	Name      string `json:"name"`
	CPU       string `json:"cpu,omitempty"`
}

// sampleQueryResult mirrors the canonical per-domain result shape: one embedded
// ResourceQueryEnvelope plus a typed Rows slice.
type sampleQueryResult struct {
	ResourceQueryEnvelope
	Rows []sampleQueryRow `json:"rows"`
}

// The frontend relies on Go embedding to inline the envelope fields at the top
// level so every provider/domain result presents one uniform shape.
func TestResourceQueryEnvelopeFlattensWhenEmbedded(t *testing.T) {
	result := sampleQueryResult{
		ResourceQueryEnvelope: ResourceQueryEnvelope{
			Provider:     ResourceQueryProviderTypedResource,
			Table:        "nodes",
			Total:        2,
			TotalIsExact: true,
			Kinds:        []string{"Node"},
			FacetsExact:  true,
			Completeness: ResourceQueryComplete,
			Capabilities: ResourceQueryCapabilities{
				SortableFields: []string{"name", "cpu"},
			},
		},
		Rows: []sampleQueryRow{{ClusterID: "c1", Name: "node-1", CPU: "100m"}},
	}

	raw, err := json.Marshal(result)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var generic map[string]json.RawMessage
	if err := json.Unmarshal(raw, &generic); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}

	keys := make([]string, 0, len(generic))
	for key := range generic {
		keys = append(keys, key)
	}

	for _, key := range []string{
		"provider", "table", "total", "totalIsExact",
		"kinds", "facetsExact", "completeness", "capabilities", "rows",
	} {
		if _, ok := generic[key]; !ok {
			t.Errorf("expected flattened top-level key %q; got %v", key, keys)
		}
	}

	if _, nested := generic["ResourceQueryEnvelope"]; nested {
		t.Error("envelope leaked as a nested object instead of inlining into the result")
	}
}

// Every typed-resource provider must publish sortable and searchable fields —
// capabilities are the source of truth the frontend reads, so a domain that
// forgets to wire them silently regresses sort/search behavior. This table is
// also the conformance gate: a newly added typed domain should be added here.
func TestTypedResourceProvidersPublishQueryCapabilities(t *testing.T) {
	for domain, caps := range typedCapabilityConformance {
		if len(caps.SortableFields) == 0 {
			t.Errorf("%s: typed provider must publish at least one sortable field", domain)
		}
		if len(caps.SearchableFields) == 0 {
			t.Errorf("%s: typed provider must publish at least one searchable field", domain)
		}
	}
}

// The catalog publishes the same query-surface capabilities as the typed
// providers (exports are client-driven cursor walks for every provider).
func TestCatalogProviderPublishesQueryCapabilities(t *testing.T) {
	caps := newCatalogCapabilities()
	if len(caps.SortableFields) == 0 {
		t.Error("catalog provider must publish sortable fields")
	}
	if len(caps.SearchableFields) == 0 {
		t.Error("catalog provider must publish searchable fields")
	}
}

func TestResourceQueryRequestCarriesProviderAndScope(t *testing.T) {
	req := ResourceQueryRequest{
		ClusterID: "c1",
		Provider:  ResourceQueryProviderCatalog,
		Table:     "browse",
		Scope:     ResourceQueryScopeAllNamespaces,
	}
	raw, err := json.Marshal(req)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded ResourceQueryRequest
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.Provider != ResourceQueryProviderCatalog {
		t.Errorf("provider round-trip = %q, want %q", decoded.Provider, ResourceQueryProviderCatalog)
	}
	if decoded.Scope != ResourceQueryScopeAllNamespaces {
		t.Errorf("scope round-trip = %q, want %q", decoded.Scope, ResourceQueryScopeAllNamespaces)
	}
}

// The "every typed-resource payload embeds the normalized envelope" conformance
// gate now lives in typed_provider_discovery_test.go
// (TestEveryTypedResourceDomainEmbedsTheNormalizedEnvelope), driven by source
// discovery instead of a hardcoded payload list.

// Every typed provider that supports kind filtering publishes its closed kind
// vocabulary — the option list the frontend's Kinds dropdown renders. The kind
// FACETS collapse to the active selection by design (they describe the matched
// rows), so the dropdown must come from this vocabulary, never the facets.
// Exemptions: the two events domains (their kind set is the open set of
// involved-object kinds and their views render no kind dropdown) and nodes
// (no kind filtering at all).
func TestTypedResourceProvidersPublishKindVocabulary(t *testing.T) {
	expected := map[string][]string{
		"cluster-config":              {"StorageClass", "IngressClass", "GatewayClass", "MutatingWebhookConfiguration", "ValidatingWebhookConfiguration"},
		"cluster-storage":             {"PersistentVolume"},
		"cluster-rbac":                {"ClusterRole", "ClusterRoleBinding"},
		"cluster-crds":                {"CustomResourceDefinition"},
		"cluster-events":              nil,
		"namespace-config":            {"ConfigMap", "Secret"},
		"namespace-network":           {"Service", "Ingress", "EndpointSlice", "NetworkPolicy", "Gateway", "HTTPRoute", "GRPCRoute", "TLSRoute", "ListenerSet", "ReferenceGrant", "BackendTLSPolicy"},
		"namespace-storage":           {"PersistentVolumeClaim"},
		"namespace-rbac":              {"Role", "RoleBinding", "ServiceAccount"},
		"namespace-quotas":            {"ResourceQuota", "LimitRange", "PodDisruptionBudget"},
		"namespace-autoscaling":       {"HorizontalPodAutoscaler"},
		"namespace-helm":              {"HelmRelease"},
		"namespace-events":            nil,
		"namespace-workloads":         {"Pod", "Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob"},
		"namespace-workloads-metrics": {"Pod", "Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob"},
		"nodes":                       nil,
		"nodes-metrics":               nil,
		"pods":                        {"Pod"},
		"pods-metrics":                {"Pod"},
	}

	if len(expected) != len(typedCapabilityConformance) {
		t.Fatalf("kind vocabulary table covers %d domains but the capability conformance map has %d; keep them in lockstep", len(expected), len(typedCapabilityConformance))
	}

	for domain, caps := range typedCapabilityConformance {
		want, ok := expected[domain]
		if !ok {
			t.Errorf("%s: add the domain's kind vocabulary to this conformance table", domain)
			continue
		}
		if len(want) == 0 {
			if len(caps.KindVocabulary) != 0 {
				t.Errorf("%s: expected no kind vocabulary (open kind set or no kind filter), got %v", domain, caps.KindVocabulary)
			}
			continue
		}
		if got := caps.KindVocabulary; !equalStringSlices(got, want) {
			t.Errorf("%s: kind vocabulary mismatch\n got: %v\nwant: %v", domain, got, want)
		}
	}
}

func equalStringSlices(got, want []string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}
