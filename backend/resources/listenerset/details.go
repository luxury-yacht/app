/*
 * backend/resources/listenerset/details.go
 *
 * ListenerSet detail service. The CRD-discovery + fetch seam stays in resources/gatewayapi.
 */

package listenerset

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/gatewayapi"
	"github.com/luxury-yacht/app/backend/resources/types"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

// Service retrieves ListenerSet details.
type Service struct {
	deps common.Dependencies
}

// NewService builds a ListenerSet detail service.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// ListenerSet returns the detail payload for a single ListenerSet.
func (s *Service) ListenerSet(namespace, name string) (*ListenerSetDetails, error) {
	return gatewayapi.GetResource(s.deps, "ListenerSet", "listener set",
		func() (*gatewayv1.ListenerSet, error) {
			return s.deps.GatewayClient.GatewayV1().ListenerSets(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
		}, s.buildDetails)
}

func (s *Service) buildDetails(item *gatewayv1.ListenerSet) *ListenerSetDetails {
	facts := BuildFacts(s.deps.ClusterID, item)
	return &ListenerSetDetails{
		Kind:        "ListenerSet",
		Name:        item.Name,
		Namespace:   item.Namespace,
		Details:     fmt.Sprintf("%d listener(s)", len(facts.Listeners)),
		ParentRef:   types.RefOrDisplayFromResourceLink(facts.ParentRef),
		Listeners:   types.GatewayListenerDetailsFromFacts(facts.Listeners),
		Conditions:  types.ConditionStatesFromFacts(facts.Conditions),
		Summary:     types.ConditionsSummaryFromFacts(facts.Summary),
		Labels:      item.Labels,
		Annotations: item.Annotations,
	}
}
