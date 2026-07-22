/*
 * backend/resources/referencegrant/details.go
 *
 * ReferenceGrant detail service. The CRD-discovery + fetch seam stays in resources/gatewayapi.
 */

package referencegrant

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/gatewayapi"
	"github.com/luxury-yacht/app/backend/resources/types"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// Service retrieves ReferenceGrant details.
type Service struct {
	deps common.Dependencies
}

// NewService builds a ReferenceGrant detail service.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// ReferenceGrant returns the detail payload for a single ReferenceGrant.
func (s *Service) ReferenceGrant(namespace, name string) (*ReferenceGrantDetails, error) {
	return gatewayapi.GetResource(s.deps, "ReferenceGrant", "reference grant",
		func() (*gatewayv1.ReferenceGrant, error) {
			return s.deps.GatewayClient.GatewayV1().ReferenceGrants(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
		}, s.buildDetails)
}

func (s *Service) buildDetails(item *gatewayv1.ReferenceGrant) *ReferenceGrantDetails {
	facts := BuildFacts(s.deps.ClusterID, item)
	detail := &ReferenceGrantDetails{
		Kind:        "ReferenceGrant",
		Name:        item.Name,
		Namespace:   item.Namespace,
		Labels:      item.Labels,
		Annotations: item.Annotations,
	}
	for _, from := range facts.From {
		detail.From = append(detail.From, types.ReferenceGrantFromInfo{
			Group:     from.Group,
			Kind:      from.Kind,
			Namespace: from.Namespace,
		})
	}
	for _, to := range facts.To {
		detail.To = append(detail.To, types.RefOrDisplayFromResourceLink(to))
	}
	detail.Details = fmt.Sprintf("%d from, %d to", len(detail.From), len(detail.To))
	return detail
}
