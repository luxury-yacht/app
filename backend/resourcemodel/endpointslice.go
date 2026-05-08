package resourcemodel

import (
	"strconv"

	discoveryv1 "k8s.io/api/discovery/v1"
)

func BuildEndpointSliceResourceModel(clusterID string, slice *discoveryv1.EndpointSlice) ResourceModel {
	facts := BuildEndpointSliceFacts(clusterID, slice)
	status := BuildEndpointSliceStatusPresentation(slice, facts)
	return networkResourceModel(clusterID, "discovery.k8s.io", "v1", "EndpointSlice", "endpointslices", ResourceScopeNamespaced, slice.ObjectMeta, status, ResourceFacts{EndpointSlice: &facts})
}

func BuildEndpointSliceFacts(clusterID string, slice *discoveryv1.EndpointSlice) EndpointSliceFacts {
	facts := EndpointSliceFacts{
		AddressType: string(slice.AddressType),
		Ports:       endpointPortFacts(slice.Ports),
	}
	if serviceName := slice.Labels[discoveryv1.LabelServiceName]; serviceName != "" {
		link := displayResourceLink(clusterID, "", "v1", "Service", "services", slice.Namespace, serviceName)
		facts.Service = &link
	}
	for _, endpoint := range slice.Endpoints {
		addresses := endpointAddressFacts(clusterID, slice.Namespace, endpoint)
		if EndpointReady(endpoint) {
			facts.ReadyAddresses = append(facts.ReadyAddresses, addresses...)
		} else {
			facts.NotReadyAddresses = append(facts.NotReadyAddresses, addresses...)
		}
	}
	return facts
}

func BuildEndpointSliceStatusPresentation(slice *discoveryv1.EndpointSlice, facts EndpointSliceFacts) ResourceStatusPresentation {
	ready := len(facts.ReadyAddresses)
	notReady := len(facts.NotReadyAddresses)
	state := strconv.Itoa(ready)
	signals := []ResourceStatusSignal{
		{Type: StatusSignalResourceState, Name: "readyAddresses", Status: state},
		{Type: StatusSignalResourceState, Name: "notReadyAddresses", Status: strconv.Itoa(notReady)},
	}
	lifecycle := networkLifecycle(slice.ObjectMeta)
	if status, ok := deletingNetworkStatus(slice.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}
	if notReady > 0 && ready == 0 {
		return networkSourceStatus("No ready addresses", state, "", "warning", signals, lifecycle)
	}
	if notReady > 0 {
		return networkSourceStatus(countLabel(ready, "ready address", "ready addresses"), state, "", "warning", signals, lifecycle)
	}
	return networkSourceStatus(countLabel(ready, "ready address", "ready addresses"), state, "", "ready", signals, lifecycle)
}
