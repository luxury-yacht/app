/*
 * backend/resources/poddisruptionbudget/dto.go
 *
 * PodDisruptionBudget detail DTO (the frontend wire shape), co-located with its
 * model and detail builder.
 */

package poddisruptionbudget

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// PodDisruptionBudgetDetails represents comprehensive PDB information.
type PodDisruptionBudgetDetails struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Details   string `json:"details"`

	MinAvailable   *string `json:"minAvailable,omitempty"`
	MaxUnavailable *string `json:"maxUnavailable,omitempty"`
	// Selector is omitted when the spec has none (it matches no pods); an empty
	// selector ({}) matches every pod in the namespace.
	Selector *LabelSelector `json:"selector,omitempty"`
	// UnhealthyPodEvictionPolicy is omitted when unset (Kubernetes then applies IfHealthyBudget).
	UnhealthyPodEvictionPolicy string `json:"unhealthyPodEvictionPolicy,omitempty"`

	CurrentHealthy     int32 `json:"currentHealthy"`
	DesiredHealthy     int32 `json:"desiredHealthy"`
	DisruptionsAllowed int32 `json:"disruptionsAllowed"`
	ExpectedPods       int32 `json:"expectedPods"`
	ObservedGeneration int64 `json:"observedGeneration"`

	DisruptedPods []DisruptedPod            `json:"disruptedPods,omitempty"`
	Conditions    []restypes.ConditionState `json:"conditions,omitempty"`

	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}

type LabelSelector struct {
	MatchLabels      map[string]string          `json:"matchLabels,omitempty"`
	MatchExpressions []LabelSelectorRequirement `json:"matchExpressions,omitempty"`
}

type LabelSelectorRequirement struct {
	Key      string   `json:"key"`
	Operator string   `json:"operator"`
	Values   []string `json:"values,omitempty"`
}

// DisruptedPod is a pod whose eviction the API server processed but the
// disruption controller has not yet seen deleted.
type DisruptedPod struct {
	Pod            resourcemodel.ResourceLink `json:"pod"`
	DisruptionTime metav1.Time                `json:"disruptionTime"`
}
