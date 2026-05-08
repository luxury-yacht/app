package resourcemodel

import (
	"fmt"
	"strconv"

	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
)

func BuildServiceResourceModel(clusterID string, service *corev1.Service, slices []*discoveryv1.EndpointSlice) ResourceModel {
	facts := BuildServiceFacts(service, slices)
	status := BuildServiceStatusPresentation(service, facts)
	return networkResourceModel(clusterID, "", "v1", "Service", "services", ResourceScopeNamespaced, service.ObjectMeta, status, ResourceFacts{Service: &facts})
}

func BuildServiceFacts(service *corev1.Service, slices []*discoveryv1.EndpointSlice) ServiceFacts {
	endpoints, ready, notReady := serviceEndpointsFromSlices(slices)
	facts := ServiceFacts{
		Type:                  string(service.Spec.Type),
		ClusterIP:             service.Spec.ClusterIP,
		ClusterIPs:            append([]string(nil), service.Spec.ClusterIPs...),
		ExternalIPs:           append([]string(nil), service.Spec.ExternalIPs...),
		LoadBalancerAddresses: loadBalancerAddresses(service.Status.LoadBalancer.Ingress),
		ExternalName:          service.Spec.ExternalName,
		SessionAffinity:       string(service.Spec.SessionAffinity),
		Selector:              copyStringMap(service.Spec.Selector),
		Endpoints:             endpoints,
		ReadyEndpointCount:    ready,
		NotReadyEndpointCount: notReady,
		TotalEndpointCount:    ready + notReady,
	}
	if service.Spec.SessionAffinityConfig != nil &&
		service.Spec.SessionAffinityConfig.ClientIP != nil &&
		service.Spec.SessionAffinityConfig.ClientIP.TimeoutSeconds != nil {
		facts.SessionAffinityTimeout = *service.Spec.SessionAffinityConfig.ClientIP.TimeoutSeconds
	}
	for _, port := range service.Spec.Ports {
		next := ServicePortFacts{
			Name:       port.Name,
			Protocol:   string(port.Protocol),
			Port:       port.Port,
			TargetPort: port.TargetPort.String(),
		}
		if service.Spec.Type == corev1.ServiceTypeNodePort || service.Spec.Type == corev1.ServiceTypeLoadBalancer {
			next.NodePort = port.NodePort
		}
		facts.Ports = append(facts.Ports, next)
	}
	return facts
}

func BuildServiceStatusPresentation(service *corev1.Service, facts ServiceFacts) ResourceStatusPresentation {
	state := facts.Type
	if state == "" {
		state = string(corev1.ServiceTypeClusterIP)
	}
	signals := []ResourceStatusSignal{
		{Type: StatusSignalResourceState, Name: "spec.type", Status: state},
		{Type: StatusSignalResourceState, Name: "readyEndpoints", Status: strconv.Itoa(facts.ReadyEndpointCount)},
		{Type: StatusSignalResourceState, Name: "notReadyEndpoints", Status: strconv.Itoa(facts.NotReadyEndpointCount)},
	}
	lifecycle := networkLifecycle(service.ObjectMeta)
	if status, ok := deletingNetworkStatus(service.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}

	if service.Spec.Type == corev1.ServiceTypeLoadBalancer {
		if len(facts.LoadBalancerAddresses) > 0 {
			return networkSourceStatus("LoadBalancer active", state, "", "ready", signals, lifecycle)
		}
		return networkSourceStatus("LoadBalancer pending", state, "", "warning", signals, lifecycle)
	}
	if service.Spec.Type == corev1.ServiceTypeExternalName {
		return networkSourceStatus("ExternalName", state, "", "ready", signals, lifecycle)
	}
	if facts.ReadyEndpointCount > 0 {
		return networkSourceStatus(fmt.Sprintf("%s, %s", state, countLabel(facts.ReadyEndpointCount, "endpoint", "endpoints")), state, "", "ready", signals, lifecycle)
	}
	if facts.TotalEndpointCount > 0 {
		return networkSourceStatus(fmt.Sprintf("%s, no ready endpoints", state), state, "", "warning", signals, lifecycle)
	}
	return networkSourceStatus(state, state, "", "ready", signals, lifecycle)
}
