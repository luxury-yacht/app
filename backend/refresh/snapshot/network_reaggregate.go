// backend/refresh/snapshot/network_reaggregate.go
//
// The serve-side re-join for the cut Service kind. Service is projected at intake into an
// OWN-fields NetworkSummary by service.BuildStreamSummary with NIL slices, so the row's
// Details carries the own-fields prefix (Type/ClusterIP/Ports) but NOT the endpoint-join
// "Addresses: N" segment. At serve the namespace-network domain re-joins the Service's
// correlated EndpointSlices (read from the projected EndpointSlice store) onto the own-row,
// reproducing the exact NetworkSummary service.BuildStreamSummary would build with those
// slices (proven byte-identical in network_reaggregate_test.go).
//
// This mirrors reaggregateWorkloadSummary: the own-row supplies every field read from the
// typed object alone (Kind/Name/Namespace/Age/AgeTimestamp + the own-fields Details prefix),
// and the re-join overwrites only the join-affected field — Details' Addresses segment.
package snapshot

import (
	"github.com/luxury-yacht/app/backend/resources/service"
)

// reaggregateServiceSummary overlays the Service's EndpointSlice endpoint-count join onto a
// projected Service own-row, returning the full NetworkSummary the typed
// service.BuildStreamSummary would produce. The own-row's Details is the own-fields prefix
// (built with nil slices, so it never carries the Addresses segment); this re-join appends
// the Addresses segment for the ready endpoint count, using the SAME
// service.AppendAddressesDetail the typed path uses, so the result is byte-identical.
//
// readyEndpointCount is the sum of ready endpoint addresses across the Service's correlated
// EndpointSlices, accumulated at serve from each slice's projected join fact (the bundle
// Aggregate half). Because endpointsFromSlices aggregates each slice independently and
// additively, the per-slice sum equals service.ReadyEndpointCount over all the slices.
func reaggregateServiceSummary(own NetworkSummary, readyEndpointCount int) NetworkSummary {
	summary := own
	summary.Details = service.AppendAddressesDetail(own.Details, readyEndpointCount)
	return summary
}
