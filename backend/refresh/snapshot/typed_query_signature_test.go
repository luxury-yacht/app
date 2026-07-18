package snapshot

import (
	"testing"

	"github.com/luxury-yacht/app/backend/refresh/querypage"
)

// A cursor pins its query identity via typedQuerySignature; Cursor.Validate
// rejects a cursor whose signature differs so it can never mispage a different
// query. Two request fields change the matched ROW SET but were historically
// omitted from the signature:
//   - BaseScope becomes the namespace filter in maintained queries.
//   - IncludeMetadata extends Search to labels/annotations.
//
// Both must perturb the signature (as perBuildCacheKey already treats them), so
// a stale cursor from a different scope / metadata setting cannot validate.
func TestTypedQuerySignatureIncludesBaseScopeAndIncludeMetadata(t *testing.T) {
	base := ResourceQueryRequest{ClusterID: "c1", Table: "pods", Search: "web"}
	sig := func(baseScope string, req ResourceQueryRequest) string {
		return typedQuerySignature("name", querypage.Ascending, 50, baseScope, req)
	}

	if sig("namespace:foo", base) == sig("namespace:bar", base) {
		t.Error("BaseScope must change the signature (it filters the row set)")
	}

	withMeta := base
	withMeta.IncludeMetadata = true
	if sig("namespace:foo", base) == sig("namespace:foo", withMeta) {
		t.Error("IncludeMetadata must change the signature (it changes search semantics)")
	}

	// A change to neither still shares a signature (the fields that DO differ are
	// the ones that must perturb it — Kinds/Namespaces/Search/Predicates are
	// already covered by other tests).
	other := base
	other.Search = "web" // same as base
	if sig("namespace:foo", base) != sig("namespace:foo", other) {
		t.Error("equal query identity must share a signature")
	}
}

func TestTypedQuerySignatureIncludesProviderFacetFilters(t *testing.T) {
	base := ResourceQueryRequest{ClusterID: "c1", Table: "pods"}
	sig := func(req ResourceQueryRequest) string {
		return typedQuerySignature("name", querypage.Ascending, 50, "namespace:all", req)
	}

	withStatus := base
	withStatus.Facets = map[string][]string{"statuses": {"Running"}}
	if sig(base) == sig(withStatus) {
		t.Error("Statuses must change the signature")
	}

	withNode := base
	withNode.Facets = map[string][]string{"nodes": {"node-a"}}
	if sig(base) == sig(withNode) {
		t.Error("Nodes must change the signature")
	}

	reordered := base
	reordered.Facets = map[string][]string{"statuses": {"Running", "Pending"}}
	equivalent := base
	equivalent.Facets = map[string][]string{"statuses": {"Pending", "Running"}}
	if sig(reordered) != sig(equivalent) {
		t.Error("equivalent unordered status filters must share a signature")
	}
}

func TestTypedQuerySignatureSeparatesOpaqueFacetSelections(t *testing.T) {
	request := func(values ...string) ResourceQueryRequest {
		return ResourceQueryRequest{
			ClusterID: "c1",
			Table:     "pods",
			Facets:    map[string][]string{"values": values},
		}
	}
	sig := func(req ResourceQueryRequest) string {
		return typedQuerySignature("name", querypage.Ascending, 50, "namespace:all", req)
	}

	if sig(request("a,b", "c")) == sig(request("a", "b,c")) {
		t.Fatal("distinct opaque facet selections must not share a cursor signature")
	}
}
