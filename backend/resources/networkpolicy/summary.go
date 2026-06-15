/*
 * backend/resources/networkpolicy/summary.go
 *
 * Streaming-row summary description for NetworkPolicy, co-located with the model.
 * Consumed by the snapshot streaming layer (newNetworkSummary).
 */

package networkpolicy

import (
	"fmt"
	"strings"
)

// DescribeSummary formats the NetworkPolicy streaming-row detail string from its facts.
func DescribeSummary(facts Facts) string {
	if len(facts.PolicyTypes) == 0 {
		return "Policy types: Ingress"
	}
	return fmt.Sprintf("Policy types: %s", strings.Join(facts.PolicyTypes, ","))
}
