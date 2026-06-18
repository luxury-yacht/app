/*
 * backend/resources/namespaces/facts.go
 *
 * Canonical Namespace facts. ResourceQuota/LimitRange links reference the shared
 * ResourceLink primitive (resourcemodel); workload presence is supplied by the
 * caller (it requires a multi-kind list scan, gated by RBAC).
 */

package namespaces

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the canonical Namespace model facts.
type Facts struct {
	RawPhase       string                       `json:"rawPhase,omitempty"`
	WorkloadState  string                       `json:"workloadState,omitempty"`
	ResourceQuotas []resourcemodel.ResourceLink `json:"resourceQuotas,omitempty"`
	LimitRanges    []resourcemodel.ResourceLink `json:"limitRanges,omitempty"`
	WorkloadsKnown bool                         `json:"workloadsKnown"`
	HasWorkloads   bool                         `json:"hasWorkloads"`
}

// Workload-presence states carried by Facts.WorkloadState.
const (
	workloadStateUnknown = "unknown"
	workloadStateNone    = "none"
	workloadStatePresent = "present"
)
