/*
 * backend/resources/statefulset/facts.go
 *
 * Canonical StatefulSet facts — the single typed extraction of a StatefulSet's
 * intrinsic fields. Shared workload primitives (replica counts, pod template)
 * are embedded from resourcemodel; everything else is StatefulSet-specific.
 */

package statefulset

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the canonical StatefulSet model facts.
type Facts struct {
	resourcemodel.WorkloadCommonFacts
	resourcemodel.PodTemplateFacts
	UpdateStrategy        string            `json:"updateStrategy,omitempty"`
	Partition             *int32            `json:"partition,omitempty"`
	MaxUnavailable        string            `json:"maxUnavailable,omitempty"`
	PodManagementPolicy   string            `json:"podManagementPolicy,omitempty"`
	MinReadySeconds       int32             `json:"minReadySeconds,omitempty"`
	RevisionHistoryLimit  int32             `json:"revisionHistoryLimit,omitempty"`
	ServiceName           string            `json:"serviceName,omitempty"`
	Selector              map[string]string `json:"selector,omitempty"`
	StatusCurrentRevision string            `json:"statusCurrentRevision,omitempty"`
	StatusUpdateRevision  string            `json:"statusUpdateRevision,omitempty"`
	StatusCurrentReplicas int32             `json:"statusCurrentReplicas,omitempty"`
	ObservedGeneration    int64             `json:"observedGeneration,omitempty"`
	CollisionCount        *int32            `json:"collisionCount,omitempty"`
	ReadySummary          string            `json:"readySummary,omitempty"`
}
