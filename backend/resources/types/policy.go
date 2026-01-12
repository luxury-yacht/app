/*
 * backend/resources/types/policy.go
 *
 * Type definitions for Policy resources.
 * - Shared data structures for API responses.
 */

package types

import metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

// PodDisruptionBudgetDetails represents comprehensive PDB information.
type PodDisruptionBudgetDetails struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Age       string `json:"age"`
	Details   string `json:"details"`

	MinAvailable   *string           `json:"minAvailable,omitempty"`
	MaxUnavailable *string           `json:"maxUnavailable,omitempty"`
	Selector       map[string]string `json:"selector,omitempty"`

	CurrentHealthy     int32 `json:"currentHealthy"`
	DesiredHealthy     int32 `json:"desiredHealthy"`
	DisruptionsAllowed int32 `json:"disruptionsAllowed"`
	ExpectedPods       int32 `json:"expectedPods"`
	ObservedGeneration int64 `json:"observedGeneration"`

	DisruptedPods map[string]metav1.Time `json:"disruptedPods,omitempty"`
	Conditions    []string               `json:"conditions,omitempty"`

	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`
}
