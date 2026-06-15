package resourcemodel

import (
	"fmt"
	"strconv"

	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

const gatewayAPIGroup = "gateway.networking.k8s.io"

func gatewayAPIResourceModel(
	clusterID, kind, resource string,
	scope ResourceScope,
	meta metav1.ObjectMeta,
	status ResourceStatusPresentation,
	facts ResourceFacts,
) ResourceModel {
	return NetworkResourceModel(clusterID, gatewayAPIGroup, "v1", kind, resource, scope, meta, status, facts)
}

func gatewayConditionFacts(conditions []metav1.Condition) []ConditionFacts {
	facts := make([]ConditionFacts, 0, len(conditions))
	for _, condition := range conditions {
		facts = append(facts, ConditionFacts{
			Type:               condition.Type,
			Status:             string(condition.Status),
			Reason:             condition.Reason,
			Message:            condition.Message,
			LastTransitionTime: condition.LastTransitionTime,
		})
	}
	return facts
}

func gatewayConditionsSummary(conditions []ConditionFacts) ConditionsSummaryFacts {
	var summary ConditionsSummaryFacts
	for _, condition := range conditions {
		next := condition
		switch condition.Type {
		case "Accepted":
			summary.Accepted = &next
		case "Programmed":
			summary.Programmed = &next
		case "Ready":
			summary.Ready = &next
		case "ResolvedRefs":
			summary.Resolved = &next
		}
	}
	return summary
}

func gatewayStatusFromConditions(meta metav1.ObjectMeta, fallbackState, fallbackLabel string, conditions []ConditionFacts) ResourceStatusPresentation {
	signals := gatewayConditionSignals(conditions)
	lifecycle := NetworkLifecycle(meta)
	if status, ok := DeletingNetworkStatus(meta, fallbackState, signals, lifecycle); ok {
		return status
	}

	priority := []string{"Ready", "Programmed", "Accepted", "ResolvedRefs"}
	for _, conditionType := range priority {
		if condition, ok := findConditionFacts(conditions, conditionType); ok && condition.Status == string(metav1.ConditionFalse) {
			label := condition.Type
			if condition.Reason != "" {
				label = fmt.Sprintf("%s: %s", condition.Type, condition.Reason)
			}
			return NetworkSourceStatus(label, condition.Status, condition.Reason, "warning", signals, lifecycle)
		}
	}
	for _, conditionType := range priority {
		if condition, ok := findConditionFacts(conditions, conditionType); ok && condition.Status == string(metav1.ConditionUnknown) {
			label := condition.Type
			if condition.Reason != "" {
				label = fmt.Sprintf("%s: %s", condition.Type, condition.Reason)
			}
			return NetworkSourceStatus(label, condition.Status, condition.Reason, "unknown", signals, lifecycle)
		}
	}
	for _, conditionType := range priority {
		if condition, ok := findConditionFacts(conditions, conditionType); ok && condition.Status == string(metav1.ConditionTrue) {
			return NetworkSourceStatus(condition.Type, condition.Status, condition.Reason, "ready", signals, lifecycle)
		}
	}
	return NetworkSourceStatus(fallbackLabel, fallbackState, "", "unknown", signals, lifecycle)
}

func gatewayConditionSignals(conditions []ConditionFacts) []ResourceStatusSignal {
	signals := make([]ResourceStatusSignal, 0, len(conditions))
	for _, condition := range conditions {
		signals = append(signals, ResourceStatusSignal{
			Type:    StatusSignalCondition,
			Name:    condition.Type,
			Status:  condition.Status,
			Reason:  condition.Reason,
			Message: condition.Message,
		})
	}
	return signals
}

func findConditionFacts(conditions []ConditionFacts, conditionType string) (ConditionFacts, bool) {
	for _, condition := range conditions {
		if condition.Type == conditionType {
			return condition, true
		}
	}
	return ConditionFacts{}, false
}

func gatewayClassLink(clusterID string, name gatewayv1.ObjectName) ResourceLink {
	return clusterResourceLink(clusterID, gatewayAPIGroup, "v1", "GatewayClass", "gatewayclasses", string(name), "")
}

func gatewayRefLink(clusterID, group, kind, namespace, name string) ResourceLink {
	resource := gatewayResourceName(group, kind)
	if version := gatewayRefVersion(group, kind); version != "" && name != "" {
		return namespacedResourceLink(clusterID, group, version, kind, resource, namespace, name, "")
	}
	return displayResourceLink(clusterID, group, "", kind, resource, namespace, name)
}

func gatewayRefVersion(group, kind string) string {
	switch group {
	case "":
		return "v1"
	case gatewayAPIGroup:
		return "v1"
	default:
		return ""
	}
}

func gatewayResourceName(group, kind string) string {
	if group == gatewayAPIGroup {
		switch kind {
		case "GatewayClass":
			return "gatewayclasses"
		case "Gateway":
			return "gateways"
		case "HTTPRoute":
			return "httproutes"
		case "GRPCRoute":
			return "grpcroutes"
		case "TLSRoute":
			return "tlsroutes"
		case "ListenerSet":
			return "listenersets"
		case "ReferenceGrant":
			return "referencegrants"
		case "BackendTLSPolicy":
			return "backendtlspolicies"
		}
	}
	if group == "" {
		switch kind {
		case "Service":
			return "services"
		case "Secret":
			return "secrets"
		case "ConfigMap":
			return "configmaps"
		}
	}
	return ""
}

func gatewayParentRefLink(clusterID, currentNamespace string, ref gatewayv1.ParentReference) ResourceLink {
	group := gatewayAPIGroup
	if ref.Group != nil {
		group = string(*ref.Group)
	}
	kind := "Gateway"
	if ref.Kind != nil {
		kind = string(*ref.Kind)
	}
	namespace := currentNamespace
	if ref.Namespace != nil {
		namespace = string(*ref.Namespace)
	}
	return gatewayRefLink(clusterID, group, kind, namespace, string(ref.Name))
}

func gatewayParentGatewayRefLink(clusterID, currentNamespace string, ref gatewayv1.ParentGatewayReference) ResourceLink {
	group := gatewayAPIGroup
	if ref.Group != nil {
		group = string(*ref.Group)
	}
	kind := "Gateway"
	if ref.Kind != nil {
		kind = string(*ref.Kind)
	}
	namespace := currentNamespace
	if ref.Namespace != nil {
		namespace = string(*ref.Namespace)
	}
	return gatewayRefLink(clusterID, group, kind, namespace, string(ref.Name))
}

func gatewayBackendRefLink(clusterID, currentNamespace string, ref gatewayv1.BackendObjectReference) ResourceLink {
	group := ""
	if ref.Group != nil {
		group = string(*ref.Group)
	}
	kind := "Service"
	if ref.Kind != nil {
		kind = string(*ref.Kind)
	}
	namespace := currentNamespace
	if ref.Namespace != nil {
		namespace = string(*ref.Namespace)
	}
	return gatewayRefLink(clusterID, group, kind, namespace, string(ref.Name))
}

func gatewayPolicyTargetRefLink(clusterID, currentNamespace string, ref gatewayv1.LocalPolicyTargetReferenceWithSectionName) ResourceLink {
	return gatewayRefLink(clusterID, string(ref.Group), string(ref.Kind), currentNamespace, string(ref.Name))
}

func gatewayReferenceGrantToLink(clusterID, currentNamespace string, ref gatewayv1.ReferenceGrantTo) ResourceLink {
	name := ""
	if ref.Name != nil {
		name = string(*ref.Name)
	}
	return gatewayRefLink(clusterID, string(ref.Group), string(ref.Kind), currentNamespace, name)
}

func gatewayListenerFacts(statusByName map[string]gatewayListenerStatusFacts, name, hostname, protocol string, port int32) GatewayListenerFacts {
	facts := GatewayListenerFacts{
		Name:     name,
		Hostname: hostname,
		Port:     port,
		Protocol: protocol,
	}
	if status, ok := statusByName[name]; ok {
		facts.AttachedRoutes = status.attachedRoutes
		facts.Conditions = gatewayConditionFacts(status.conditions)
	}
	return facts
}

type gatewayListenerStatusFacts struct {
	attachedRoutes int32
	conditions     []metav1.Condition
}

func gatewayRouteStatusConditions(statuses []gatewayv1.RouteParentStatus) []metav1.Condition {
	var conditions []metav1.Condition
	for _, status := range statuses {
		conditions = append(conditions, status.Conditions...)
	}
	return conditions
}

func gatewayBackendTLSConditions(ancestors []gatewayv1.PolicyAncestorStatus) []metav1.Condition {
	var conditions []metav1.Condition
	for _, ancestor := range ancestors {
		conditions = append(conditions, ancestor.Conditions...)
	}
	return conditions
}

func gatewayAddressValues(addresses []gatewayv1.GatewayStatusAddress) []string {
	values := make([]string, 0, len(addresses))
	for _, address := range addresses {
		values = append(values, address.Value)
	}
	return values
}

func gatewayCountState(count int) string {
	return strconv.Itoa(count)
}
