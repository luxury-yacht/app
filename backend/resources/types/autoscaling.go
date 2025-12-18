package types

import metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

// HorizontalPodAutoscalerDetails represents comprehensive HPA information.
type HorizontalPodAutoscalerDetails struct {
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Age       string `json:"age"`
	Details   string `json:"details"`

	ScaleTargetRef ScaleTargetReference `json:"scaleTargetRef"`

	MinReplicas     *int32 `json:"minReplicas,omitempty"`
	MaxReplicas     int32  `json:"maxReplicas"`
	CurrentReplicas int32  `json:"currentReplicas"`
	DesiredReplicas int32  `json:"desiredReplicas"`

	Metrics        []MetricSpec   `json:"metrics"`
	CurrentMetrics []MetricStatus `json:"currentMetrics,omitempty"`

	Behavior *ScalingBehavior `json:"behavior,omitempty"`

	Conditions []string `json:"conditions,omitempty"`

	Labels      map[string]string `json:"labels,omitempty"`
	Annotations map[string]string `json:"annotations,omitempty"`

	LastScaleTime *metav1.Time `json:"lastScaleTime,omitempty"`
}

// ScaleTargetReference represents the target of the HPA.
type ScaleTargetReference struct {
	Kind       string `json:"kind"`
	Name       string `json:"name"`
	APIVersion string `json:"apiVersion,omitempty"`
}

// MetricSpec represents a metric specification.
type MetricSpec struct {
	Kind   string            `json:"kind"`
	Target map[string]string `json:"target"`
}

// MetricStatus represents the current status of a metric.
type MetricStatus struct {
	Kind    string            `json:"kind"`
	Current map[string]string `json:"current"`
}

// ScalingBehavior represents the scaling behavior configuration.
type ScalingBehavior struct {
	ScaleUp   *ScalingRules `json:"scaleUp,omitempty"`
	ScaleDown *ScalingRules `json:"scaleDown,omitempty"`
}

// ScalingRules represents rules for scaling.
type ScalingRules struct {
	StabilizationWindowSeconds *int32   `json:"stabilizationWindowSeconds,omitempty"`
	SelectPolicy               string   `json:"selectPolicy,omitempty"`
	Policies                   []string `json:"policies,omitempty"`
}
