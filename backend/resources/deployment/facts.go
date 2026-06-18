/*
 * backend/resources/deployment/facts.go
 *
 * Canonical Deployment facts — the single typed extraction of a Deployment's
 * intrinsic fields. Shared workload primitives are embedded from resourcemodel.
 */

package deployment

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the canonical Deployment model facts.
type Facts struct {
	resourcemodel.WorkloadCommonFacts
	resourcemodel.PodTemplateFacts
	Paused             bool              `json:"paused,omitempty"`
	Strategy           string            `json:"strategy,omitempty"`
	MaxSurge           string            `json:"maxSurge,omitempty"`
	MaxUnavailable     string            `json:"maxUnavailable,omitempty"`
	MinReadySeconds    int32             `json:"minReadySeconds,omitempty"`
	RevisionHistory    int32             `json:"revisionHistory,omitempty"`
	ProgressDeadline   int32             `json:"progressDeadline,omitempty"`
	ObservedGeneration int64             `json:"observedGeneration,omitempty"`
	Selector           map[string]string `json:"selector,omitempty"`
	ReadySummary       string            `json:"readySummary,omitempty"`
	RolloutStatus      string            `json:"rolloutStatus,omitempty"`
	RolloutMessage     string            `json:"rolloutMessage,omitempty"`
}
