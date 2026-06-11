package snapshot

import (
	"testing"
)

func TestSortWorkloadSummariesUsesNamespaceTieBreaker(t *testing.T) {
	items := []WorkloadSummary{
		{Kind: "Deployment", Name: "api", Namespace: "beta"},
		{Kind: "Deployment", Name: "api", Namespace: "alpha"},
		{Kind: "DaemonSet", Name: "agent", Namespace: "ops"},
		{Kind: "StatefulSet", Name: "db", Namespace: "alpha"},
	}

	sortWorkloadSummaries(items)

	expected := []WorkloadSummary{
		{Kind: "DaemonSet", Name: "agent", Namespace: "ops"},
		{Kind: "Deployment", Name: "api", Namespace: "alpha"},
		{Kind: "Deployment", Name: "api", Namespace: "beta"},
		{Kind: "StatefulSet", Name: "db", Namespace: "alpha"},
	}

	for idx := range expected {
		got := items[idx]
		want := expected[idx]
		if got.Kind != want.Kind || got.Name != want.Name || got.Namespace != want.Namespace {
			t.Fatalf("unexpected order at index %d: got %s/%s in %s, want %s/%s in %s",
				idx, got.Kind, got.Name, got.Namespace, want.Kind, want.Name, want.Namespace)
		}
	}
}

// The envelope-published kind vocabulary narrows to the kinds whose backing
// listers exist: a builder with no listers can produce no rows, so it offers
// no kinds. (The static family vocabulary stays full — conformance pins it.)
func TestNamespaceWorkloadsCapabilitiesNarrowToAvailableSources(t *testing.T) {
	builder := &NamespaceWorkloadsBuilder{}
	capabilities := builder.queryCapabilities()
	if len(capabilities.KindVocabulary) != 0 {
		t.Errorf("expected an empty kind vocabulary with no listers, got %v", capabilities.KindVocabulary)
	}
}
