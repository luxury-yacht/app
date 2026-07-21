/*
 * backend/resources/networkpolicy/model.go
 *
 * NetworkPolicy resource model: the single definition of a NetworkPolicy's
 * intrinsic fields + status presentation. Detail/object-map/streaming projections
 * derive from it. Shared model helpers are reused from resourcemodel (exported base).
 */

package networkpolicy

import (
	"fmt"
	"strconv"
	"strings"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	networkingv1 "k8s.io/api/networking/v1"
)

// BuildResourceModel builds the NetworkPolicy resource model. Facts are owned by
// this package (networkpolicy.Facts); the shared ResourceModel carries identity +
// status, and callers needing facts use BuildFacts.
func BuildResourceModel(clusterID string, policy *networkingv1.NetworkPolicy) resourcemodel.ResourceModel {
	facts := BuildFacts(policy)
	status := statusPresentation(policy, facts)
	return resourcemodel.KubernetesResourceModel(clusterID, "networking.k8s.io", "v1", "NetworkPolicy", "networkpolicies", resourcemodel.ResourceScopeNamespaced, policy.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the NetworkPolicy facts from the raw object.
func BuildFacts(policy *networkingv1.NetworkPolicy) Facts {
	facts := Facts{
		PodSelector: resourcemodel.CopyStringMap(policy.Spec.PodSelector.MatchLabels),
	}
	for _, policyType := range policy.Spec.PolicyTypes {
		facts.PolicyTypes = append(facts.PolicyTypes, string(policyType))
	}
	for _, ingress := range policy.Spec.Ingress {
		facts.IngressRules = append(facts.IngressRules, ingressRuleFacts(ingress))
	}
	for _, egress := range policy.Spec.Egress {
		facts.EgressRules = append(facts.EgressRules, egressRuleFacts(egress))
	}
	if len(facts.PolicyTypes) == 0 {
		facts.PolicyTypes = defaultPolicyTypes(facts)
	}
	return facts
}

func statusPresentation(policy *networkingv1.NetworkPolicy, facts Facts) resourcemodel.ResourceStatusPresentation {
	state := fmt.Sprintf("%d/%d", len(facts.IngressRules), len(facts.EgressRules))
	signals := []resourcemodel.ResourceStatusSignal{
		{Type: resourcemodel.StatusSignalResourceState, Name: "spec.ingress", Status: strconv.Itoa(len(facts.IngressRules))},
		{Type: resourcemodel.StatusSignalResourceState, Name: "spec.egress", Status: strconv.Itoa(len(facts.EgressRules))},
	}
	lifecycle := resourcemodel.ObjectLifecycle(policy.ObjectMeta)
	if status, ok := resourcemodel.DeletingObjectStatus(policy.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}
	return resourcemodel.ObjectSourceStatus(policyLabel(facts), state, "", "", "ready", signals, lifecycle)
}

func policyLabel(facts Facts) string {
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

func defaultPolicyTypes(facts Facts) []string {
	policyTypes := []string{string(networkingv1.PolicyTypeIngress)}
	if len(facts.EgressRules) > 0 {
		policyTypes = append(policyTypes, string(networkingv1.PolicyTypeEgress))
	}
	return policyTypes
}

func ingressRuleFacts(rule networkingv1.NetworkPolicyIngressRule) RuleFacts {
	facts := RuleFacts{}
	for _, peer := range rule.From {
		facts.Peers = append(facts.Peers, peerFacts(peer))
	}
	for _, port := range rule.Ports {
		facts.Ports = append(facts.Ports, portFacts(port))
	}
	return facts
}

func egressRuleFacts(rule networkingv1.NetworkPolicyEgressRule) RuleFacts {
	facts := RuleFacts{}
	for _, peer := range rule.To {
		facts.Peers = append(facts.Peers, peerFacts(peer))
	}
	for _, port := range rule.Ports {
		facts.Ports = append(facts.Ports, portFacts(port))
	}
	return facts
}

func peerFacts(peer networkingv1.NetworkPolicyPeer) PeerFacts {
	facts := PeerFacts{}
	if peer.PodSelector != nil {
		facts.PodSelector = resourcemodel.CopyStringMap(peer.PodSelector.MatchLabels)
	}
	if peer.NamespaceSelector != nil {
		facts.NamespaceSelector = resourcemodel.CopyStringMap(peer.NamespaceSelector.MatchLabels)
	}
	if peer.IPBlock != nil {
		facts.IPBlock = &IPBlockFacts{
			CIDR:   peer.IPBlock.CIDR,
			Except: append([]string(nil), peer.IPBlock.Except...),
		}
	}
	return facts
}

func portFacts(port networkingv1.NetworkPolicyPort) PortFacts {
	facts := PortFacts{}
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
