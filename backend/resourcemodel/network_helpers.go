package resourcemodel

import (
	"strconv"
	"strings"

	discoveryv1 "k8s.io/api/discovery/v1"
)

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
