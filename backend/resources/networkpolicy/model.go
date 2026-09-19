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
	status := statusPresentation(policy)
	return resourcemodel.KubernetesResourceModel(clusterID, Identity, policy.ObjectMeta, status)
}

// BuildFacts extracts the NetworkPolicy facts from the raw object.
func BuildFacts(policy *networkingv1.NetworkPolicy) Facts {
	facts := Facts{
		PodSelector: resourcemodel.CopyStringMap(policy.Spec.PodSelector.MatchLabels),
		PolicyTypes: policyTypes(policy.Spec),
	}
	for _, ingress := range policy.Spec.Ingress {
		facts.IngressRules = append(facts.IngressRules, ruleFacts(ingress.From, ingress.Ports))
	}
	for _, egress := range policy.Spec.Egress {
		facts.EgressRules = append(facts.EgressRules, ruleFacts(egress.To, egress.Ports))
	}
	return facts
}

func statusPresentation(policy *networkingv1.NetworkPolicy) resourcemodel.ResourceStatusPresentation {
	state := fmt.Sprintf("%d/%d", len(policy.Spec.Ingress), len(policy.Spec.Egress))
	signals := []resourcemodel.ResourceStatusSignal{
		{Type: resourcemodel.StatusSignalResourceState, Name: "spec.ingress", Status: strconv.Itoa(len(policy.Spec.Ingress))},
		{Type: resourcemodel.StatusSignalResourceState, Name: "spec.egress", Status: strconv.Itoa(len(policy.Spec.Egress))},
	}
	lifecycle := resourcemodel.ObjectLifecycle(policy.ObjectMeta)
	if status, ok := resourcemodel.DeletingObjectStatus(policy.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}
	label := fmt.Sprintf("%s, %d ingress, %d egress", policyTypesLabel(policyTypes(policy.Spec)), len(policy.Spec.Ingress), len(policy.Spec.Egress))
	return resourcemodel.ObjectSourceStatus(label, state, "", "", "ready", signals, lifecycle)
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

func policyTypes(spec networkingv1.NetworkPolicySpec) []string {
	if len(spec.PolicyTypes) > 0 {
		types := make([]string, 0, len(spec.PolicyTypes))
		for _, policyType := range spec.PolicyTypes {
			types = append(types, string(policyType))
		}
		return types
	}
	types := []string{string(networkingv1.PolicyTypeIngress)}
	if len(spec.Egress) > 0 {
		types = append(types, string(networkingv1.PolicyTypeEgress))
	}
	return types
}

func ruleFacts(peers []networkingv1.NetworkPolicyPeer, ports []networkingv1.NetworkPolicyPort) RuleFacts {
	facts := RuleFacts{}
	for _, peer := range peers {
		facts.Peers = append(facts.Peers, peerFacts(peer))
	}
	for _, port := range ports {
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
