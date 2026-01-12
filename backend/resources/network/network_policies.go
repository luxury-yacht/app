/*
 * backend/resources/network/network_policies.go
 *
 * NetworkPolicy resource handlers.
 * - Builds detail and list views for the frontend.
 */

package network

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func (s *Service) NetworkPolicy(namespace, name string) (*types.NetworkPolicyDetails, error) {
	np, err := s.deps.KubernetesClient.NetworkingV1().NetworkPolicies(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get network policy %s/%s: %v", namespace, name, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to get network policy: %v", err)
	}
	return buildNetworkPolicyDetails(np), nil
}

func (s *Service) NetworkPolicies(namespace string) ([]*types.NetworkPolicyDetails, error) {
	policies, err := s.deps.KubernetesClient.NetworkingV1().NetworkPolicies(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list network policies in namespace %s: %v", namespace, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to list network policies: %v", err)
	}

	var results []*types.NetworkPolicyDetails
	for i := range policies.Items {
		np := policies.Items[i]
		results = append(results, buildNetworkPolicyDetails(&np))
	}

	return results, nil
}

func buildNetworkPolicyDetails(np *networkingv1.NetworkPolicy) *types.NetworkPolicyDetails {
	details := &types.NetworkPolicyDetails{
		Kind:        "NetworkPolicy",
		Name:        np.Name,
		Namespace:   np.Namespace,
		Age:         common.FormatAge(np.CreationTimestamp.Time),
		PodSelector: np.Spec.PodSelector.MatchLabels,
		Labels:      np.Labels,
		Annotations: np.Annotations,
	}

	for _, policyType := range np.Spec.PolicyTypes {
		details.PolicyTypes = append(details.PolicyTypes, string(policyType))
	}

	for _, ingress := range np.Spec.Ingress {
		rule := types.NetworkPolicyRule{}
		for _, from := range ingress.From {
			peer := types.NetworkPolicyPeer{}
			if from.PodSelector != nil {
				peer.PodSelector = from.PodSelector.MatchLabels
			}
			if from.NamespaceSelector != nil {
				peer.NamespaceSelector = from.NamespaceSelector.MatchLabels
			}
			if from.IPBlock != nil {
				peer.IPBlock = &types.IPBlock{
					CIDR:   from.IPBlock.CIDR,
					Except: from.IPBlock.Except,
				}
			}
			rule.From = append(rule.From, peer)
		}
		for _, port := range ingress.Ports {
			rule.Ports = append(rule.Ports, networkPolicyPort(port))
		}
		details.IngressRules = append(details.IngressRules, rule)
	}

	for _, egress := range np.Spec.Egress {
		rule := types.NetworkPolicyRule{}
		for _, to := range egress.To {
			peer := types.NetworkPolicyPeer{}
			if to.PodSelector != nil {
				peer.PodSelector = to.PodSelector.MatchLabels
			}
			if to.NamespaceSelector != nil {
				peer.NamespaceSelector = to.NamespaceSelector.MatchLabels
			}
			if to.IPBlock != nil {
				peer.IPBlock = &types.IPBlock{
					CIDR:   to.IPBlock.CIDR,
					Except: to.IPBlock.Except,
				}
			}
			rule.To = append(rule.To, peer)
		}
		for _, port := range egress.Ports {
			rule.Ports = append(rule.Ports, networkPolicyPort(port))
		}
		details.EgressRules = append(details.EgressRules, rule)
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

func networkPolicyPort(port networkingv1.NetworkPolicyPort) types.NetworkPolicyPort {
	var npPort types.NetworkPolicyPort
	if port.Protocol != nil {
		npPort.Protocol = string(*port.Protocol)
	}
	if port.Port != nil {
		portStr := port.Port.String()
		npPort.Port = &portStr
	}
	if port.EndPort != nil {
		npPort.EndPort = port.EndPort
	}
	return npPort
}
