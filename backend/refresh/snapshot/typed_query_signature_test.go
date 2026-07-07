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
