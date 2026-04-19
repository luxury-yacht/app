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
				ItemCount:   3,
				TotalItems:  5,
				Truncated:   true,
				Warnings:    []string{"cluster-a truncated"},
				BatchIndex:  0,
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
