/*
 * backend/resources/network/services.go
 *
 * Service resource handlers.
 * - Builds service details for the frontend.
 */

package network

import (
	"context"
	"fmt"

	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
)

func (s *Service) GetService(namespace, name string) (*types.ServiceDetails, error) {
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

func (s *Service) buildServiceDetails(service *corev1.Service, slices []*discoveryv1.EndpointSlice) *types.ServiceDetails {
	model := resourcemodel.BuildServiceResourceModel(s.deps.ClusterID, service, slices)
	facts := model.Facts.Service
	details := &types.ServiceDetails{
		Kind:             "Service",
		Name:             service.Name,
		Namespace:        service.Namespace,
		Age:              common.FormatAge(service.CreationTimestamp.Time),
		StatusProjection: types.NewStatusProjection(model.Status),
		ServiceType:      facts.Type,
		ClusterIP:        facts.ClusterIP,
		ClusterIPs:       facts.ClusterIPs,
		ExternalIPs:      facts.ExternalIPs,
		SessionAffinity:  facts.SessionAffinity,
		Selector:         facts.Selector,
		Labels:           service.Labels,
		Annotations:      service.Annotations,
	}

	details.SessionAffinityTimeout = facts.SessionAffinityTimeout

	for _, port := range facts.Ports {
		portDetail := types.ServicePortDetails{
			Name:       port.Name,
			Protocol:   port.Protocol,
			Port:       port.Port,
			TargetPort: port.TargetPort,
			NodePort:   port.NodePort,
		}
		details.Ports = append(details.Ports, portDetail)
	}

	if service.Spec.Type == corev1.ServiceTypeLoadBalancer {
		details.LoadBalancerStatus = "Pending"
		if len(facts.LoadBalancerAddresses) > 0 {
			details.LoadBalancerIP = facts.LoadBalancerAddresses[0]
			details.LoadBalancerStatus = "Active"
		}
	}

	if service.Spec.Type == corev1.ServiceTypeExternalName {
		details.ExternalName = facts.ExternalName
	}

	details.Endpoints = facts.Endpoints
	details.EndpointCount = len(details.Endpoints)

	switch {
	case len(details.Endpoints) > 0:
		details.HealthStatus = "Healthy"
	case slices == nil:
		details.HealthStatus = "Unknown"
	case service.Spec.Type == corev1.ServiceTypeExternalName:
		details.HealthStatus = "External"
	default:
		details.HealthStatus = "No endpoints"
	}

	typeInfo := string(service.Spec.Type)
	portInfo := fmt.Sprintf("%d port(s)", len(service.Spec.Ports))

	endpointInfo := ""
	switch details.HealthStatus {
	case "Healthy":
		endpointInfo = fmt.Sprintf(", %d endpoint(s)", details.EndpointCount)
	case "No endpoints":
		endpointInfo = ", No endpoints"
	}

	ipInfo := ""
	if service.Spec.ClusterIP != "" && service.Spec.ClusterIP != "None" {
		ipInfo = fmt.Sprintf(", %s", service.Spec.ClusterIP)
	}

	details.Details = fmt.Sprintf("%s, %s%s%s", typeInfo, portInfo, endpointInfo, ipInfo)

	return details
}
