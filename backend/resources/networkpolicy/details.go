/*
 * backend/resources/networkpolicy/details.go
 *
 * NetworkPolicy resource handlers, co-located in the per-kind package. Intrinsic
 * fields come from the single model (networkpolicy.Facts).
 */

package networkpolicy

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resources/common"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Service provides detailed NetworkPolicy views backed by shared dependencies.
type Service struct {
	deps common.Dependencies
}

// NewService constructs a NetworkPolicy service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// NetworkPolicy returns the detailed view for a single network policy.
func (s *Service) NetworkPolicy(namespace, name string) (*NetworkPolicyDetails, error) {
	np, err := s.deps.KubernetesClient.NetworkingV1().NetworkPolicies(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get network policy %s/%s: %v", namespace, name, err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to get network policy: %v", err)
	}
	return s.buildNetworkPolicyDetails(np), nil
}

// NetworkPolicies returns detailed views for all network policies in the namespace.
func (s *Service) NetworkPolicies(namespace string) ([]*NetworkPolicyDetails, error) {
	policies, err := s.deps.KubernetesClient.NetworkingV1().NetworkPolicies(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list network policies in namespace %s: %v", namespace, err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to list network policies: %v", err)
	}

	var results []*NetworkPolicyDetails
	for i := range policies.Items {
		np := policies.Items[i]
		results = append(results, s.buildNetworkPolicyDetails(&np))
	}

	return results, nil
}

func (s *Service) buildNetworkPolicyDetails(np *networkingv1.NetworkPolicy) *NetworkPolicyDetails {
	facts := BuildFacts(np)
	details := &NetworkPolicyDetails{
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
		details.IngressRules = append(details.IngressRules, ingressFactsToDetails(ingress))
	}

	for _, egress := range facts.EgressRules {
		details.EgressRules = append(details.EgressRules, egressFactsToDetails(egress))
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

func ingressFactsToDetails(facts RuleFacts) NetworkPolicyRule {
	return NetworkPolicyRule{
		From:  peerFactsToDetails(facts.Peers),
		Ports: portFactsToDetails(facts.Ports),
	}
}

func egressFactsToDetails(facts RuleFacts) NetworkPolicyRule {
	return NetworkPolicyRule{
		To:    peerFactsToDetails(facts.Peers),
		Ports: portFactsToDetails(facts.Ports),
	}
}

func peerFactsToDetails(peers []PeerFacts) []NetworkPolicyPeer {
	if len(peers) == 0 {
		return nil
	}
	details := make([]NetworkPolicyPeer, 0, len(peers))
	for _, peer := range peers {
		next := NetworkPolicyPeer{
			PodSelector:       peer.PodSelector,
			NamespaceSelector: peer.NamespaceSelector,
		}
		if peer.IPBlock != nil {
			next.IPBlock = &IPBlock{
				CIDR:   peer.IPBlock.CIDR,
				Except: peer.IPBlock.Except,
			}
		}
		details = append(details, next)
	}
	return details
}

func portFactsToDetails(ports []PortFacts) []NetworkPolicyPort {
	if len(ports) == 0 {
		return nil
	}
	details := make([]NetworkPolicyPort, 0, len(ports))
	for _, port := range ports {
		next := NetworkPolicyPort{Protocol: port.Protocol}
		if port.Port != "" {
			portValue := port.Port
			next.Port = &portValue
		}
		next.EndPort = port.EndPort
		details = append(details, next)
	}
	return details
}
