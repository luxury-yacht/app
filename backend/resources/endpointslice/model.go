/*
 * backend/resources/endpointslice/model.go
 *
 * EndpointSlice resource model: the single definition of an EndpointSlice's
 * intrinsic fields + status presentation. Detail/object-map/streaming projections
 * derive from it. Shared model helpers are reused from resourcemodel (exported base).
 */

package endpointslice

import (
	"strconv"
	"strings"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	discoveryv1 "k8s.io/api/discovery/v1"
)

// BuildResourceModel builds the EndpointSlice resource model. Facts are owned by
// this package (endpointslice.Facts); the shared ResourceModel carries identity +
// status, and callers needing facts use BuildFacts.
func BuildResourceModel(clusterID string, slice *discoveryv1.EndpointSlice) resourcemodel.ResourceModel {
	facts := BuildFacts(clusterID, slice)
	status := statusPresentation(slice, facts)
	return resourcemodel.KubernetesResourceModel(clusterID, "discovery.k8s.io", "v1", "EndpointSlice", "endpointslices", resourcemodel.ResourceScopeNamespaced, slice.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the EndpointSlice facts from the raw object.
func BuildFacts(clusterID string, slice *discoveryv1.EndpointSlice) Facts {
	facts := Facts{
		AddressType: string(slice.AddressType),
		Ports:       portFacts(slice.Ports),
	}
	if serviceName := slice.Labels[discoveryv1.LabelServiceName]; serviceName != "" {
		link := resourcemodel.NewDisplayResourceLink(clusterID, "", "v1", "Service", "services", slice.Namespace, serviceName)
		facts.Service = &link
	}
	for _, endpoint := range slice.Endpoints {
		addresses := addressFacts(clusterID, slice.Namespace, endpoint)
		if resourcemodel.EndpointReady(endpoint) {
			facts.ReadyAddresses = append(facts.ReadyAddresses, addresses...)
		} else {
			facts.NotReadyAddresses = append(facts.NotReadyAddresses, addresses...)
		}
	}
	return facts
}

func statusPresentation(slice *discoveryv1.EndpointSlice, facts Facts) resourcemodel.ResourceStatusPresentation {
	ready := len(facts.ReadyAddresses)
	notReady := len(facts.NotReadyAddresses)
	state := strconv.Itoa(ready)
	signals := []resourcemodel.ResourceStatusSignal{
		{Type: resourcemodel.StatusSignalResourceState, Name: "readyAddresses", Status: state},
		{Type: resourcemodel.StatusSignalResourceState, Name: "notReadyAddresses", Status: strconv.Itoa(notReady)},
	}
	lifecycle := resourcemodel.ObjectLifecycle(slice.ObjectMeta)
	if status, ok := resourcemodel.DeletingObjectStatus(slice.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}
	if notReady > 0 && ready == 0 {
		return resourcemodel.ObjectSourceStatus("No ready addresses", state, "", "", "warning", signals, lifecycle)
	}
	if notReady > 0 {
		return resourcemodel.ObjectSourceStatus(resourcemodel.CountLabel(ready, "ready address", "ready addresses"), state, "", "", "warning", signals, lifecycle)
	}
	return resourcemodel.ObjectSourceStatus(resourcemodel.CountLabel(ready, "ready address", "ready addresses"), state, "", "", "ready", signals, lifecycle)
}

func addressFacts(clusterID, fallbackNamespace string, endpoint discoveryv1.Endpoint) []EndpointAddressFacts {
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
				group, version = resourcemodel.SplitAPIVersion(apiVersion)
			}
			namespace := endpoint.TargetRef.Namespace
			if namespace == "" {
				namespace = fallbackNamespace
			}
			if version == "" {
				link := resourcemodel.NewDisplayResourceLink(clusterID, group, version, endpoint.TargetRef.Kind, "", namespace, endpoint.TargetRef.Name)
				if link.Display != nil {
					link.Display.UID = string(endpoint.TargetRef.UID)
				}
				next.TargetRef = &link
			} else {
				link := resourcemodel.NewNamespacedResourceLink(clusterID, group, version, endpoint.TargetRef.Kind, "", namespace, endpoint.TargetRef.Name, string(endpoint.TargetRef.UID))
				next.TargetRef = &link
			}
		}
		addresses = append(addresses, next)
	}
	return addresses
}

func portFacts(ports []discoveryv1.EndpointPort) []EndpointPortFacts {
	if len(ports) == 0 {
		return nil
	}
	facts := make([]EndpointPortFacts, 0, len(ports))
	for _, port := range ports {
		next := EndpointPortFacts{Port: portNumber(port)}
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

func portNumber(port discoveryv1.EndpointPort) int32 {
	if port.Port != nil {
		return *port.Port
	}
	return 0
}
