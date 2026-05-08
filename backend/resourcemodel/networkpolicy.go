package resourcemodel

import (
	"fmt"
	"strconv"
	"strings"

	networkingv1 "k8s.io/api/networking/v1"
)

func BuildNetworkPolicyResourceModel(clusterID string, policy *networkingv1.NetworkPolicy) ResourceModel {
	facts := BuildNetworkPolicyFacts(policy)
	status := BuildNetworkPolicyStatusPresentation(policy, facts)
	return networkResourceModel(clusterID, "networking.k8s.io", "v1", "NetworkPolicy", "networkpolicies", ResourceScopeNamespaced, policy.ObjectMeta, status, ResourceFacts{NetworkPolicy: &facts})
}

func BuildNetworkPolicyFacts(policy *networkingv1.NetworkPolicy) NetworkPolicyFacts {
	facts := NetworkPolicyFacts{
		PodSelector: copyStringMap(policy.Spec.PodSelector.MatchLabels),
	}
	for _, policyType := range policy.Spec.PolicyTypes {
		facts.PolicyTypes = append(facts.PolicyTypes, string(policyType))
	}
	for _, ingress := range policy.Spec.Ingress {
		facts.IngressRules = append(facts.IngressRules, networkPolicyIngressRuleFacts(ingress))
	}
	for _, egress := range policy.Spec.Egress {
		facts.EgressRules = append(facts.EgressRules, networkPolicyEgressRuleFacts(egress))
	}
	if len(facts.PolicyTypes) == 0 {
		facts.PolicyTypes = defaultNetworkPolicyTypes(facts)
	}
	return facts
}

func BuildNetworkPolicyStatusPresentation(policy *networkingv1.NetworkPolicy, facts NetworkPolicyFacts) ResourceStatusPresentation {
	state := fmt.Sprintf("%d/%d", len(facts.IngressRules), len(facts.EgressRules))
	signals := []ResourceStatusSignal{
		{Type: StatusSignalResourceState, Name: "spec.ingress", Status: strconv.Itoa(len(facts.IngressRules))},
		{Type: StatusSignalResourceState, Name: "spec.egress", Status: strconv.Itoa(len(facts.EgressRules))},
	}
	lifecycle := networkLifecycle(policy.ObjectMeta)
	if status, ok := deletingNetworkStatus(policy.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}
	return networkSourceStatus(networkPolicyLabel(facts), state, "", "ready", signals, lifecycle)
}

func networkPolicyLabel(facts NetworkPolicyFacts) string {
	return fmt.Sprintf("%s, %d ingress, %d egress", policyTypesLabel(facts.PolicyTypes), len(facts.IngressRules), len(facts.EgressRules))
}

func policyTypesLabel(policyTypes []string) string {
	if len(policyTypes) == 0 {
		return string(networkingv1.PolicyTypeIngress)
	}
	if len(policyTypes) == 1 {
		return policyTypes[0]
	}
	return strings.Join(policyTypes, ",")
}

func defaultNetworkPolicyTypes(facts NetworkPolicyFacts) []string {
	policyTypes := []string{string(networkingv1.PolicyTypeIngress)}
	if len(facts.EgressRules) > 0 {
		policyTypes = append(policyTypes, string(networkingv1.PolicyTypeEgress))
	}
	return policyTypes
}

func networkPolicyIngressRuleFacts(rule networkingv1.NetworkPolicyIngressRule) NetworkPolicyRuleFacts {
	facts := NetworkPolicyRuleFacts{}
	for _, peer := range rule.From {
		facts.Peers = append(facts.Peers, networkPolicyPeerFacts(peer))
	}
	for _, port := range rule.Ports {
		facts.Ports = append(facts.Ports, networkPolicyPortFacts(port))
	}
	return facts
}

func networkPolicyEgressRuleFacts(rule networkingv1.NetworkPolicyEgressRule) NetworkPolicyRuleFacts {
	facts := NetworkPolicyRuleFacts{}
	for _, peer := range rule.To {
		facts.Peers = append(facts.Peers, networkPolicyPeerFacts(peer))
	}
	for _, port := range rule.Ports {
		facts.Ports = append(facts.Ports, networkPolicyPortFacts(port))
	}
	return facts
}

func networkPolicyPeerFacts(peer networkingv1.NetworkPolicyPeer) NetworkPolicyPeerFacts {
	facts := NetworkPolicyPeerFacts{}
	if peer.PodSelector != nil {
		facts.PodSelector = copyStringMap(peer.PodSelector.MatchLabels)
	}
	if peer.NamespaceSelector != nil {
		facts.NamespaceSelector = copyStringMap(peer.NamespaceSelector.MatchLabels)
	}
	if peer.IPBlock != nil {
		facts.IPBlock = &IPBlockFacts{
			CIDR:   peer.IPBlock.CIDR,
			Except: append([]string(nil), peer.IPBlock.Except...),
		}
	}
	return facts
}

func networkPolicyPortFacts(port networkingv1.NetworkPolicyPort) NetworkPolicyPortFacts {
	facts := NetworkPolicyPortFacts{}
	if port.Protocol != nil {
		facts.Protocol = string(*port.Protocol)
	}
	if port.Port != nil {
		facts.Port = port.Port.String()
	}
	if port.EndPort != nil {
		facts.EndPort = port.EndPort
	}
	return facts
}
