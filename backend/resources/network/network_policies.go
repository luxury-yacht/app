/*
 * backend/resources/network/network_policies.go
 *
 * NetworkPolicy resource handlers.
 * - Builds detail and list views for the frontend.
 */

package network

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func (s *Service) NetworkPolicy(namespace, name string) (*types.NetworkPolicyDetails, error) {
	np, err := s.deps.KubernetesClient.NetworkingV1().NetworkPolicies(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get network policy %s/%s: %v", namespace, name, err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to get network policy: %v", err)
	}
	return s.buildNetworkPolicyDetails(np), nil
}

func (s *Service) NetworkPolicies(namespace string) ([]*types.NetworkPolicyDetails, error) {
	policies, err := s.deps.KubernetesClient.NetworkingV1().NetworkPolicies(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list network policies in namespace %s: %v", namespace, err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to list network policies: %v", err)
	}

	var results []*types.NetworkPolicyDetails
	for i := range policies.Items {
		np := policies.Items[i]
		results = append(results, s.buildNetworkPolicyDetails(&np))
	}

	return results, nil
}

func (s *Service) buildNetworkPolicyDetails(np *networkingv1.NetworkPolicy) *types.NetworkPolicyDetails {
	model := resourcemodel.BuildNetworkPolicyResourceModel(s.deps.ClusterID, np)
	facts := model.Facts.NetworkPolicy
	details := &types.NetworkPolicyDetails{
		Kind:        "NetworkPolicy",
		Name:        np.Name,
		Namespace:   np.Namespace,
		Age:         common.FormatAge(np.CreationTimestamp.Time),
		PodSelector: facts.PodSelector,
		Labels:      np.Labels,
		Annotations: np.Annotations,
	}

	details.PolicyTypes = append(details.PolicyTypes, facts.PolicyTypes...)

	for _, ingress := range facts.IngressRules {
		details.IngressRules = append(details.IngressRules, networkPolicyIngressFactsToDetails(ingress))
	}

	for _, egress := range facts.EgressRules {
		details.EgressRules = append(details.EgressRules, networkPolicyEgressFactsToDetails(egress))
	}

	podSelectorInfo := "All pods"
	if len(details.PodSelector) > 0 {
		podSelectorInfo = fmt.Sprintf("%d pod selector(s)", len(details.PodSelector))
	}

	policyTypeInfo := ""
	if len(details.PolicyTypes) > 0 {
		policyTypeInfo = fmt.Sprintf(", Types: %v", details.PolicyTypes)
	}

	rulesInfo := ""
	if len(details.IngressRules) > 0 || len(details.EgressRules) > 0 {
		rulesInfo = fmt.Sprintf(", %d ingress, %d egress rules", len(details.IngressRules), len(details.EgressRules))
	}

	details.Details = fmt.Sprintf("%s%s%s", podSelectorInfo, policyTypeInfo, rulesInfo)
	return details
}

func networkPolicyIngressFactsToDetails(facts resourcemodel.NetworkPolicyRuleFacts) types.NetworkPolicyRule {
	return types.NetworkPolicyRule{
		From:  networkPolicyPeerFactsToDetails(facts.Peers),
		Ports: networkPolicyPortFactsToDetails(facts.Ports),
	}
}

func networkPolicyEgressFactsToDetails(facts resourcemodel.NetworkPolicyRuleFacts) types.NetworkPolicyRule {
	return types.NetworkPolicyRule{
		To:    networkPolicyPeerFactsToDetails(facts.Peers),
		Ports: networkPolicyPortFactsToDetails(facts.Ports),
	}
}

func networkPolicyPeerFactsToDetails(peers []resourcemodel.NetworkPolicyPeerFacts) []types.NetworkPolicyPeer {
	if len(peers) == 0 {
		return nil
	}
	details := make([]types.NetworkPolicyPeer, 0, len(peers))
	for _, peer := range peers {
		next := types.NetworkPolicyPeer{
			PodSelector:       peer.PodSelector,
			NamespaceSelector: peer.NamespaceSelector,
		}
		if peer.IPBlock != nil {
			next.IPBlock = &types.IPBlock{
				CIDR:   peer.IPBlock.CIDR,
				Except: peer.IPBlock.Except,
			}
		}
		details = append(details, next)
	}
	return details
}

func networkPolicyPortFactsToDetails(ports []resourcemodel.NetworkPolicyPortFacts) []types.NetworkPolicyPort {
	if len(ports) == 0 {
		return nil
	}
	details := make([]types.NetworkPolicyPort, 0, len(ports))
	for _, port := range ports {
		next := types.NetworkPolicyPort{Protocol: port.Protocol}
		if port.Port != "" {
			portValue := port.Port
			next.Port = &portValue
		}
		next.EndPort = port.EndPort
		details = append(details, next)
	}
	return details
}
