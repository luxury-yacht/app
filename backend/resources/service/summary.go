/*
 * backend/resources/service/summary.go
 *
 * Service streaming summary projection, co-located with its model. Produces the
 * one-line description used by snapshot network summaries.
 */

package service

import (
	"fmt"
	"strings"
)

// DescribeSummary renders the one-line Service summary from its facts. The own-fields
// prefix (Type/ClusterIP/Ports) is independent of the Service's EndpointSlices; the
// Addresses segment is the ONLY endpoint-join part, so it is applied by
// AppendAddressesDetail — the single definition the namespace-network serve-side re-join
// reuses to overlay the endpoint count onto a Service own-row built with nil slices.
func DescribeSummary(facts Facts) string {
	parts := []string{fmt.Sprintf("Type: %s", facts.Type)}
	clusterIP := facts.ClusterIP
	if clusterIP == "" {
		clusterIP = "None"
	}
	parts = append(parts, fmt.Sprintf("ClusterIP: %s", clusterIP))
	if len(facts.Ports) > 0 {
		portStrings := make([]string, 0, len(facts.Ports))
		for _, port := range facts.Ports {
			portStrings = append(portStrings, fmt.Sprintf("%d/%s", port.Port, port.Protocol))
		}
		parts = append(parts, fmt.Sprintf("Ports: %s", strings.Join(portStrings, ",")))
	}
	return AppendAddressesDetail(strings.Join(parts, ", "), facts.ReadyEndpointCount)
}

// AppendAddressesDetail appends the Service summary's Addresses segment to the own-fields
// detail prefix when there are ready endpoints, returning the prefix unchanged otherwise.
// It is the single definition of the endpoint-join part of the one-line summary, shared by
// DescribeSummary (full typed path) and the namespace-network owned-reflector serve-side
// re-join (which re-derives the segment from the projected EndpointSlice store).
func AppendAddressesDetail(prefix string, readyEndpointCount int) string {
	if readyEndpointCount > 0 {
		return prefix + fmt.Sprintf(", Addresses: %d", readyEndpointCount)
	}
	return prefix
}
