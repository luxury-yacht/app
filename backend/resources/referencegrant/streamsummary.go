/*
 * backend/resources/referencegrant/streamsummary.go
 *
 * ReferenceGrant's stream-summary builder, producing the neutral
 * streamrows.NetworkSummary row (namespace-network). No snapshot import.
 */

package referencegrant

import (
	"strconv"
	"strings"

	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// BuildStreamSummary builds the namespace-network row for one ReferenceGrant.
func BuildStreamSummary(meta streamrows.ClusterMeta, grant *gatewayv1.ReferenceGrant) streamrows.NetworkSummary {
	if grant == nil {
		return streamrows.NetworkSummary{}
	}
	facts := BuildFacts(meta.ClusterID, grant)
	details := []resourcemodel.DetailSegment{}
	if kinds := grantKindsSummary(facts); kinds != "" {
		details = append(details, resourcemodel.DetailSegment{Slot: resourcemodel.DetailSlotReference, Value: kinds})
	}
	details = append(details,
		resourcemodel.DetailSegment{Slot: resourcemodel.DetailSlotCounts, Label: "From", Value: strconv.Itoa(len(facts.From))},
		resourcemodel.DetailSegment{Slot: resourcemodel.DetailSlotCounts, Label: "To", Value: strconv.Itoa(len(facts.To))},
	)
	return streamrows.NewNetworkSummary(meta, Identity, grant, details)
}

// grantKindsSummary renders the grant's direction as "FromKinds → ToKinds"
// (distinct kinds, first-seen order); either half may be absent.
func grantKindsSummary(facts Facts) string {
	fromKinds := distinctStrings(func(yield func(string)) {
		for _, from := range facts.From {
			yield(from.Kind)
		}
	})
	toKinds := distinctStrings(func(yield func(string)) {
		for _, to := range facts.To {
			yield(resourceLinkKind(to))
		}
	})
	switch {
	case fromKinds != "" && toKinds != "":
		return fromKinds + " → " + toKinds
	case fromKinds != "":
		return fromKinds
	default:
		return toKinds
	}
}

func resourceLinkKind(link resourcemodel.ResourceLink) string {
	if link.Ref != nil {
		return link.Ref.Kind
	}
	if link.Display != nil {
		return link.Display.Kind
	}
	return ""
}

func distinctStrings(each func(yield func(string))) string {
	seen := map[string]bool{}
	ordered := []string{}
	each(func(value string) {
		if value == "" || seen[value] {
			return
		}
		seen[value] = true
		ordered = append(ordered, value)
	})
	return strings.Join(ordered, ", ")
}
