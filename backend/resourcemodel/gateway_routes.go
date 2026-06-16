package resourcemodel

import (
	"fmt"

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

// DescribeRouteFacts renders the namespace-network streaming detail for a route.
func DescribeRouteFacts(facts RouteCommonFacts) string {
	return fmt.Sprintf("%d rule(s), %d parent(s), %d hostname(s)", len(facts.Rules), len(facts.ParentRefs), len(facts.Hostnames))
}

func gatewayRouteLabel(ruleCount, parentCount, backendCount int) string {
	return fmt.Sprintf("%d rule(s), %d parent(s), %d backend(s)", ruleCount, parentCount, backendCount)
}
