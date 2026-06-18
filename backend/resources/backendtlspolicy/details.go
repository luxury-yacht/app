/*
 * backend/resources/backendtlspolicy/details.go
 *
 * BackendTLSPolicy detail service. The CRD-discovery + fetch seam stays in resources/gatewayapi.
 */

package backendtlspolicy

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/gatewayapi"
	"github.com/luxury-yacht/app/backend/resources/types"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// Service retrieves BackendTLSPolicy details.
type Service struct {
	deps common.Dependencies
}

// NewService builds a BackendTLSPolicy detail service.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// BackendTLSPolicy returns the detail payload for a single BackendTLSPolicy.
func (s *Service) BackendTLSPolicy(namespace, name string) (*BackendTLSPolicyDetails, error) {
	return gatewayapi.GetResource(s.deps, "BackendTLSPolicy", "backend tls policy",
		func() (*gatewayv1.BackendTLSPolicy, error) {
			return s.deps.GatewayClient.GatewayV1().BackendTLSPolicies(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
		}, s.buildDetails)
}

// BackendTLSPolicies lists BackendTLSPolicy detail payloads.
func (s *Service) BackendTLSPolicies(namespace string) ([]*BackendTLSPolicyDetails, error) {
	return gatewayapi.ListResources(s.deps, "BackendTLSPolicy", "backend tls policies",
		func() ([]gatewayv1.BackendTLSPolicy, error) {
			list, err := s.deps.GatewayClient.GatewayV1().BackendTLSPolicies(namespace).List(s.deps.Context, metav1.ListOptions{})
			if err != nil {
				return nil, err
			}
			return list.Items, nil
		}, s.buildDetails)
}

func (s *Service) buildDetails(item *gatewayv1.BackendTLSPolicy) *BackendTLSPolicyDetails {
	facts := BuildFacts(s.deps.ClusterID, item)
	detail := &BackendTLSPolicyDetails{
		Kind:        "BackendTLSPolicy",
		Name:        item.Name,
		Namespace:   item.Namespace,
		Age:         common.FormatAge(item.CreationTimestamp.Time),
		Conditions:  types.ConditionStatesFromFacts(facts.Conditions),
		Summary:     types.ConditionsSummaryFromFacts(facts.Summary),
		Labels:      item.Labels,
		Annotations: item.Annotations,
	}
	for _, targetRef := range facts.TargetRefs {
		detail.TargetRefs = append(detail.TargetRefs, types.RefOrDisplayFromResourceLink(targetRef))
	}
	detail.Details = fmt.Sprintf("%d target(s)", len(detail.TargetRefs))
	return detail
}
