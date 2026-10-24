package hpa

import autoscalingv2 "k8s.io/api/autoscaling/v2"

// ScaleTarget is the object an HPA scales. The workloads table joins it at
// serve to mark which workloads an HPA manages.
type ScaleTarget struct {
	Namespace  string
	APIVersion string
	Kind       string
	Name       string
}

// BuildScaleTarget projects an HPA's scale target.
func BuildScaleTarget(h *autoscalingv2.HorizontalPodAutoscaler) ScaleTarget {
	if h == nil {
		return ScaleTarget{}
	}
	ref := h.Spec.ScaleTargetRef
	return ScaleTarget{Namespace: h.Namespace, APIVersion: ref.APIVersion, Kind: ref.Kind, Name: ref.Name}
}
