package network

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func (s *Service) Ingress(namespace, name string) (*restypes.IngressDetails, error) {
	ingress, err := s.deps.KubernetesClient.NetworkingV1().Ingresses(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get ingress %s/%s: %v", namespace, name, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to get ingress: %v", err)
	}
	return buildIngressDetails(ingress), nil
}

func (s *Service) Ingresses(namespace string) ([]*restypes.IngressDetails, error) {
	ingresses, err := s.deps.KubernetesClient.NetworkingV1().Ingresses(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list ingresses in namespace %s: %v", namespace, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to list ingresses: %v", err)
	}

	var results []*restypes.IngressDetails
	for i := range ingresses.Items {
		ing := ingresses.Items[i]
		results = append(results, buildIngressDetails(&ing))
	}

	return results, nil
}

func (s *Service) IngressClass(name string) (*restypes.IngressClassDetails, error) {
	ic, err := s.deps.KubernetesClient.NetworkingV1().IngressClasses().Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get ingress class %s: %v", name, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to get ingress class: %v", err)
	}
	return buildIngressClassDetails(ic, nil), nil
}

func (s *Service) IngressClasses() ([]*restypes.IngressClassDetails, error) {
	classes, err := s.deps.KubernetesClient.NetworkingV1().IngressClasses().List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list ingress classes: %v", err), "ResourceLoader")
		return nil, fmt.Errorf("failed to list ingress classes: %v", err)
	}

	var results []*restypes.IngressClassDetails
	for i := range classes.Items {
		ic := classes.Items[i]
		results = append(results, buildIngressClassDetails(&ic, nil))
	}

	return results, nil
}

func buildIngressDetails(ingress *networkingv1.Ingress) *restypes.IngressDetails {
	details := &restypes.IngressDetails{
		Kind:             "Ingress",
		Name:             ingress.Name,
		Namespace:        ingress.Namespace,
		Age:              common.FormatAge(ingress.CreationTimestamp.Time),
		IngressClassName: ingress.Spec.IngressClassName,
		Labels:           ingress.Labels,
		Annotations:      ingress.Annotations,
	}

	for _, rule := range ingress.Spec.Rules {
		ruleDetail := restypes.IngressRuleDetails{Host: rule.Host}
		if rule.HTTP != nil {
			for _, path := range rule.HTTP.Paths {
				pathDetail := restypes.IngressPathDetails{
					Path: path.Path,
				}
				if path.PathType != nil {
					pathDetail.PathType = string(*path.PathType)
				}
				if path.Backend.Service != nil {
					pathDetail.Backend = restypes.IngressBackendDetails{
						ServiceName: path.Backend.Service.Name,
					}
					if path.Backend.Service.Port.Number != 0 {
						pathDetail.Backend.ServicePort = fmt.Sprintf("%d", path.Backend.Service.Port.Number)
					} else if path.Backend.Service.Port.Name != "" {
						pathDetail.Backend.ServicePort = path.Backend.Service.Port.Name
					}
				} else if path.Backend.Resource != nil {
					pathDetail.Backend = restypes.IngressBackendDetails{
						Resource: fmt.Sprintf("%s/%s", path.Backend.Resource.Kind, path.Backend.Resource.Name),
					}
				}
				ruleDetail.Paths = append(ruleDetail.Paths, pathDetail)
			}
		}
		details.Rules = append(details.Rules, ruleDetail)
	}

	for _, tls := range ingress.Spec.TLS {
		details.TLS = append(details.TLS, restypes.IngressTLSDetails{
			Hosts:      tls.Hosts,
			SecretName: tls.SecretName,
		})
	}

	for _, lb := range ingress.Status.LoadBalancer.Ingress {
		if lb.IP != "" {
			details.LoadBalancerStatus = append(details.LoadBalancerStatus, lb.IP)
		} else if lb.Hostname != "" {
			details.LoadBalancerStatus = append(details.LoadBalancerStatus, lb.Hostname)
		}
	}

	if ingress.Spec.DefaultBackend != nil {
		backend := restypes.IngressBackendDetails{}
		if ingress.Spec.DefaultBackend.Service != nil {
			backend.ServiceName = ingress.Spec.DefaultBackend.Service.Name
			if ingress.Spec.DefaultBackend.Service.Port.Number != 0 {
				backend.ServicePort = fmt.Sprintf("%d", ingress.Spec.DefaultBackend.Service.Port.Number)
			} else if ingress.Spec.DefaultBackend.Service.Port.Name != "" {
				backend.ServicePort = ingress.Spec.DefaultBackend.Service.Port.Name
			}
		} else if ingress.Spec.DefaultBackend.Resource != nil {
			backend.Resource = fmt.Sprintf("%s/%s", ingress.Spec.DefaultBackend.Resource.Kind, ingress.Spec.DefaultBackend.Resource.Name)
		}
		details.DefaultBackend = &backend
	}

	if len(ingress.Spec.Rules) > 0 {
		if ingress.Spec.Rules[0].Host != "" {
			details.Details = fmt.Sprintf("Host: %s", ingress.Spec.Rules[0].Host)
		} else {
			details.Details = fmt.Sprintf("%d rule(s)", len(ingress.Spec.Rules))
		}
	} else {
		details.Details = "No rules"
	}
	if len(details.LoadBalancerStatus) > 0 {
		details.Details += fmt.Sprintf(", LB: %s", details.LoadBalancerStatus[0])
	}

	return details
}

func buildIngressClassDetails(ic *networkingv1.IngressClass, ingresses []networkingv1.Ingress) *restypes.IngressClassDetails {
	details := &restypes.IngressClassDetails{
		Kind:        "IngressClass",
		Name:        ic.Name,
		Controller:  ic.Spec.Controller,
		Age:         common.FormatAge(ic.CreationTimestamp.Time),
		Labels:      ic.Labels,
		Annotations: ic.Annotations,
	}

	if ic.Annotations != nil {
		if v, ok := ic.Annotations["ingressclass.kubernetes.io/is-default-class"]; ok && v == "true" {
			details.IsDefault = true
		}
	}

	if ic.Spec.Parameters != nil {
		params := &restypes.IngressClassParameters{
			Kind: ic.Spec.Parameters.Kind,
			Name: ic.Spec.Parameters.Name,
		}
		if ic.Spec.Parameters.APIGroup != nil {
			params.APIGroup = *ic.Spec.Parameters.APIGroup
		}
		if ic.Spec.Parameters.Namespace != nil {
			params.Namespace = *ic.Spec.Parameters.Namespace
		}
		if ic.Spec.Parameters.Scope != nil {
			params.Scope = *ic.Spec.Parameters.Scope
		}
		details.Parameters = params
	}

	for _, ingress := range ingresses {
		if ingress.Spec.IngressClassName != nil && *ingress.Spec.IngressClassName == ic.Name {
			details.Ingresses = append(details.Ingresses, fmt.Sprintf("%s/%s", ingress.Namespace, ingress.Name))
		}
	}

	details.Details = fmt.Sprintf("Controller: %s", ic.Spec.Controller)
	if details.IsDefault {
		details.Details += " (default)"
	}
	if len(details.Ingresses) > 0 {
		details.Details += fmt.Sprintf(", Used by %d ingress(es)", len(details.Ingresses))
	}

	return details
}
