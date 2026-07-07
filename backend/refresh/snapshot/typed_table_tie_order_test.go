package snapshot

import (
	"testing"

	"github.com/luxury-yacht/app/backend/refresh/querypage"
)

// TestTiedSortValuesOrderByHumanKey pins the keyset tie-break contract
// (docs/architecture/data-layer.md "Store & query engine"): rows
// whose sort values collide order by the name-shaped adapter key — kind, then
// namespace, then name, lowercased — never by an arbitrary identifier such as
// the Kubernetes object UID. Sorting by name with identical names across kinds
// and namespaces makes the tie order fully user-visible, so this test is the
// contract that keeps it human. (Both executors share this tiebreak: the engine
// via Schema.UID = adapter.Key, the bespoke oracle via typedTableSortedItemLess.)
func TestTiedSortValuesOrderByHumanKey(t *testing.T) {
	store := querypage.NewStore(configQuerypageSchema())
	rows := []ConfigSummary{
		{Kind: "Secret", Name: "app", Namespace: "alpha"},
		{Kind: "ConfigMap", Name: "app", Namespace: "beta"},
		{Kind: "ConfigMap", Name: "app", Namespace: "alpha"},
	}
	for _, r := range rows {
		store.Upsert(r)
	}

	page, err := store.Query(querypage.Query{
		ClusterID: "c", Signature: "sig", Sort: "name",
		Direction: querypage.Ascending, Limit: 10,
	})
	if err != nil {
		t.Fatal(err)
	}

	adapter := configTableQueryAdapter()
	got := make([]string, 0, len(page.Rows))
	for _, r := range page.Rows {
		got = append(got, adapter.Key(r))
	}
	want := []string{"configmap/alpha/app", "configmap/beta/app", "secret/alpha/app"}
	if len(got) != len(want) {
		t.Fatalf("got %d rows %v, want %d", len(got), got, len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("tied rows out of human order at %d:\n got  %v\n want %v", i, got, want)
		}
	}

	// Descending by the tied value keeps the SAME ascending human tiebreak
	// (descLess flips the value comparison only), so tied rows never reorder
	// when the user flips sort direction.
	desc, err := store.Query(querypage.Query{
		ClusterID: "c", Signature: "sig", Sort: "name",
		Direction: querypage.Descending, Limit: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	for i, r := range desc.Rows {
		if adapter.Key(r) != want[i] {
			t.Fatalf("descending tied order diverged at %d: got %s, want %s",
				i, adapter.Key(r), want[i])
		}
	}
}
