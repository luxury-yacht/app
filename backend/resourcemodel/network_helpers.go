package resourcemodel

import (
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func networkResourceModel(
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

func clusterResourceLink(clusterID, group, version, kind, resource, name, uid string) ResourceLink {
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

func endpointAddressFacts(clusterID, fallbackNamespace string, endpoint discoveryv1.Endpoint) []EndpointAddressFacts {
	addresses := make([]EndpointAddressFacts, 0, len(endpoint.Addresses))
	for _, address := range endpoint.Addresses {
		next := EndpointAddressFacts{IP: address}
		if endpoint.Hostname != nil {
			next.Hostname = *endpoint.Hostname
		}
		if endpoint.NodeName != nil {
			next.NodeName = *endpoint.NodeName
		}
		if endpoint.TargetRef != nil && endpoint.TargetRef.Kind != "" && endpoint.TargetRef.Name != "" {
			apiVersion := strings.TrimSpace(endpoint.TargetRef.APIVersion)
			group, version := "", ""
			if apiVersion != "" {
				group, version = splitAPIVersion(apiVersion)
			}
			namespace := endpoint.TargetRef.Namespace
			if namespace == "" {
				namespace = fallbackNamespace
			}
			if version == "" {
				link := NewDisplayResourceLink(clusterID, group, version, endpoint.TargetRef.Kind, "", namespace, endpoint.TargetRef.Name)
				if link.Display != nil {
					link.Display.UID = string(endpoint.TargetRef.UID)
				}
				next.TargetRef = &link
			} else {
				link := NewNamespacedResourceLink(clusterID, group, version, endpoint.TargetRef.Kind, "", namespace, endpoint.TargetRef.Name, string(endpoint.TargetRef.UID))
				next.TargetRef = &link
			}
		}
		addresses = append(addresses, next)
	}
	return addresses
}

func splitAPIVersion(apiVersion string) (string, string) {
	if apiVersion == "" {
		return "", ""
	}
	parts := strings.Split(apiVersion, "/")
	if len(parts) == 1 {
		return "", parts[0]
	}
	return parts[0], parts[1]
}

func endpointPortFacts(ports []discoveryv1.EndpointPort) []EndpointPortFacts {
	if len(ports) == 0 {
		return nil
	}
	facts := make([]EndpointPortFacts, 0, len(ports))
	for _, port := range ports {
		next := EndpointPortFacts{Port: endpointPortNumber(port)}
		if port.Name != nil {
			next.Name = *port.Name
		}
		if port.Protocol != nil {
			next.Protocol = string(*port.Protocol)
		}
		if port.AppProtocol != nil {
			next.AppProtocol = *port.AppProtocol
		}
		facts = append(facts, next)
	}
	return facts
}

func endpointPortNumber(port discoveryv1.EndpointPort) int32 {
	if port.Port != nil {
		return *port.Port
	}
	return 0
}

func serviceEndpointsFromSlices(slices []*discoveryv1.EndpointSlice) (endpoints []string, readyCount, notReadyCount int) {
	for _, slice := range slices {
		if slice == nil || len(slice.Ports) == 0 {
			continue
		}
		for _, endpoint := range slice.Endpoints {
			if len(endpoint.Addresses) == 0 {
				continue
			}
			if !EndpointReady(endpoint) {
				notReadyCount += len(endpoint.Addresses)
				continue
			}
			readyCount += len(endpoint.Addresses)
			for _, address := range endpoint.Addresses {
				for _, port := range slice.Ports {
					endpoints = append(endpoints, fmt.Sprintf("%s:%d", address, endpointPortNumber(port)))
				}
			}
		}
	}
	sort.Strings(endpoints)
	return endpoints, readyCount, notReadyCount
}

func loadBalancerAddresses(ingresses []corev1.LoadBalancerIngress) []string {
	addresses := make([]string, 0, len(ingresses))
	for _, ingress := range ingresses {
		if ingress.IP != "" {
			addresses = append(addresses, ingress.IP)
		} else if ingress.Hostname != "" {
			addresses = append(addresses, ingress.Hostname)
		}
	}
	sort.Strings(addresses)
	return addresses
}

func ingressLoadBalancerAddresses(ingresses []networkingv1.IngressLoadBalancerIngress) []string {
	addresses := make([]string, 0, len(ingresses))
	for _, ingress := range ingresses {
		if ingress.IP != "" {
			addresses = append(addresses, ingress.IP)
		} else if ingress.Hostname != "" {
			addresses = append(addresses, ingress.Hostname)
		}
	}
	sort.Strings(addresses)
	return addresses
}

func countLabel(count int, singular, plural string) string {
	if count == 1 {
		return "1 " + singular
	}
	return strconv.Itoa(count) + " " + plural
}

func networkDefaultClassAnnotation(annotations map[string]string) (string, string) {
	key := "ingressclass.kubernetes.io/is-default-class"
	if value, ok := annotations[key]; ok {
		return key, value
	}
	return "", ""
}
