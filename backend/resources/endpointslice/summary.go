/*
 * backend/resources/endpointslice/summary.go
 *
 * Streaming-row summary segments for EndpointSlice, co-located with the model.
 * Consumed by the snapshot streaming layer.
 */

package endpointslice

import (
	"strconv"

	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// SummarySegments renders the EndpointSlice summary segments from its facts:
// the owning Service as an openable reference (when the service-name label is
// present), the ready address count, and — only when present — the not-ready
// count with a warning presentation.
func SummarySegments(facts Facts) []resourcemodel.DetailSegment {
	segments := []resourcemodel.DetailSegment{}
	if facts.Service != nil {
		if name := resourcemodel.ResourceLinkName(*facts.Service); name != "" {
			segments = append(segments, resourcemodel.DetailSegment{Slot: resourcemodel.DetailSlotReference, Label: "Service", Value: name, Link: facts.Service})
		}
	}
	if len(facts.ReadyAddresses) > 0 {
		ips := make([]string, 0, len(facts.ReadyAddresses))
		for _, address := range facts.ReadyAddresses {
			if address.IP != "" {
				ips = append(ips, address.IP)
			}
		}
		if addresses := resourcemodel.ListDetailSegment(resourcemodel.DetailSlotAddress, "Addresses", ips); addresses.Value != "" {
			segments = append(segments, addresses)
		}
	}
	segments = append(segments, resourcemodel.DetailSegment{Slot: resourcemodel.DetailSlotCounts, Label: "Ready", Value: strconv.Itoa(len(facts.ReadyAddresses))})
	if notReady := len(facts.NotReadyAddresses); notReady > 0 {
		segments = append(segments, resourcemodel.DetailSegment{Slot: resourcemodel.DetailSlotCounts, Label: "Not ready", Value: strconv.Itoa(notReady), Presentation: "warning"})
	}
	return segments
}
