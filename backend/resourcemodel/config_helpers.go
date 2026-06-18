package resourcemodel

import (
	"fmt"
	"sort"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func ConfigResourceModel(
	clusterID, kind, resource string,
	meta metav1.ObjectMeta,
	status ResourceStatusPresentation,
	facts ResourceFacts,
) ResourceModel {
	return ResourceModel{
		Ref: ResourceRef{
			ClusterID: clusterID,
			Group:     "",
			Version:   "v1",
			Kind:      kind,
			Resource:  resource,
			Namespace: meta.Namespace,
			Name:      meta.Name,
			UID:       string(meta.UID),
		},
		Source: ResourceSourceKubernetes,
		Scope:  ResourceScopeNamespaced,
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

func DeletingConfigStatus(meta metav1.ObjectMeta, state string, signals []ResourceStatusSignal, lifecycle ResourceLifecycle) (ResourceStatusPresentation, bool) {
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

func ConfigSourceStatus(label, state, reason, presentation string, signals []ResourceStatusSignal, lifecycle ResourceLifecycle) ResourceStatusPresentation {
	return ResourceStatusPresentation{
		Label:        label,
		State:        state,
		Presentation: presentation,
		Reason:       reason,
		Signals:      signals,
		Lifecycle:    lifecycle,
	}
}

func ConfigLifecycle(meta metav1.ObjectMeta) ResourceLifecycle {
	return ResourceLifecycle{
		Deleting:         meta.DeletionTimestamp != nil,
		FinalizerBlocked: meta.DeletionTimestamp != nil && len(meta.Finalizers) > 0,
	}
}

func ItemCountLabel(count int) string {
	if count == 1 {
		return "1 item"
	}
	return fmt.Sprintf("%d items", count)
}

func KeyCountLabel(count int) string {
	if count == 1 {
		return "1 key"
	}
	return fmt.Sprintf("%d keys", count)
}

func SortedStringMapKeys(values map[string]string) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func SortedBytesMapKeys(values map[string][]byte) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}

func podResourceLink(clusterID string, pod corev1.Pod) ResourceLink {
	return NewNamespacedResourceLink(
		clusterID,
		"",
		"v1",
		"Pod",
		"pods",
		pod.Namespace,
		pod.Name,
		string(pod.UID),
	)
}

func SortResourceLinksByObjectName(links []ResourceLink) {
	sort.SliceStable(links, func(i, j int) bool {
		left := resourceLinkSortKey(links[i])
		right := resourceLinkSortKey(links[j])
		if left.namespace != right.namespace {
			return left.namespace < right.namespace
		}
		if left.name != right.name {
			return left.name < right.name
		}
		return left.kind < right.kind
	})
}

func ResourceLinkNames(links []ResourceLink) []string {
	if len(links) == 0 {
		return nil
	}
	names := make([]string, 0, len(links))
	for _, link := range links {
		if link.Ref != nil && link.Ref.Name != "" {
			names = append(names, link.Ref.Name)
			continue
		}
		if link.Display != nil && link.Display.Name != "" {
			names = append(names, link.Display.Name)
		}
	}
	if len(names) == 0 {
		return nil
	}
	sort.Strings(names)
	return names
}

type resourceLinkKey struct {
	namespace string
	name      string
	kind      string
}

func resourceLinkSortKey(link ResourceLink) resourceLinkKey {
	if link.Ref != nil {
		return resourceLinkKey{namespace: link.Ref.Namespace, name: link.Ref.Name, kind: link.Ref.Kind}
	}
	if link.Display != nil {
		return resourceLinkKey{namespace: link.Display.Namespace, name: link.Display.Name, kind: link.Display.Kind}
	}
	return resourceLinkKey{}
}
