package snapshot

import (
	"encoding/json"
	"net/url"
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

// Filter capability metadata must describe dimensions the shared typed query
// request can serialize and the query engine can apply to the full result set.
// Keep provider-specific fields out until their request and engine projections
// exist end to end; otherwise the frontend could expose a global control that
// only filters the visible page or has no effect.
func TestTypedResourceProvidersPublishOnlyQueryBackedFilterCapabilities(t *testing.T) {
	queryBackedFields := map[string]bool{
		"kinds":      true,
		"namespaces": true,
	}

	for domain, caps := range typedCapabilityConformance {
		for _, field := range caps.FilterableFields {
			if !queryBackedFields[field] {
				t.Errorf("%s: filter capability %q has no shared typed-query request and engine projection", domain, field)
			}
		}
	}

	if got := typedCapabilityConformance["pods"].FilterableFields; !equalStringSlices(got, []string{"kinds", "namespaces"}) {
		t.Errorf("pods: structural filter capabilities = %v, want kind and namespace filters", got)
	}
	if got := typedCapabilityConformance["nodes"].FilterableFields; len(got) != 0 {
		t.Errorf("nodes: structural filter capabilities = %v, want none", got)
	}
	if got := typedCapabilityConformance["namespace-workloads"].FilterableFields; !equalStringSlices(got, []string{"kinds", "namespaces"}) {
		t.Errorf("namespace-workloads: structural filter capabilities = %v, want kind and namespace filters", got)
	}
}

func TestPublishedQueryFacetsHaveBackendExecutionAndOptionProjections(t *testing.T) {
	type providerFacetContract struct {
		capabilities ResourceQueryCapabilities
		keys         []string
	}
	providers := map[string]providerFacetContract{
		"pods":                {podQueryCapabilities(), typedTableFacetKeys(podQueryFacets())},
		"nodes":               {nodeQueryCapabilities(), typedTableFacetKeys(nodeQueryFacets())},
		"cluster-events":      {clusterEventsQueryCapabilities(), typedTableFacetKeys(clusterEventTableQueryAdapter().Facets)},
		"cluster-attention":   {clusterAttentionQueryCapabilities(), typedTableFacetKeys(attentionTableQueryAdapter().Facets)},
		"namespace-events":    {namespaceEventsQueryCapabilities(), typedTableFacetKeys(namespacedEventTableQueryAdapter().Facets)},
		"namespace-workloads": {namespaceWorkloadsQueryCapabilities(), typedTableFacetKeys(workloadQueryFacets())},
	}

	for domain, provider := range providers {
		published := map[string]bool{}
		for _, descriptor := range provider.capabilities.QueryFacets {
			if descriptor.Key == "" || descriptor.Label == "" || descriptor.Placeholder == "" {
				t.Errorf("%s: facet descriptor must publish key, label, and placeholder: %+v", domain, descriptor)
			}
			if published[descriptor.Key] {
				t.Errorf("%s: duplicate facet key %q", domain, descriptor.Key)
			}
			published[descriptor.Key] = true
		}
		if len(published) != len(provider.keys) {
			t.Errorf("%s: published %d facets but adapter executes %d", domain, len(published), len(provider.keys))
		}
		for _, key := range provider.keys {
			if !published[key] {
				t.Errorf("%s: adapter facet %q lacks published display metadata", domain, key)
			}
		}
	}
}

func typedTableFacetKeys[T any](facets []typedTableQueryFacet[T]) []string {
	keys := make([]string, 0, len(facets))
	for _, facet := range facets {
		if facet.Value == nil && facet.Values == nil {
			continue
		}
		keys = append(keys, facet.Descriptor.Key)
	}
	return keys
}

func TestTypedResourceProviderFacetContractIsPublishedAndSerializable(t *testing.T) {
	capsRaw, err := json.Marshal(nodeQueryCapabilities())
	if err != nil {
		t.Fatalf("marshal node capabilities: %v", err)
	}
	var caps map[string]json.RawMessage
	if err := json.Unmarshal(capsRaw, &caps); err != nil {
		t.Fatalf("unmarshal node capabilities: %v", err)
	}
	wantDescriptors := `[{"key":"statuses","label":"Status","placeholder":"All statuses","searchable":false,"bulkActions":true}]`
	if got := string(caps["queryFacets"]); got != wantDescriptors {
		t.Fatalf("node query facet descriptors = %s, want %s", got, wantDescriptors)
	}

	values := url.Values{}
	values.Add("facet.statuses", "NotReady")
	values.Add("facet.statuses", "Ready")
	request := resourceQueryRequestFromValues("cluster-a", "nodes", values, ResourceQueryRequest{})
	requestRaw, err := json.Marshal(request)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	var requestJSON map[string]json.RawMessage
	if err := json.Unmarshal(requestRaw, &requestJSON); err != nil {
		t.Fatalf("unmarshal request: %v", err)
	}
	wantFacets := `{"statuses":["NotReady","Ready"]}`
	if got := string(requestJSON["facets"]); got != wantFacets {
		t.Fatalf("serialized provider facet selection = %s, want %s", got, wantFacets)
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

func TestResourceQueryRequestParsesMatchNone(t *testing.T) {
	request := resourceQueryRequestFromValues(
		"cluster-a",
		"pods",
		url.Values{"matchNone": []string{"true"}},
		ResourceQueryRequest{},
	)
	if !request.MatchNone {
		t.Fatal("expected matchNone=true to be preserved in the resource query request")
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
		"cluster-config":        {"StorageClass", "IngressClass", "GatewayClass", "MutatingWebhookConfiguration", "ValidatingWebhookConfiguration"},
		"cluster-storage":       {"PersistentVolume"},
		"cluster-rbac":          {"ClusterRole", "ClusterRoleBinding"},
		"cluster-crds":          {"CustomResourceDefinition"},
		"cluster-events":        nil,
		"cluster-attention":     {"Pod", "Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob", "Node", "Event"},
		"namespace-config":      {"ConfigMap", "Secret"},
		"namespace-network":     {"Service", "Ingress", "EndpointSlice", "NetworkPolicy", "Gateway", "HTTPRoute", "GRPCRoute", "TLSRoute", "ListenerSet", "ReferenceGrant", "BackendTLSPolicy"},
		"namespace-storage":     {"PersistentVolumeClaim"},
		"namespace-rbac":        {"Role", "RoleBinding", "ServiceAccount"},
		"namespace-quotas":      {"ResourceQuota", "LimitRange", "PodDisruptionBudget"},
		"namespace-autoscaling": {"HorizontalPodAutoscaler"},
		"namespace-helm":        {"HelmRelease"},
		"namespace-events":      nil,
		"namespace-workloads":   {"Pod", "Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob"},
		"nodes":                 nil,
		"pods":                  {"Pod"},
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
