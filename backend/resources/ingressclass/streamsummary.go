/*
 * backend/resources/ingressclass/streamsummary.go
 *
 * IngressClass's stream-summary builder, owned by the kind's package. Produces the
 * neutral streamrows.ClusterConfigEntry row (cluster-config). No snapshot import.
 */

package ingressclass

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	networkingv1 "k8s.io/api/networking/v1"
)

// BuildStreamSummary builds the cluster-config row for one IngressClass.
func BuildStreamSummary(meta streamrows.ClusterMeta, ic *networkingv1.IngressClass) streamrows.ClusterConfigEntry {
	if ic == nil {
		return streamrows.ClusterConfigEntry{ClusterMeta: meta, Kind: "IngressClass"}
	}
	facts := BuildFacts(ic)
	return streamrows.NewClusterConfigEntry(meta, ic, "IngressClass", facts.Controller, facts.DefaultClass)
}
