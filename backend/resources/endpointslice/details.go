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
	"sort"
	"time"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resources/common"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"
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

// EndpointSlices lists details for every EndpointSlice object in the namespace.
func (s *Service) EndpointSlices(namespace string) ([]*EndpointSliceDetails, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	slices, err := s.listEndpointSlices(ctx, namespace, "")
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list endpoint slices in namespace %s: %v", namespace, err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to list endpoint slices: %v", err)
	}

	sort.SliceStable(slices, func(i, j int) bool {
		return slices[i].Name < slices[j].Name
	})

	results := make([]*EndpointSliceDetails, 0, len(slices))
	for _, slice := range slices {
		if slice == nil {
			continue
		}
		results = append(results, s.buildEndpointSliceDetails(namespace, slice.Name, slice))
	}
	return results, nil
}

func (s *Service) listEndpointSlices(ctx context.Context, namespace, service string) ([]*discoveryv1.EndpointSlice, error) {
	opts := metav1.ListOptions{}
	if service != "" {
		opts.LabelSelector = labels.Set{discoveryv1.LabelServiceName: service}.AsSelector().String()
	}
	list, err := s.deps.KubernetesClient.DiscoveryV1().EndpointSlices(namespace).List(ctx, opts)
	if err != nil {
		return nil, err
	}
	result := make([]*discoveryv1.EndpointSlice, 0, len(list.Items))
	for i := range list.Items {
		slice := list.Items[i]
		result = append(result, &slice)
	}
	return result, nil
}

func (s *Service) buildEndpointSliceDetails(namespace, name string, slice *discoveryv1.EndpointSlice) *EndpointSliceDetails {
	details := &EndpointSliceDetails{
		Kind:      "EndpointSlice",
		Name:      name,
		Namespace: namespace,
	}

	if slice == nil {
		details.Details = "Ready: 0, Ports: 0"
		details.Age = common.FormatAge(time.Time{})
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
	details.Age = common.FormatAge(slice.CreationTimestamp.Time)
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
