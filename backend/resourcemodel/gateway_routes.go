package resourcemodel

import (
	"fmt"
	"strconv"
	"strings"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// Gateway-API route helpers shared by the httproute/grpcroute/tlsroute kind
// packages. Per-route model/facts builders + the HTTP/GRPC match summaries live
// in those packages; the common-facts assembly, status presentation, and the
// streaming description string stay here so they exist in exactly one place.

// BuildGatewayRouteStatusPresentation projects shared route facts into a status.
func BuildGatewayRouteStatusPresentation(meta metav1.ObjectMeta, facts RouteCommonFacts) ResourceStatusPresentation {
	state := GatewayCountState(len(facts.Rules))
	label := gatewayRouteLabel(len(facts.Rules), len(facts.ParentRefs), len(facts.Backends))
	return GatewayStatusFromConditions(meta, state, label, facts.Conditions)
}

// GatewayRouteCommonFacts builds the hostname/parent/condition facts every
// Gateway-API route shares. The kind package appends per-rule match + backend
// facts on top.
func GatewayRouteCommonFacts(
	clusterID string,
	meta metav1.ObjectMeta,
	hostnames []gatewayv1.Hostname,
	parentRefs []gatewayv1.ParentReference,
	parentStatuses []gatewayv1.RouteParentStatus,
) RouteCommonFacts {
	conditions := GatewayConditionFacts(GatewayRouteStatusConditions(parentStatuses))
	facts := RouteCommonFacts{
		Conditions: conditions,
		Summary:    GatewayConditionsSummary(conditions),
	}
	for _, hostname := range hostnames {
		facts.Hostnames = append(facts.Hostnames, string(hostname))
	}
	for _, parentRef := range parentRefs {
		facts.ParentRefs = append(facts.ParentRefs, GatewayParentRefLink(clusterID, meta.Namespace, parentRef))
	}
	return facts
}

// RouteSummarySegments renders the namespace-network Details segments shared by
// the HTTPRoute/GRPCRoute/TLSRoute stream summaries: the first parent gateway
// as an openable reference (remaining parent names kept searchable), the
// hostnames as a collapsed address list, and the rule count.
func RouteSummarySegments(facts RouteCommonFacts) []DetailSegment {
	segments := []DetailSegment{}
	if len(facts.ParentRefs) > 0 {
		if name := ResourceLinkName(facts.ParentRefs[0]); name != "" {
			parent := DetailSegment{Slot: DetailSlotReference, Value: name, Link: &facts.ParentRefs[0]}
			if len(facts.ParentRefs) > 1 {
				names := make([]string, 0, len(facts.ParentRefs))
				for _, ref := range facts.ParentRefs {
					names = append(names, ResourceLinkName(ref))
				}
				parent.Search = strings.Join(names, ", ")
			}
			segments = append(segments, parent)
		}
	}
	if hosts := ListDetailSegment(DetailSlotAddress, facts.Hostnames); hosts.Value != "" {
		segments = append(segments, hosts)
	}
	return append(segments, DetailSegment{Slot: DetailSlotCounts, Label: "Rules", Value: strconv.Itoa(len(facts.Rules))})
}

func gatewayRouteLabel(ruleCount, parentCount, backendCount int) string {
	return fmt.Sprintf("%d rule(s), %d parent(s), %d backend(s)", ruleCount, parentCount, backendCount)
}
