/*
 * backend/resources/daemonset/facts.go
 *
 * Canonical DaemonSet facts — the single typed extraction of a DaemonSet's
 * intrinsic fields. Shared workload primitives are embedded from resourcemodel.
 */

package daemonset

import "github.com/luxury-yacht/app/backend/resourcemodel"

// Facts is the canonical DaemonSet model facts.
type Facts struct {
	resourcemodel.WorkloadCommonFacts
	resourcemodel.PodTemplateFacts
	UpdateStrategy       string            `json:"updateStrategy,omitempty"`
	MaxUnavailable       string            `json:"maxUnavailable,omitempty"`
	MaxSurge             string            `json:"maxSurge,omitempty"`
	MinReadySeconds      int32             `json:"minReadySeconds,omitempty"`
	RevisionHistoryLimit int32             `json:"revisionHistoryLimit,omitempty"`
	Selector             map[string]string `json:"selector,omitempty"`
	ObservedGeneration   int64             `json:"observedGeneration,omitempty"`
	NumberMisscheduled   int32             `json:"numberMisscheduled,omitempty"`
	CollisionCount       *int32            `json:"collisionCount,omitempty"`
	ReadySummary         string            `json:"readySummary,omitempty"`
}
