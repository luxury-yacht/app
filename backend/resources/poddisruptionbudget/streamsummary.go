/*
 * backend/resources/poddisruptionbudget/streamsummary.go
 *
 * PodDisruptionBudget's stream-summary builder, owned by the kind's package.
 * Produces the neutral streamrows.QuotaSummary row plus the PDB-specific status
 * and availability fields the quotas table shows. No snapshot import.
 */

package poddisruptionbudget

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	policyv1 "k8s.io/api/policy/v1"
)

// BuildStreamSummary builds the namespace-quotas row for one PodDisruptionBudget.
func BuildStreamSummary(meta streamrows.ClusterMeta, pdb *policyv1.PodDisruptionBudget) streamrows.QuotaSummary {
	if pdb == nil {
		return streamrows.QuotaSummary{ClusterMeta: meta, Kind: "PodDisruptionBudget"}
	}
	facts := BuildFacts(meta.ClusterID, pdb)
	summary := streamrows.NewQuotaSummary(meta, Identity, pdb, DescribeSummary(facts))
	summary.Status = &streamrows.QuotaStatus{
		DisruptionsAllowed: facts.AllowedDisruptions,
		CurrentHealthy:     facts.CurrentHealthy,
		DesiredHealthy:     facts.DesiredHealthy,
	}
	if facts.MinAvailable != nil {
		value := facts.MinAvailable.Value
		summary.MinAvailable = &value
	}
	if facts.MaxUnavailable != nil {
		value := facts.MaxUnavailable.Value
		summary.MaxUnavailable = &value
	}
	return summary
}
