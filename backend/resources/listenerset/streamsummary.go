/*
 * backend/resources/listenerset/streamsummary.go
 *
 * ListenerSet's stream-summary builder, producing the neutral streamrows.NetworkSummary
 * row (namespace-network). No snapshot import.
 */

package listenerset

import (
	"strconv"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// BuildStreamSummary builds the namespace-network row for one ListenerSet.
func BuildStreamSummary(meta streamrows.ClusterMeta, listenerSet *gatewayv1.ListenerSet) streamrows.NetworkSummary {
	if listenerSet == nil {
		return streamrows.NetworkSummary{}
	}
	facts := BuildFacts(meta.ClusterID, listenerSet)
	details := []resourcemodel.DetailSegment{
		{Slot: resourcemodel.DetailSlotReference, Value: resourcemodel.ResourceLinkName(facts.ParentRef), Link: &facts.ParentRef},
	}
	if addresses := listenerAddressSegment(facts.Listeners); addresses.Value != "" {
		details = append(details, addresses)
	}
	details = append(details, resourcemodel.DetailSegment{Slot: resourcemodel.DetailSlotCounts, Label: "Listeners", Value: strconv.Itoa(len(facts.Listeners))})
	return streamrows.NewNetworkSummary(meta, Identity, listenerSet, details)
}

// listenerAddressSegment fills the address slot from the listeners: distinct
// hostnames when any listener names one, otherwise the compact port list.
func listenerAddressSegment(listeners []resourcemodel.GatewayListenerFacts) resourcemodel.DetailSegment {
	hostnames := []string{}
	seen := map[string]bool{}
	for _, listener := range listeners {
		if listener.Hostname != "" && !seen[listener.Hostname] {
			seen[listener.Hostname] = true
			hostnames = append(hostnames, listener.Hostname)
		}
	}
	if len(hostnames) > 0 {
		return resourcemodel.ListDetailSegment(resourcemodel.DetailSlotAddress, hostnames)
	}
	ports := make([]resourcemodel.PortProtocol, 0, len(listeners))
	for _, listener := range listeners {
		ports = append(ports, resourcemodel.PortProtocol{Port: listener.Port, Protocol: listener.Protocol})
	}
	if summary := resourcemodel.FormatPortsSummary(ports); summary != "" {
		return resourcemodel.DetailSegment{Slot: resourcemodel.DetailSlotAddress, Value: summary}
	}
	return resourcemodel.DetailSegment{}
}
