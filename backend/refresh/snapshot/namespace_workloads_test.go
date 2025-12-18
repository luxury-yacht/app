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
