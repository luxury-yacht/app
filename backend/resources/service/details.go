/*
 * backend/resources/service/details.go
 *
 * Service resource handlers, co-located in the per-kind package. Intrinsic fields
 * come from the single model (service.Facts); the Service detail also enumerates
 * its EndpointSlices to report endpoint health.
 */

package service

import (
	"context"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/labels"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
)

// Service provides detailed Service views backed by shared dependencies.
type Service struct {
	deps common.Dependencies
}

// NewService constructs a Service service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// GetService returns the detailed view for a single service, including endpoint
// health derived from its EndpointSlices.
func (s *Service) GetService(namespace, name string) (*ServiceDetails, error) {
	svc, err := s.deps.KubernetesClient.CoreV1().Services(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get service %s/%s: %v", namespace, name, err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to get service: %v", err)
	}

	ctx, cancel := s.ctx()
	defer cancel()
	slices, err := s.listEndpointSlices(ctx, namespace, name)
	if err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to get endpoint slices for service %s/%s: %v", namespace, name, err), logsources.ResourceLoader)
	}

	return s.buildServiceDetails(svc, slices), nil
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

// listEndpointSlices lists the EndpointSlices for a service (filtered by the
// service-name label) so the Service detail can enumerate its endpoints. The
// EndpointSlice kind owns its own detail/list in resources/endpointslice; this
// is the Service detail's own dependency.
func (s *Service) listEndpointSlices(ctx context.Context, namespace, serviceName string) ([]*discoveryv1.EndpointSlice, error) {
	opts := metav1.ListOptions{}
	if serviceName != "" {
		opts.LabelSelector = labels.Set{discoveryv1.LabelServiceName: serviceName}.AsSelector().String()
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

func (s *Service) buildServiceDetails(svc *corev1.Service, slices []*discoveryv1.EndpointSlice) *ServiceDetails {
	model := BuildResourceModel(s.deps.ClusterID, svc, slices)
	facts := BuildFacts(svc, slices)
	details := &ServiceDetails{
		Kind:             "Service",
		Name:             svc.Name,
		Namespace:        svc.Namespace,
		Age:              common.FormatAge(svc.CreationTimestamp.Time),
		StatusProjection: restypes.NewStatusProjection(model.Status),
		ServiceType:      facts.Type,
		ClusterIP:        facts.ClusterIP,
		ClusterIPs:       facts.ClusterIPs,
		ExternalIPs:      facts.ExternalIPs,
		SessionAffinity:  facts.SessionAffinity,
		Selector:         facts.Selector,
		Labels:           svc.Labels,
		Annotations:      svc.Annotations,
	}

	details.SessionAffinityTimeout = facts.SessionAffinityTimeout

	for _, port := range facts.Ports {
		// PortFacts and ServicePortDetails are field-identical; convert directly.
		details.Ports = append(details.Ports, ServicePortDetails(port))
	}

	if facts.Type == string(corev1.ServiceTypeLoadBalancer) {
		details.LoadBalancerStatus = "Pending"
		if len(facts.LoadBalancerAddresses) > 0 {
			details.LoadBalancerIP = facts.LoadBalancerAddresses[0]
			details.LoadBalancerStatus = "Active"
		}
	}

	if facts.Type == string(corev1.ServiceTypeExternalName) {
		details.ExternalName = facts.ExternalName
	}

	details.Endpoints = facts.Endpoints
	details.EndpointCount = len(details.Endpoints)

	switch {
	case len(details.Endpoints) > 0:
		details.HealthStatus = "Healthy"
	case slices == nil:
		details.HealthStatus = "Unknown"
	case facts.Type == string(corev1.ServiceTypeExternalName):
		details.HealthStatus = "External"
	default:
		details.HealthStatus = "No endpoints"
	}

	typeInfo := facts.Type
	portInfo := fmt.Sprintf("%d port(s)", len(facts.Ports))

	endpointInfo := ""
	switch details.HealthStatus {
	case "Healthy":
		endpointInfo = fmt.Sprintf(", %d endpoint(s)", details.EndpointCount)
	case "No endpoints":
		endpointInfo = ", No endpoints"
	}

	ipInfo := ""
	if facts.ClusterIP != "" && facts.ClusterIP != "None" {
		ipInfo = fmt.Sprintf(", %s", facts.ClusterIP)
	}

	details.Details = fmt.Sprintf("%s, %s%s%s", typeInfo, portInfo, endpointInfo, ipInfo)

	return details
}
