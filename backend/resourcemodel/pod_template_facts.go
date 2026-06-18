package resourcemodel

import corev1 "k8s.io/api/core/v1"

// PodTemplateFacts holds the pod-template fields that workload detail views need.
// It is the single extraction point for these fields so workload detail builders
// no longer reach into the raw object's Spec.Template themselves. The values are
// the raw sub-objects; resources-layer formatting (container/toleration display)
// operates on them.
type PodTemplateFacts struct {
	ServiceAccountName string              `json:"serviceAccountName,omitempty"`
	NodeSelector       map[string]string   `json:"nodeSelector,omitempty"`
	Tolerations        []corev1.Toleration `json:"tolerations,omitempty"`
	Containers         []corev1.Container  `json:"containers,omitempty"`
	InitContainers     []corev1.Container  `json:"initContainers,omitempty"`
}

// BuildPodTemplateFacts extracts the pod-template facts from a workload's template.
func BuildPodTemplateFacts(template corev1.PodTemplateSpec) PodTemplateFacts {
	return PodTemplateFacts{
		ServiceAccountName: template.Spec.ServiceAccountName,
		NodeSelector:       template.Spec.NodeSelector,
		Tolerations:        template.Spec.Tolerations,
		Containers:         template.Spec.Containers,
		InitContainers:     template.Spec.InitContainers,
	}
}
