/*
 * backend/resources/network/endpoint_slices.go
 *
 * EndpointSlice resource handlers.
 * - Aggregates slice details by service.
 */

package network

import (
	"context"
	"fmt"
	"sort"
	"time"

	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
)

// EndpointSlice returns slice details grouped by service name.
func (s *Service) EndpointSlice(namespace, service string) (*types.EndpointSliceDetails, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	slices, err := s.listEndpointSlices(ctx, namespace, service)
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get endpoint slices %s/%s: %v", namespace, service, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to get endpoint slices: %v", err)
	}
	return buildEndpointSliceDetails(namespace, service, slices), nil
}

// EndpointSlices lists slice details for every service in the namespace.
func (s *Service) EndpointSlices(namespace string) ([]*types.EndpointSliceDetails, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	slices, err := s.listEndpointSlices(ctx, namespace, "")
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list endpoint slices in namespace %s: %v", namespace, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to list endpoint slices: %v", err)
	}

	grouped := groupEndpointSlicesByService(slices)
	results := make([]*types.EndpointSliceDetails, 0, len(grouped))
	for service, serviceSlices := range grouped {
		results = append(results, buildEndpointSliceDetails(namespace, service, serviceSlices))
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

func endpointReady(endpoint discoveryv1.Endpoint) bool {
	if endpoint.Conditions.Ready != nil && !*endpoint.Conditions.Ready {
		return false
	}
	if endpoint.Conditions.Serving != nil && !*endpoint.Conditions.Serving {
		return false
	}
	if endpoint.Conditions.Terminating != nil && *endpoint.Conditions.Terminating {
		return false
	}
	return true
}

func buildEndpointSliceDetails(namespace, service string, slices []*discoveryv1.EndpointSlice) *types.EndpointSliceDetails {
	details := &types.EndpointSliceDetails{
		Kind:      "EndpointSlice",
		Name:      service,
		Namespace: namespace,
	}

	if len(slices) == 0 {
		details.Details = "Ready: 0, Ports: 0"
		details.Age = common.FormatAge(time.Time{})
		return details
	}

	sort.SliceStable(slices, func(i, j int) bool {
		return slices[i].Name < slices[j].Name
	})

	var earliest time.Time
	for _, slice := range slices {
		if slice == nil {
			continue
		}
		summary := types.EndpointSliceSummary{
			Name:        slice.Name,
			AddressType: string(slice.AddressType),
			Age:         common.FormatAge(slice.CreationTimestamp.Time),
			Ports:       slicePortsToDetails(slice.Ports),
		}

		ready, notReady := endpointAddressesFromSlice(slice)
		summary.ReadyAddresses = ready
		summary.NotReadyAddresses = notReady

		details.Slices = append(details.Slices, summary)
		details.TotalReady += len(ready)
		details.TotalNotReady += len(notReady)
		details.TotalPorts += len(summary.Ports)

		if earliest.IsZero() || slice.CreationTimestamp.Time.Before(earliest) {
			earliest = slice.CreationTimestamp.Time
		}
		if len(details.Labels) == 0 && len(slice.Labels) > 0 {
			details.Labels = slice.Labels
		}
		if len(details.Annotations) == 0 && len(slice.Annotations) > 0 {
			details.Annotations = slice.Annotations
		}
	}

	details.Age = common.FormatAge(earliest)
	details.Details = fmt.Sprintf("Ready: %d", details.TotalReady)
	if details.TotalNotReady > 0 {
		details.Details += fmt.Sprintf(", Not Ready: %d", details.TotalNotReady)
	}
	details.Details += fmt.Sprintf(", Ports: %d", details.TotalPorts)

	return details
}

func slicePortsToDetails(ports []discoveryv1.EndpointPort) []types.EndpointSlicePort {
	if len(ports) == 0 {
		return nil
	}
	result := make([]types.EndpointSlicePort, 0, len(ports))
	for _, port := range ports {
		detail := types.EndpointSlicePort{
			Port: portNumber(port),
		}
		if port.Name != nil {
			detail.Name = *port.Name
		}
		if port.Protocol != nil {
			detail.Protocol = string(*port.Protocol)
		}
		if port.AppProtocol != nil {
			detail.AppProtocol = *port.AppProtocol
		}
		result = append(result, detail)
	}
	return result
}

func endpointAddressesFromSlice(slice *discoveryv1.EndpointSlice) ([]types.EndpointSliceAddress, []types.EndpointSliceAddress) {
	ready := []types.EndpointSliceAddress{}
	notReady := []types.EndpointSliceAddress{}

	for _, endpoint := range slice.Endpoints {
		if len(endpoint.Addresses) == 0 {
			continue
		}
		target := &ready
		if !endpointReady(endpoint) {
			target = &notReady
		}
		for _, address := range endpoint.Addresses {
			targetRef := ""
			if endpoint.TargetRef != nil {
				targetRef = fmt.Sprintf("%s/%s", endpoint.TargetRef.Kind, endpoint.TargetRef.Name)
			}
			next := types.EndpointSliceAddress{
				IP: address,
			}
			if endpoint.Hostname != nil {
				next.Hostname = *endpoint.Hostname
			}
			if endpoint.NodeName != nil {
				next.NodeName = *endpoint.NodeName
			}
			if targetRef != "" {
				next.TargetRef = targetRef
			}
			*target = append(*target, next)
		}
	}

	return ready, notReady
}

func rollupServiceEndpoints(slices []*discoveryv1.EndpointSlice) (ready []string, notReady int) {
	for _, slice := range slices {
		if slice == nil || len(slice.Ports) == 0 {
			continue
		}
		for _, endpoint := range slice.Endpoints {
			if len(endpoint.Addresses) == 0 {
				continue
			}
			if !endpointReady(endpoint) {
				notReady += len(endpoint.Addresses)
				continue
			}
			for _, addr := range endpoint.Addresses {
				for _, port := range slice.Ports {
					ready = append(ready, fmt.Sprintf("%s:%d", addr, portNumber(port)))
				}
			}
		}
	}
	return ready, notReady
}

func groupEndpointSlicesByService(slices []*discoveryv1.EndpointSlice) map[string][]*discoveryv1.EndpointSlice {
	result := make(map[string][]*discoveryv1.EndpointSlice)
	for _, slice := range slices {
		if slice == nil {
			continue
		}
		serviceName := slice.Labels[discoveryv1.LabelServiceName]
		if serviceName == "" {
			continue
		}
		result[serviceName] = append(result[serviceName], slice)
	}
	return result
}

func portNumber(port discoveryv1.EndpointPort) int32 {
	if port.Port != nil {
		return *port.Port
	}
	return 0
}
