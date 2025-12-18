package network

import (
	"context"
	"fmt"
	"time"

	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"

	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
)

const endpointSliceTimeout = 10 * time.Second

type Dependencies struct {
	Common common.Dependencies
}

type Service struct {
	deps Dependencies
}

func NewService(deps Dependencies) *Service {
	return &Service{deps: deps}
}

func (s *Service) GetService(namespace, name string) (*restypes.ServiceDetails, error) {
	svc, err := s.deps.Common.KubernetesClient.CoreV1().Services(namespace).Get(s.deps.Common.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to get service %s/%s: %v", namespace, name, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to get service: %v", err)
	}

	ctx, cancel := s.ctx()
	defer cancel()
	slices, err := s.listEndpointSlices(ctx, namespace, name)
	if err != nil {
		s.deps.Common.Logger.Warn(fmt.Sprintf("Failed to get endpoint slices for service %s/%s: %v", namespace, name, err), "ResourceLoader")
	}

	return s.buildServiceDetails(svc, slices), nil
}

func (s *Service) Services(namespace string) ([]*restypes.ServiceDetails, error) {
	services, err := s.deps.Common.KubernetesClient.CoreV1().Services(namespace).List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Common.Logger.Error(fmt.Sprintf("Failed to list services in namespace %s: %v", namespace, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to list services: %v", err)
	}

	ctx, cancel := s.ctx()
	defer cancel()
	slices, err := s.listEndpointSlices(ctx, namespace, "")
	if err != nil {
		s.deps.Common.Logger.Warn(fmt.Sprintf("Failed to list endpoint slices in namespace %s: %v", namespace, err), "ResourceLoader")
	}
	slicesByService := groupEndpointSlicesByService(slices)

	var results []*restypes.ServiceDetails
	for i := range services.Items {
		svc := services.Items[i]
		results = append(results, s.buildServiceDetails(&svc, slicesByService[svc.Name]))
	}

	return results, nil
}

func (s *Service) ctx() (context.Context, context.CancelFunc) {
	base := s.deps.Common.Context
	if base == nil {
		base = context.Background()
	}
	if _, hasDeadline := base.Deadline(); hasDeadline {
		return base, func() {}
	}
	return context.WithTimeout(base, endpointSliceTimeout)
}

func (s *Service) buildServiceDetails(service *corev1.Service, slices []*discoveryv1.EndpointSlice) *restypes.ServiceDetails {
	details := &restypes.ServiceDetails{
		Kind:            "Service",
		Name:            service.Name,
		Namespace:       service.Namespace,
		Age:             common.FormatAge(service.CreationTimestamp.Time),
		ServiceType:     string(service.Spec.Type),
		ClusterIP:       service.Spec.ClusterIP,
		ClusterIPs:      service.Spec.ClusterIPs,
		ExternalIPs:     service.Spec.ExternalIPs,
		SessionAffinity: string(service.Spec.SessionAffinity),
		Selector:        service.Spec.Selector,
		Labels:          service.Labels,
		Annotations:     service.Annotations,
	}

	if service.Spec.SessionAffinityConfig != nil &&
		service.Spec.SessionAffinityConfig.ClientIP != nil &&
		service.Spec.SessionAffinityConfig.ClientIP.TimeoutSeconds != nil {
		details.SessionAffinityTimeout = *service.Spec.SessionAffinityConfig.ClientIP.TimeoutSeconds
	}

	for _, port := range service.Spec.Ports {
		portDetail := restypes.ServicePortDetails{
			Name:       port.Name,
			Protocol:   string(port.Protocol),
			Port:       port.Port,
			TargetPort: port.TargetPort.String(),
		}
		if service.Spec.Type == corev1.ServiceTypeNodePort || service.Spec.Type == corev1.ServiceTypeLoadBalancer {
			portDetail.NodePort = port.NodePort
		}
		details.Ports = append(details.Ports, portDetail)
	}

	if service.Spec.Type == corev1.ServiceTypeLoadBalancer {
		details.LoadBalancerStatus = "Pending"
		for _, ingress := range service.Status.LoadBalancer.Ingress {
			if ingress.IP != "" || ingress.Hostname != "" {
				if ingress.IP != "" {
					details.LoadBalancerIP = ingress.IP
				} else {
					details.LoadBalancerIP = ingress.Hostname
				}
				details.LoadBalancerStatus = "Active"
				break
			}
		}
	}

	if service.Spec.Type == corev1.ServiceTypeExternalName {
		details.ExternalName = service.Spec.ExternalName
	}

	var notReadyCount int
	details.Endpoints, notReadyCount = rollupServiceEndpoints(slices)
	details.EndpointCount = len(details.Endpoints)

	switch {
	case len(details.Endpoints) > 0:
		details.HealthStatus = "Healthy"
	case slices == nil:
		details.HealthStatus = "Unknown"
	case service.Spec.Type == corev1.ServiceTypeExternalName:
		details.HealthStatus = "External"
	case notReadyCount > 0:
		details.HealthStatus = "No endpoints"
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
