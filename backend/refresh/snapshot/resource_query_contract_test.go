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
				SortableFields:   []string{"name", "cpu"},
				VisibleRowExport: true,
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

// Export capability booleans must always be present; false is meaningful (the
// frontend must not treat a missing flag as "allowed").
func TestResourceQueryCapabilitiesSerializeExplicitBooleans(t *testing.T) {
	raw, err := json.Marshal(ResourceQueryCapabilities{})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, key := range []string{"visibleRowExport", "queryWideExport"} {
		if _, ok := m[key]; !ok {
			t.Errorf("capabilities JSON must always include %q; got %s", key, raw)
		}
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
