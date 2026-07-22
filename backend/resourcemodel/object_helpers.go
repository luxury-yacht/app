package resourcemodel

import (
	"time"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// KubernetesResourceModel builds the canonical ResourceModel for a Kubernetes
// object: full Ref identity, copied metadata, and the supplied status/facts.
// Every kind package builds its model through this one constructor (directly or
// via a group-baking adapter like RBACResourceModel).
func KubernetesResourceModel(
	clusterID, group, version, kind, resource string,
	scope ResourceScope,
	meta metav1.ObjectMeta,
	status ResourceStatusPresentation,
	facts ResourceFacts,
) ResourceModel {
	return ResourceModel{
		Ref: ResourceRef{
			ClusterID: clusterID,
			Group:     group,
			Version:   version,
			Kind:      kind,
			Resource:  resource,
			Namespace: meta.Namespace,
			Name:      meta.Name,
			UID:       string(meta.UID),
		},
		Source: ResourceSourceKubernetes,
		Scope:  scope,
		Metadata: ResourceMetadata{
			Labels:            CopyStringMap(meta.Labels),
			Annotations:       CopyStringMap(meta.Annotations),
			CreationTimestamp: meta.CreationTimestamp,
			ResourceVersion:   meta.ResourceVersion,
			Finalizers:        append([]string(nil), meta.Finalizers...),
		},
		Status: status,
		Facts:  facts,
	}
}

// DeletingObjectStatus returns the shared Terminating presentation when the
// object carries a deletion timestamp, appending the deletion signal.
func DeletingObjectStatus(meta metav1.ObjectMeta, state string, signals []ResourceStatusSignal, lifecycle ResourceLifecycle) (ResourceStatusPresentation, bool) {
	if meta.DeletionTimestamp == nil {
		return ResourceStatusPresentation{}, false
	}
	deletionTimestamp := meta.DeletionTimestamp.Time.Format(time.RFC3339)
	return ResourceStatusPresentation{
		Label:        "Terminating",
		State:        state,
		Presentation: "terminating",
		Reason:       "DeletionTimestamp",
		Signals: append(signals, ResourceStatusSignal{
			Type:   StatusSignalDeletion,
			Name:   "metadata.deletionTimestamp",
			Status: deletionTimestamp,
		}),
		Lifecycle: lifecycle,
	}, true
}

// ObjectSourceStatus assembles a ResourceStatusPresentation from its parts.
func ObjectSourceStatus(label, state, reason, message, presentation string, signals []ResourceStatusSignal, lifecycle ResourceLifecycle) ResourceStatusPresentation {
	return ResourceStatusPresentation{
		Label:        label,
		State:        state,
		Presentation: presentation,
		Reason:       reason,
		Message:      message,
		Signals:      signals,
		Lifecycle:    lifecycle,
	}
}

// ObjectLifecycle derives the deletion lifecycle flags from object metadata.
func ObjectLifecycle(meta metav1.ObjectMeta) ResourceLifecycle {
	return ResourceLifecycle{
		Deleting:         meta.DeletionTimestamp != nil,
		FinalizerBlocked: meta.DeletionTimestamp != nil && len(meta.Finalizers) > 0,
	}
}
