package snapshot

import (
	"testing"

	"github.com/luxury-yacht/app/backend/refresh"
)

func TestMergeClusterOverviewPreservesSnapshotWarningsAndTruncation(t *testing.T) {
	t.Parallel()

	snapshots := []*refresh.Snapshot{
		{
			Domain:  clusterOverviewDomainName,
			Scope:   "",
			Version: 1,
			Payload: ClusterOverviewSnapshot{
				ClusterMeta: ClusterMeta{ClusterID: "cluster-a", ClusterName: "alpha"},
				Overview: ClusterOverviewPayload{
					TotalNodes: 3,
				},
				OverviewByCluster: map[string]ClusterOverviewPayload{
					"cluster-a": {TotalNodes: 3},
				},
			},
			Stats: refresh.SnapshotStats{
				ItemCount:    3,
				TotalItems:   5,
				Truncated:    true,
				Warnings:     []string{"cluster-a truncated"},
				BatchIndex:   0,
				TotalBatches: 1,
			},
		},
		{
			Domain:  clusterOverviewDomainName,
			Scope:   "",
			Version: 2,
			Payload: ClusterOverviewSnapshot{
				ClusterMeta: ClusterMeta{ClusterID: "cluster-b", ClusterName: "beta"},
				Overview: ClusterOverviewPayload{
					TotalNodes: 4,
				},
				OverviewByCluster: map[string]ClusterOverviewPayload{
					"cluster-b": {TotalNodes: 4},
				},
			},
			Stats: refresh.SnapshotStats{
				ItemCount:  4,
				Warnings:   []string{"cluster-b warning"},
				TotalItems: 4,
			},
		},
	}

	merged, err := MergeSnapshots(clusterOverviewDomainName, "", snapshots)
	if err != nil {
		t.Fatalf("MergeSnapshots returned error: %v", err)
	}

	if !merged.Stats.Truncated {
		t.Fatalf("expected merged overview stats to preserve truncation")
	}
	if merged.Stats.ItemCount != 7 {
		t.Fatalf("expected merged item count to equal total nodes, got %d", merged.Stats.ItemCount)
	}
	if merged.Stats.TotalItems != 9 {
		t.Fatalf("expected merged total items to sum source totals, got %d", merged.Stats.TotalItems)
	}
	if len(merged.Stats.Warnings) != 2 {
		t.Fatalf("expected merged warnings to include both source warnings, got %v", merged.Stats.Warnings)
	}
}

func TestMergeNamespaceCustomPreservesKinds(t *testing.T) {
	t.Parallel()

	snapshots := []*refresh.Snapshot{
		{
			Domain:  namespaceCustomDomainName,
			Scope:   "cluster-a::namespace:all",
			Version: 1,
			Payload: NamespaceCustomSnapshot{
				ClusterMeta: ClusterMeta{ClusterID: "cluster-a", ClusterName: "alpha"},
				Resources:   []NamespaceCustomSummary{{Kind: "Widget", Name: "widget-a", Namespace: "team-a"}},
				Kinds:       []string{"Widget", "DBCluster"},
			},
			Stats: refresh.SnapshotStats{ItemCount: 1},
		},
		{
			Domain:  namespaceCustomDomainName,
			Scope:   "cluster-b::namespace:all",
			Version: 2,
			Payload: NamespaceCustomSnapshot{
				ClusterMeta: ClusterMeta{ClusterID: "cluster-b", ClusterName: "beta"},
				Resources:   []NamespaceCustomSummary{{Kind: "Gadget", Name: "gadget-a", Namespace: "team-b"}},
				Kinds:       []string{"Gadget", "Widget"},
			},
			Stats: refresh.SnapshotStats{ItemCount: 1},
		},
	}

	merged, err := MergeSnapshots(namespaceCustomDomainName, "namespace:all", snapshots)
	if err != nil {
		t.Fatalf("MergeSnapshots returned error: %v", err)
	}

	payload, ok := merged.Payload.(NamespaceCustomSnapshot)
	if !ok {
		t.Fatalf("expected NamespaceCustomSnapshot payload, got %T", merged.Payload)
	}
	if got, want := payload.Kinds, []string{"DBCluster", "Gadget", "Widget"}; len(got) != len(want) {
		t.Fatalf("expected merged kinds %v, got %v", want, got)
	} else {
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("expected merged kinds %v, got %v", want, got)
			}
		}
	}
}

func TestMergeClusterCustomPreservesKinds(t *testing.T) {
	t.Parallel()

	snapshots := []*refresh.Snapshot{
		{
			Domain:  clusterCustomDomainName,
			Scope:   "",
			Version: 1,
			Payload: ClusterCustomSnapshot{
				ClusterMeta: ClusterMeta{ClusterID: "cluster-a", ClusterName: "alpha"},
				Resources:   []ClusterCustomSummary{{Kind: "Widget", Name: "widget-a"}},
				Kinds:       []string{"Widget", "DBCluster"},
			},
			Stats: refresh.SnapshotStats{ItemCount: 1},
		},
		{
			Domain:  clusterCustomDomainName,
			Scope:   "",
			Version: 2,
			Payload: ClusterCustomSnapshot{
				ClusterMeta: ClusterMeta{ClusterID: "cluster-b", ClusterName: "beta"},
				Resources:   []ClusterCustomSummary{{Kind: "Gadget", Name: "gadget-a"}},
				Kinds:       []string{"Gadget", "Widget"},
			},
			Stats: refresh.SnapshotStats{ItemCount: 1},
		},
	}

	merged, err := MergeSnapshots(clusterCustomDomainName, "", snapshots)
	if err != nil {
		t.Fatalf("MergeSnapshots returned error: %v", err)
	}

	payload, ok := merged.Payload.(ClusterCustomSnapshot)
	if !ok {
		t.Fatalf("expected ClusterCustomSnapshot payload, got %T", merged.Payload)
	}
	if got, want := payload.Kinds, []string{"DBCluster", "Gadget", "Widget"}; len(got) != len(want) {
		t.Fatalf("expected merged kinds %v, got %v", want, got)
	} else {
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("expected merged kinds %v, got %v", want, got)
			}
		}
	}
}
