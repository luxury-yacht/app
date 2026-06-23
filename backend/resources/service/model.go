/*
 * backend/resources/service/model.go
 *
 * Service resource model: the single definition of a Service's intrinsic fields +
 * status presentation. Detail/object-map/streaming projections derive from it.
 * Shared model helpers are reused from resourcemodel (exported network base).
 */

package service

import (
	"fmt"
	"sort"
	"strconv"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
)

// BuildResourceModel builds the Service resource model. Facts are owned by this
// package (service.Facts); the shared ResourceModel carries identity + status,
// and callers needing facts use BuildFacts.
func BuildResourceModel(clusterID string, svc *corev1.Service, slices []*discoveryv1.EndpointSlice) resourcemodel.ResourceModel {
	facts := BuildFacts(svc, slices)
	status := statusPresentation(svc, facts)
	return resourcemodel.NetworkResourceModel(clusterID, "", "v1", "Service", "services", resourcemodel.ResourceScopeNamespaced, svc.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the Service facts from the raw object and its EndpointSlices.
func BuildFacts(svc *corev1.Service, slices []*discoveryv1.EndpointSlice) Facts {
	endpoints, ready, notReady := endpointsFromSlices(slices)
	facts := Facts{
		Type:                  string(svc.Spec.Type),
		ClusterIP:             svc.Spec.ClusterIP,
		ClusterIPs:            append([]string(nil), svc.Spec.ClusterIPs...),
		ExternalIPs:           append([]string(nil), svc.Spec.ExternalIPs...),
		LoadBalancerAddresses: loadBalancerAddresses(svc.Status.LoadBalancer.Ingress),
		ExternalName:          svc.Spec.ExternalName,
		SessionAffinity:       string(svc.Spec.SessionAffinity),
		Selector:              resourcemodel.CopyStringMap(svc.Spec.Selector),
		Endpoints:             endpoints,
		ReadyEndpointCount:    ready,
		NotReadyEndpointCount: notReady,
		TotalEndpointCount:    ready + notReady,
	}
	if svc.Spec.SessionAffinityConfig != nil &&
		svc.Spec.SessionAffinityConfig.ClientIP != nil &&
		svc.Spec.SessionAffinityConfig.ClientIP.TimeoutSeconds != nil {
		facts.SessionAffinityTimeout = *svc.Spec.SessionAffinityConfig.ClientIP.TimeoutSeconds
	}
	for _, port := range svc.Spec.Ports {
		next := PortFacts{
			Name:       port.Name,
			Protocol:   string(port.Protocol),
			Port:       port.Port,
			TargetPort: port.TargetPort.String(),
		}
		if svc.Spec.Type == corev1.ServiceTypeNodePort || svc.Spec.Type == corev1.ServiceTypeLoadBalancer {
			next.NodePort = port.NodePort
		}
		facts.Ports = append(facts.Ports, next)
	}
	return facts
}

func statusPresentation(svc *corev1.Service, facts Facts) resourcemodel.ResourceStatusPresentation {
	state := facts.Type
	if state == "" {
		state = string(corev1.ServiceTypeClusterIP)
	}
	signals := []resourcemodel.ResourceStatusSignal{
		{Type: resourcemodel.StatusSignalResourceState, Name: "spec.type", Status: state},
		{Type: resourcemodel.StatusSignalResourceState, Name: "readyEndpoints", Status: strconv.Itoa(facts.ReadyEndpointCount)},
		{Type: resourcemodel.StatusSignalResourceState, Name: "notReadyEndpoints", Status: strconv.Itoa(facts.NotReadyEndpointCount)},
	}
	lifecycle := resourcemodel.NetworkLifecycle(svc.ObjectMeta)
	if status, ok := resourcemodel.DeletingNetworkStatus(svc.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}

	if svc.Spec.Type == corev1.ServiceTypeLoadBalancer {
		if len(facts.LoadBalancerAddresses) > 0 {
			return resourcemodel.NetworkSourceStatus("LoadBalancer active", state, "", "ready", signals, lifecycle)
		}
		return resourcemodel.NetworkSourceStatus("LoadBalancer pending", state, "", "warning", signals, lifecycle)
	}
	if svc.Spec.Type == corev1.ServiceTypeExternalName {
		return resourcemodel.NetworkSourceStatus("ExternalName", state, "", "ready", signals, lifecycle)
	}
	if facts.ReadyEndpointCount > 0 {
		return resourcemodel.NetworkSourceStatus(fmt.Sprintf("%s, %s", state, resourcemodel.CountLabel(facts.ReadyEndpointCount, "endpoint", "endpoints")), state, "", "ready", signals, lifecycle)
	}
	if facts.TotalEndpointCount > 0 {
		return resourcemodel.NetworkSourceStatus(fmt.Sprintf("%s, no ready endpoints", state), state, "", "warning", signals, lifecycle)
	}
	return resourcemodel.NetworkSourceStatus(state, state, "", "ready", signals, lifecycle)
}

// ReadyEndpointCount returns the number of ready endpoint addresses across the Service's
// EndpointSlices, using the SAME aggregation as BuildFacts (endpointsFromSlices). It is the
// one field of the Service stream row that depends on the EndpointSlice join, so the
// namespace-network owned-reflector serve-side re-join derives it here rather than
// reimplementing endpoint-readiness logic.
func ReadyEndpointCount(slices []*discoveryv1.EndpointSlice) int {
	_, ready, _ := endpointsFromSlices(slices)
	return ready
}

// endpointsFromSlices aggregates ready/not-ready endpoint addresses from the
// Service's EndpointSlices into "ip:port" strings + ready/not-ready counts.
func endpointsFromSlices(slices []*discoveryv1.EndpointSlice) (endpoints []string, readyCount, notReadyCount int) {
	for _, slice := range slices {
		if slice == nil || len(slice.Ports) == 0 {
			continue
		}
		for _, endpoint := range slice.Endpoints {
			if len(endpoint.Addresses) == 0 {
				continue
			}
			if !resourcemodel.EndpointReady(endpoint) {
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

func endpointPortNumber(port discoveryv1.EndpointPort) int32 {
	if port.Port == nil {
		return 0
	}
	return *port.Port
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
