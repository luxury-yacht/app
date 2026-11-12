package hpa

import (
	"strings"

	autoscalingv2 "k8s.io/api/autoscaling/v2"
)

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

// TargetKey identifies the workload an HPA controls. The HPA controller finds its
// target by group and kind and ignores the version, so the version is deliberately
// not part of the key. Every check of whether a workload has an HPA uses this, so the
// tables, the object map, and the scale guard cannot disagree.
func TargetKey(namespace, group, kind, name string) string {
	return strings.Join([]string{
		strings.TrimSpace(namespace),
		strings.TrimSpace(group),
		strings.TrimSpace(kind),
		strings.TrimSpace(name),
	}, "\x00")
}
