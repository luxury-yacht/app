/*
 * backend/resources/endpointslice/summary.go
 *
 * Streaming-row summary description for EndpointSlice, co-located with the model.
 * Consumed by the snapshot streaming layer.
 */

package endpointslice

import (
	"fmt"
	"strings"
)

// DescribeSummary formats the EndpointSlice streaming-row detail string from its facts.
func DescribeSummary(facts Facts) string {
	parts := []string{"Slices: 1"}
	ready := len(facts.ReadyAddresses)
	notReady := len(facts.NotReadyAddresses)
	if ready > 0 {
		parts = append(parts, fmt.Sprintf("Ready addresses: %d", ready))
	}
	if notReady > 0 {
		parts = append(parts, fmt.Sprintf("Not Ready: %d", notReady))
	}
	return strings.Join(parts, ", ")
}
