/*
 * backend/resources/endpointslice/details.go
 *
 * EndpointSlice resource handlers, co-located in the per-kind package. Intrinsic
 * fields come from the single model (endpointslice.Facts).
 */

package endpointslice

import (
	"context"
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resources/common"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Service provides detailed EndpointSlice views backed by shared dependencies.
type Service struct {
	deps common.Dependencies
}

// NewService constructs an EndpointSlice service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

func (s *Service) ctx() (context.Context, context.CancelFunc) {
	base := s.deps.Context
	if base == nil {
		base = context.Background()
	}
	if _, hasDeadline := base.Deadline(); hasDeadline {
		return base, func() {}
	}
	return context.WithTimeout(base, config.EndpointSliceLookupTimeout)
}

// EndpointSlice returns details for one concrete EndpointSlice object.
func (s *Service) EndpointSlice(namespace, name string) (*EndpointSliceDetails, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	slice, err := s.deps.KubernetesClient.DiscoveryV1().EndpointSlices(namespace).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get endpoint slice %s/%s: %v", namespace, name, err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to get endpoint slice: %v", err)
	}
	return s.buildEndpointSliceDetails(namespace, name, slice), nil
}

func (s *Service) buildEndpointSliceDetails(namespace, name string, slice *discoveryv1.EndpointSlice) *EndpointSliceDetails {
	details := &EndpointSliceDetails{
		Kind:      "EndpointSlice",
		Name:      name,
		Namespace: namespace,
	}

	if slice == nil {
		details.Details = "Ready: 0, Ports: 0"
		return details
	}

	facts := BuildFacts(s.deps.ClusterID, slice)
	ready := addressFactsToDetails(facts.ReadyAddresses)
	notReady := addressFactsToDetails(facts.NotReadyAddresses)
	ports := portFactsToDetails(facts.Ports)

	details.AddressType = facts.AddressType
	details.ReadyAddresses = ready
	details.NotReadyAddresses = notReady
	details.Ports = ports
	details.Labels = slice.Labels
	details.Annotations = slice.Annotations

	details.Details = fmt.Sprintf("Ready: %d", len(ready))
	if len(notReady) > 0 {
		details.Details += fmt.Sprintf(", Not Ready: %d", len(notReady))
	}
	details.Details += fmt.Sprintf(", Ports: %d", len(ports))

	return details
}

func addressFactsToDetails(addresses []EndpointAddressFacts) []EndpointSliceAddress {
	if len(addresses) == 0 {
		return nil
	}
	details := make([]EndpointSliceAddress, 0, len(addresses))
	for _, address := range addresses {
		next := EndpointSliceAddress{
			IP:       address.IP,
			Hostname: address.Hostname,
			NodeName: address.NodeName,
		}
		if address.TargetRef != nil {
			if address.TargetRef.Ref != nil {
				next.TargetRef = fmt.Sprintf("%s/%s", address.TargetRef.Ref.Kind, address.TargetRef.Ref.Name)
			} else if address.TargetRef.Display != nil {
				next.TargetRef = fmt.Sprintf("%s/%s", address.TargetRef.Display.Kind, address.TargetRef.Display.Name)
			}
		}
		details = append(details, next)
	}
	return details
}

func portFactsToDetails(ports []EndpointPortFacts) []EndpointSlicePort {
	if len(ports) == 0 {
		return nil
	}
	details := make([]EndpointSlicePort, 0, len(ports))
	for _, port := range ports {
		// EndpointPortFacts and EndpointSlicePort share an identical field layout.
		details = append(details, EndpointSlicePort(port))
	}
	return details
}
