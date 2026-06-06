package snapshot

import (
	"encoding/json"
	"reflect"
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

// Every typed-resource provider must publish capabilities that expose
// visible-row export only. Query-wide export is a catalog-only capability until
// a typed provider implements a backend export path (plan Phase 1). Capabilities
// are the source of truth the frontend reads, so a domain that forgets to wire
// them, or mis-advertises query-wide export, would silently regress export and
// sort/search behavior. This table is also the conformance gate: a newly added
// typed domain should be added here.
func TestTypedResourceProvidersPublishVisibleRowExportOnly(t *testing.T) {
	typedCapabilities := map[string]ResourceQueryCapabilities{
		"cluster-config":        clusterConfigQueryCapabilities(),
		"cluster-storage":       clusterStorageQueryCapabilities(),
		"cluster-rbac":          clusterRBACQueryCapabilities(),
		"cluster-crds":          clusterCRDQueryCapabilities(),
		"cluster-events":        clusterEventsQueryCapabilities(),
		"namespace-config":      namespaceConfigQueryCapabilities(),
		"namespace-network":     namespaceNetworkQueryCapabilities(),
		"namespace-storage":     namespaceStorageQueryCapabilities(),
		"namespace-rbac":        namespaceRBACQueryCapabilities(),
		"namespace-quotas":      namespaceQuotasQueryCapabilities(),
		"namespace-autoscaling": namespaceAutoscalingQueryCapabilities(),
		"namespace-helm":        namespaceHelmQueryCapabilities(),
		"namespace-events":      namespaceEventsQueryCapabilities(),
		"namespace-workloads":   namespaceWorkloadsQueryCapabilities(),
		"nodes":                 nodeQueryCapabilities(),
		"pods":                  podQueryCapabilities(),
	}
	for domain, caps := range typedCapabilities {
		if !caps.VisibleRowExport {
			t.Errorf("%s: typed provider must support visible-row export", domain)
		}
		if caps.QueryWideExport {
			t.Errorf("%s: typed provider must NOT advertise query-wide export (catalog-only)", domain)
		}
		if len(caps.SortableFields) == 0 {
			t.Errorf("%s: typed provider must publish at least one sortable field", domain)
		}
		if len(caps.SearchableFields) == 0 {
			t.Errorf("%s: typed provider must publish at least one searchable field", domain)
		}
	}
}

// The catalog is the one provider that owns the full match set behind a cursor,
// so it advertises query-wide export in addition to visible-row export — the
// capability distinction that lets the frontend offer "export all matches" for
// browse/custom but only "export visible" for typed tables.
func TestCatalogProviderAdvertisesQueryWideExport(t *testing.T) {
	caps := newCatalogCapabilities()
	if !caps.QueryWideExport {
		t.Error("catalog provider must advertise query-wide export")
	}
	if !caps.VisibleRowExport {
		t.Error("catalog provider must also support visible-row export")
	}
	if len(caps.SortableFields) == 0 {
		t.Error("catalog provider must publish sortable fields")
	}
}

// Query-wide export (the catalog's `queryWideExport` capability) is driven by a
// QuerySelectionDescriptor — the durable scoped query identity — NOT by sending
// thousands of concrete frontend rows back to the backend. This locks the
// descriptor's shape: it must carry everything needed to re-run the query
// server-side (cluster, table, namespaces, kinds, search, predicates, sort,
// customOnly) and round-trip on the wire, and it must NOT depend on row payloads.
func TestQuerySelectionDescriptorCarriesScopedQueryIdentity(t *testing.T) {
	selection := QuerySelectionDescriptor{
		ClusterID:     "cluster-a",
		Table:         "browse",
		Namespaces:    []string{"team-a", "team-b"},
		Kinds:         []string{"Pod", "Deployment"},
		Search:        "nginx",
		Predicates:    []ResourceQueryPredicate{{Field: "health", Op: "eq", Value: "unhealthy"}},
		SortField:     "name",
		SortDirection: "desc",
		CustomOnly:    true,
	}

	raw, err := json.Marshal(selection)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var decoded QuerySelectionDescriptor
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if !reflect.DeepEqual(selection, decoded) {
		t.Fatalf("descriptor did not round-trip:\n got  %+v\n want %+v", decoded, selection)
	}
	// Cluster + table identity is mandatory for a server-side replay; without it
	// the backend cannot reconstruct the query the export should cover.
	if decoded.ClusterID == "" || decoded.Table == "" {
		t.Fatal("descriptor must carry cluster + table identity")
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
