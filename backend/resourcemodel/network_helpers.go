package resourcemodel

import (
	"strconv"
	"strings"
	"time"

	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func NetworkResourceModel(
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

func DeletingNetworkStatus(meta metav1.ObjectMeta, state string, signals []ResourceStatusSignal, lifecycle ResourceLifecycle) (ResourceStatusPresentation, bool) {
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

func NetworkSourceStatus(label, state, reason, presentation string, signals []ResourceStatusSignal, lifecycle ResourceLifecycle) ResourceStatusPresentation {
	return ResourceStatusPresentation{
		Label:        label,
		State:        state,
		Presentation: presentation,
		Reason:       reason,
		Signals:      signals,
		Lifecycle:    lifecycle,
	}
}

func NetworkLifecycle(meta metav1.ObjectMeta) ResourceLifecycle {
	return ResourceLifecycle{
		Deleting:         meta.DeletionTimestamp != nil,
		FinalizerBlocked: meta.DeletionTimestamp != nil && len(meta.Finalizers) > 0,
	}
}

func namespacedResourceLink(clusterID, group, version, kind, resource, namespace, name, uid string) ResourceLink {
	return NewNamespacedResourceLink(clusterID, group, version, kind, resource, namespace, name, uid)
}

func ClusterResourceLink(clusterID, group, version, kind, resource, name, uid string) ResourceLink {
	return NewClusterResourceLink(clusterID, group, version, kind, resource, name, uid)
}

func displayResourceLink(clusterID, group, version, kind, resource, namespace, name string) ResourceLink {
	return NewDisplayResourceLink(clusterID, group, version, kind, resource, namespace, name)
}

func EndpointReady(endpoint discoveryv1.Endpoint) bool {
	if endpoint.Conditions.Ready != nil && !*endpoint.Conditions.Ready {
		return false
	}
	if endpoint.Conditions.Serving != nil && !*endpoint.Conditions.Serving {
		return false
	}
	if endpoint.Conditions.Terminating != nil && *endpoint.Conditions.Terminating {
		return false
	}
	return true
}

// endpointAddressFacts/endpointPortFacts + the EndpointSliceFacts types moved to
// resources/endpointslice. EndpointReady stays here, shared by both the
// EndpointSlice model and the Service detail's endpoint summarization.

func SplitAPIVersion(apiVersion string) (string, string) {
	if apiVersion == "" {
		return "", ""
	}
	parts := strings.Split(apiVersion, "/")
	if len(parts) == 1 {
		return "", parts[0]
	}
	return parts[0], parts[1]
}





func CountLabel(count int, singular, plural string) string {
	if count == 1 {
		return "1 " + singular
	}
	return strconv.Itoa(count) + " " + plural
}

func NetworkDefaultClassAnnotation(annotations map[string]string) (string, string) {
	key := "ingressclass.kubernetes.io/is-default-class"
	if value, ok := annotations[key]; ok {
		return key, value
	}
	return "", ""
}

// CopyStringMap returns a shallow copy of a string map (nil for empty input). It is
// a foundational helper shared across the resource model (formerly lived in node.go).
func CopyStringMap(input map[string]string) map[string]string {
	if len(input) == 0 {
		return nil
	}
	output := make(map[string]string, len(input))
	for key, value := range input {
		output[key] = value
	}
	return output
}
