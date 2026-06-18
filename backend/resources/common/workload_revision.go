package common

import (
	"context"
	"fmt"
	"sort"

	appsv1 "k8s.io/api/apps/v1"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
	"k8s.io/client-go/kubernetes"
	sigsyaml "sigs.k8s.io/yaml"
)

const (
	// RevisionAnnotation tracks the current rollout revision number on
	// ReplicaSets and Deployments.
	RevisionAnnotation = "deployment.kubernetes.io/revision"
	// ChangeCauseAnnotation records a human-readable description of what caused a
	// rollout revision.
	ChangeCauseAnnotation = "kubernetes.io/change-cause"
)

// WorkloadRevision describes one historical revision of a workload rollout. Each
// workload kind builds these from its own revision source (Deployment from
// ReplicaSets; StatefulSet/DaemonSet from ControllerRevisions); the action handler
// maps them to the wire DTO.
type WorkloadRevision struct {
	Revision    int64
	CreatedAt   string
	ChangeCause string
	Current     bool
	PodTemplate string
}

// IsOwnedBy reports whether any of the supplied owner references has the given UID.
func IsOwnedBy(refs []metav1.OwnerReference, uid types.UID) bool {
	for _, ref := range refs {
		if ref.UID == uid {
			return true
		}
	}
	return false
}

// MarshalPodTemplate serialises a pod template spec to YAML via sigs.k8s.io/yaml
// (round-tripped through JSON so field names match the Kubernetes API).
func MarshalPodTemplate(template *corev1.PodTemplateSpec) (string, error) {
	if template == nil {
		return "", nil
	}
	b, err := sigsyaml.Marshal(template)
	if err != nil {
		return "", err
	}
	return string(b), nil
}

// ControllerRevisionEntries lists the ControllerRevisions owned by ownerUID and
// projects each into a WorkloadRevision, using extract for the per-kind pod-template
// decoding. When currentRevisionName is non-empty (StatefulSet) the matching-named
// revision is marked Current; when empty (DaemonSet) the highest revision is.
func ControllerRevisionEntries(
	ctx context.Context,
	client kubernetes.Interface,
	namespace string,
	ownerUID types.UID,
	currentRevisionName string,
	extract func(*appsv1.ControllerRevision) (string, error),
) ([]WorkloadRevision, error) {
	crList, err := client.AppsV1().ControllerRevisions(namespace).List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list controllerrevisions in %s: %w", namespace, err)
	}

	var entries []WorkloadRevision
	for i := range crList.Items {
		cr := &crList.Items[i]
		if !IsOwnedBy(cr.OwnerReferences, ownerUID) {
			continue
		}
		podTemplateYAML, err := extract(cr)
		if err != nil {
			return nil, fmt.Errorf("failed to extract pod template from controllerrevision %s: %w", cr.Name, err)
		}
		entries = append(entries, WorkloadRevision{
			Revision:    cr.Revision,
			CreatedAt:   cr.CreationTimestamp.UTC().Format("2006-01-02T15:04:05Z"),
			ChangeCause: cr.Annotations[ChangeCauseAnnotation],
			Current:     currentRevisionName != "" && cr.Name == currentRevisionName,
			PodTemplate: podTemplateYAML,
		})
	}

	sort.Slice(entries, func(i, j int) bool { return entries[i].Revision > entries[j].Revision })

	// For DaemonSets (no currentRevisionName) the highest revision — first after the
	// descending sort — is the active one.
	if currentRevisionName == "" && len(entries) > 0 {
		entries[0].Current = true
	}

	return entries, nil
}
