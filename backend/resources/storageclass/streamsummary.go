/*
 * backend/resources/storageclass/streamsummary.go
 *
 * StorageClass's stream-summary builder, owned by the kind's package. Produces the
 * neutral streamrows.ClusterConfigEntry row (cluster-config). No snapshot import.
 */

package storageclass

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	storagev1 "k8s.io/api/storage/v1"
)

// BuildStreamSummary builds the cluster-config row for one StorageClass.
func BuildStreamSummary(meta streamrows.ClusterMeta, sc *storagev1.StorageClass) streamrows.ClusterConfigEntry {
	if sc == nil {
		return streamrows.ClusterConfigEntry{ClusterMeta: meta, Kind: "StorageClass"}
	}
	facts := BuildFacts(sc)
	return streamrows.NewClusterConfigEntry(meta, Identity, sc, facts.Provisioner, facts.DefaultClass)
}
