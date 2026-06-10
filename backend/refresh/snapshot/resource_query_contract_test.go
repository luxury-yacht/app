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
