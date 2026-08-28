/*
 * backend/resources/service/summary.go
 *
 * Service streaming summary projection, co-located with its model. Produces the
 * slotted Details segments used by snapshot network summaries.
 */

package service

import (
	"strconv"

	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// SummarySegments renders the Service summary segments from its facts: the
// service type (reference slot), the cluster IP and protocol-grouped ports
// (address slot), and the ready endpoint count (counts slot). The own-fields
// segments are independent of the Service's EndpointSlices; the Endpoints
// segment is the ONLY endpoint-join part, so it is applied by
// AppendEndpointsSegment — the single definition the namespace-network
// serve-side re-join reuses to overlay the endpoint count onto a Service
// own-row built with nil slices.
func SummarySegments(facts Facts) []resourcemodel.DetailSegment {
	segments := []resourcemodel.DetailSegment{}
	if facts.Type != "" {
		segments = append(segments, resourcemodel.DetailSegment{Slot: resourcemodel.DetailSlotReference, Value: facts.Type})
	}
	clusterIP := facts.ClusterIP
	if clusterIP == "" {
		clusterIP = "None"
	}
	segments = append(segments, resourcemodel.DetailSegment{Slot: resourcemodel.DetailSlotAddress, Value: clusterIP})
	if ports := formatSummaryPorts(facts.Ports); ports != "" {
		segments = append(segments, resourcemodel.DetailSegment{Slot: resourcemodel.DetailSlotAddress, Value: ports})
	}
	return AppendEndpointsSegment(segments, facts.ReadyEndpointCount)
}

// formatSummaryPorts renders the port list compactly via the shared
// resourcemodel.FormatPortsSummary grouping.
func formatSummaryPorts(ports []PortFacts) string {
	pairs := make([]resourcemodel.PortProtocol, 0, len(ports))
	for _, port := range ports {
		pairs = append(pairs, resourcemodel.PortProtocol{Port: port.Port, Protocol: port.Protocol})
	}
	return resourcemodel.FormatPortsSummary(pairs)
}

// AppendEndpointsSegment appends the Service summary's ready-endpoint count
// segment when there are ready endpoints, returning the input unchanged
// otherwise. It is the single definition of the endpoint-join part of the
// summary, shared by SummarySegments (full typed path) and the
// namespace-network owned-reflector serve-side re-join (which re-derives the
// segment from the projected EndpointSlice store). The append copies — the
// re-join runs on rows served from the shared maintained store, so writing into
// the input's backing array would corrupt concurrently served rows.
func AppendEndpointsSegment(segments []resourcemodel.DetailSegment, readyEndpointCount int) []resourcemodel.DetailSegment {
	if readyEndpointCount <= 0 {
		return segments
	}
	return resourcemodel.AppendDetailSegment(segments, resourcemodel.DetailSegment{
		Slot:  resourcemodel.DetailSlotCounts,
		Label: "Endpoints",
		Value: strconv.Itoa(readyEndpointCount),
	})
}
