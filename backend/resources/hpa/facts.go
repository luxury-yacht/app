/*
 * backend/resources/hpa/facts.go
 *
 * Canonical HorizontalPodAutoscaler facts. ScaleTarget is a shared ResourceLink and
 * Conditions are shared ConditionFacts (both stay in resourcemodel); the metric and
 * scaling-behavior sub-types are HPA-only and owned here.
 */

package hpa

import (
	"github.com/luxury-yacht/app/backend/resourcemodel"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Facts is the canonical HorizontalPodAutoscaler model facts.
type Facts struct {
	ScaleTarget     resourcemodel.ResourceLink     `json:"scaleTarget"`
	MinReplicas     *int32                         `json:"minReplicas,omitempty"`
	MaxReplicas     int32                          `json:"maxReplicas"`
	CurrentReplicas int32                          `json:"currentReplicas"`
	DesiredReplicas int32                          `json:"desiredReplicas"`
	Metrics         []MetricFacts                  `json:"metrics,omitempty"`
	CurrentMetrics  []MetricStatusFacts            `json:"currentMetrics,omitempty"`
	Behavior        *ScalingBehaviorFacts          `json:"behavior,omitempty"`
	Conditions      []resourcemodel.ConditionFacts `json:"conditions,omitempty"`
	LastScaleTime   *metav1.Time                   `json:"lastScaleTime,omitempty"`
}

// MetricFacts describes a single HPA metric spec.
type MetricFacts struct {
	Kind   string            `json:"kind"`
	Target map[string]string `json:"target,omitempty"`
}

// MetricStatusFacts describes the current status of a single HPA metric.
type MetricStatusFacts struct {
	Kind    string            `json:"kind"`
	Current map[string]string `json:"current,omitempty"`
}

// ScalingBehaviorFacts describes the HPA scaling behavior.
type ScalingBehaviorFacts struct {
	ScaleUp   *ScalingRulesFacts `json:"scaleUp,omitempty"`
	ScaleDown *ScalingRulesFacts `json:"scaleDown,omitempty"`
}

// ScalingRulesFacts describes one direction of HPA scaling rules.
type ScalingRulesFacts struct {
	StabilizationWindowSeconds *int32   `json:"stabilizationWindowSeconds,omitempty"`
	SelectPolicy               string   `json:"selectPolicy,omitempty"`
	Policies                   []string `json:"policies,omitempty"`
}
