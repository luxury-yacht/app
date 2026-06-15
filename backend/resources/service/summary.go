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

// DescribeSummary renders the one-line Service summary from its facts.
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
	if facts.ReadyEndpointCount > 0 {
		parts = append(parts, fmt.Sprintf("Addresses: %d", facts.ReadyEndpointCount))
	}
	return strings.Join(parts, ", ")
}
