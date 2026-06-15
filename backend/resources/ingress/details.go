/*
 * backend/resources/ingress/details.go
 *
 * Ingress resource handlers, co-located in the per-kind package. Intrinsic fields
 * come from the single model (ingress.Facts).
 */

package ingress

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resources/common"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Service provides detailed Ingress views backed by shared dependencies.
type Service struct {
	deps common.Dependencies
}

// NewService constructs an Ingress service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// Ingress returns the detailed view for a single ingress.
func (s *Service) Ingress(namespace, name string) (*IngressDetails, error) {
	ingress, err := s.deps.KubernetesClient.NetworkingV1().Ingresses(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get ingress %s/%s: %v", namespace, name, err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to get ingress: %v", err)
	}
	return s.buildIngressDetails(ingress), nil
}

// Ingresses returns detailed views for all ingresses in a namespace.
func (s *Service) Ingresses(namespace string) ([]*IngressDetails, error) {
	ingresses, err := s.deps.KubernetesClient.NetworkingV1().Ingresses(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list ingresses in namespace %s: %v", namespace, err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to list ingresses: %v", err)
	}

	var results []*IngressDetails
	for i := range ingresses.Items {
		ing := ingresses.Items[i]
		results = append(results, s.buildIngressDetails(&ing))
	}

	return results, nil
}

func (s *Service) buildIngressDetails(ingress *networkingv1.Ingress) *IngressDetails {
	facts := BuildFacts(s.deps.ClusterID, ingress)
	details := &IngressDetails{
		Kind:             "Ingress",
		Name:             ingress.Name,
		Namespace:        ingress.Namespace,
		Age:              common.FormatAge(ingress.CreationTimestamp.Time),
		IngressClassName: ingressClassNamePointer(facts.ClassName),
		Labels:           ingress.Labels,
		Annotations:      ingress.Annotations,
	}

	for _, rule := range facts.Rules {
		ruleDetail := IngressRuleDetails{Host: rule.Host}
		for _, path := range rule.Paths {
			pathDetail := IngressPathDetails{
				Path:     path.Path,
				PathType: path.PathType,
				Backend:  backendFactsToDetails(path.Backend),
			}
			ruleDetail.Paths = append(ruleDetail.Paths, pathDetail)
		}
		details.Rules = append(details.Rules, ruleDetail)
	}

	for _, tls := range facts.TLS {
		secretName := ""
		if tls.SecretRef != nil && tls.SecretRef.Display != nil {
			secretName = tls.SecretRef.Display.Name
		}
		details.TLS = append(details.TLS, IngressTLSDetails{
			Hosts:      tls.Hosts,
			SecretName: secretName,
		})
	}

	details.LoadBalancerStatus = facts.Addresses

	if facts.DefaultBackend != nil {
		backend := backendFactsToDetails(*facts.DefaultBackend)
		details.DefaultBackend = &backend
	}

	if len(facts.Rules) > 0 {
		if facts.Rules[0].Host != "" {
			details.Details = fmt.Sprintf("Host: %s", facts.Rules[0].Host)
		} else {
			details.Details = fmt.Sprintf("%d rule(s)", len(facts.Rules))
		}
	} else {
		details.Details = "No rules"
	}
	if len(details.LoadBalancerStatus) > 0 {
		details.Details += fmt.Sprintf(", LB: %s", details.LoadBalancerStatus[0])
	}

	return details
}

func ingressClassNamePointer(className string) *string {
	if className == "" {
		return nil
	}
	return &className
}

func backendFactsToDetails(backend BackendFacts) IngressBackendDetails {
	return IngressBackendDetails{
		ServiceName: backend.ServiceName,
		ServicePort: backend.ServicePort,
		Resource:    backend.Resource,
	}
}
