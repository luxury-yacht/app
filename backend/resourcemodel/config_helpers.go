package resourcemodel

import (
	"fmt"
	"sort"

	corev1 "k8s.io/api/core/v1"
)

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
