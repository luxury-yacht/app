package network

import (
	"context"
	"fmt"

	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"

	restypes "github.com/luxury-yacht/app/backend/resources/types"
)

// EndpointSlice returns slice details grouped by service name.
func (s *Service) EndpointSlice(namespace, service string) (*restypes.EndpointSliceDetails, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	slices, err := s.listEndpointSlices(ctx, namespace, service)
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to get endpoint slices %s/%s: %v", namespace, service, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to get endpoint slices: %v", err)
	}
	return buildEndpointSliceDetails(namespace, service, slices), nil
}

// EndpointSlices lists slice details for every service in the namespace.
func (s *Service) EndpointSlices(namespace string) ([]*restypes.EndpointSliceDetails, error) {
	ctx, cancel := s.ctx()
	defer cancel()
	slices, err := s.listEndpointSlices(ctx, namespace, "")
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to list endpoint slices in namespace %s: %v", namespace, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to list endpoint slices: %v", err)
	}

	grouped := groupEndpointSlicesByService(slices)
	results := make([]*restypes.EndpointSliceDetails, 0, len(grouped))
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
	list, err := s.deps.Common.KubernetesClient.DiscoveryV1().EndpointSlices(namespace).List(ctx, opts)
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
