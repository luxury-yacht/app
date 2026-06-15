/*
 * backend/resources/replicaset/facts.go
 *
 * Canonical ReplicaSet facts — the single typed extraction of a ReplicaSet's
 * intrinsic fields. Shared workload primitives are embedded from resourcemodel.
 */

package replicaset

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the canonical ReplicaSet model facts.
type Facts struct {
	resourcemodel.WorkloadCommonFacts
	resourcemodel.PodTemplateFacts
	MinReadySeconds    int32             `json:"minReadySeconds,omitempty"`
	Selector           map[string]string `json:"selector,omitempty"`
	ObservedGeneration int64             `json:"observedGeneration,omitempty"`
	ReadySummary       string            `json:"readySummary,omitempty"`
}
