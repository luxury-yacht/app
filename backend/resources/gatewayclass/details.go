/*
 * backend/resources/gatewayclass/details.go
 *
 * GatewayClass detail service. The CRD-discovery + fetch seam stays in
 * resources/gatewayapi (GetResource/ListResources); this package owns the typed
 * fetch + the facts→DTO projection.
 */

package gatewayclass

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/gatewayapi"
	"github.com/luxury-yacht/app/backend/resources/types"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// Service retrieves GatewayClass details.
type Service struct {
	deps common.Dependencies
}

// NewService builds a GatewayClass detail service.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// GatewayClass returns the detail payload for a single GatewayClass.
func (s *Service) GatewayClass(name string) (*GatewayClassDetails, error) {
	return gatewayapi.GetResource(s.deps, "GatewayClass", "gateway class",
		func() (*gatewayv1.GatewayClass, error) {
			return s.deps.GatewayClient.GatewayV1().GatewayClasses().Get(s.deps.Context, name, metav1.GetOptions{})
		}, s.buildDetails)
}

// GatewayClasses lists GatewayClass detail payloads.
func (s *Service) GatewayClasses() ([]*GatewayClassDetails, error) {
	return gatewayapi.ListResources(s.deps, "GatewayClass", "gateway classes",
		func() ([]gatewayv1.GatewayClass, error) {
			list, err := s.deps.GatewayClient.GatewayV1().GatewayClasses().List(s.deps.Context, metav1.ListOptions{})
			if err != nil {
				return nil, err
			}
			return list.Items, nil
		}, s.buildDetails)
}

func (s *Service) buildDetails(item *gatewayv1.GatewayClass) *GatewayClassDetails {
	facts := BuildFacts(s.deps.ClusterID, item)
	detail := &GatewayClassDetails{
		Kind:        "GatewayClass",
		Name:        item.Name,
		Controller:  facts.ControllerName,
		Age:         common.FormatAge(item.CreationTimestamp.Time),
		Conditions:  types.ConditionStatesFromFacts(facts.Conditions),
		Summary:     types.ConditionsSummaryFromFacts(facts.Summary),
		Labels:      item.Labels,
		Annotations: item.Annotations,
	}
	if facts.Parameters != nil {
		ref := types.RefOrDisplayFromResourceLink(*facts.Parameters)
		detail.Parameters = &ref
	}
	detail.Details = fmt.Sprintf("Controller: %s", detail.Controller)
	return detail
}
