/*
 * backend/resources/network/ingresses.go
 *
 * Ingress and IngressClass resource handlers.
 * - Builds detail and list views for ingress resources.
 */

package network

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func (s *Service) Ingress(namespace, name string) (*types.IngressDetails, error) {
	ingress, err := s.deps.KubernetesClient.NetworkingV1().Ingresses(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get ingress %s/%s: %v", namespace, name, err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to get ingress: %v", err)
	}
	return s.buildIngressDetails(ingress), nil
}

func (s *Service) Ingresses(namespace string) ([]*types.IngressDetails, error) {
	ingresses, err := s.deps.KubernetesClient.NetworkingV1().Ingresses(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list ingresses in namespace %s: %v", namespace, err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to list ingresses: %v", err)
	}

	var results []*types.IngressDetails
	for i := range ingresses.Items {
		ing := ingresses.Items[i]
		results = append(results, s.buildIngressDetails(&ing))
	}

	return results, nil
}

func (s *Service) IngressClass(name string) (*types.IngressClassDetails, error) {
	ic, err := s.deps.KubernetesClient.NetworkingV1().IngressClasses().Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get ingress class %s: %v", name, err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to get ingress class: %v", err)
	}
	return s.buildIngressClassDetails(ic, nil), nil
}

func (s *Service) IngressClasses() ([]*types.IngressClassDetails, error) {
	classes, err := s.deps.KubernetesClient.NetworkingV1().IngressClasses().List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list ingress classes: %v", err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to list ingress classes: %v", err)
	}

	var results []*types.IngressClassDetails
	for i := range classes.Items {
		ic := classes.Items[i]
		results = append(results, s.buildIngressClassDetails(&ic, nil))
	}

	return results, nil
}

func (s *Service) buildIngressDetails(ingress *networkingv1.Ingress) *types.IngressDetails {
	model := resourcemodel.BuildIngressResourceModel(s.deps.ClusterID, ingress)
	facts := model.Facts.Ingress
	details := &types.IngressDetails{
		Kind:             "Ingress",
		Name:             ingress.Name,
		Namespace:        ingress.Namespace,
		Age:              common.FormatAge(ingress.CreationTimestamp.Time),
		IngressClassName: ingressClassNamePointer(facts.ClassName),
		Labels:           ingress.Labels,
		Annotations:      ingress.Annotations,
	}

	for _, rule := range facts.Rules {
		ruleDetail := types.IngressRuleDetails{Host: rule.Host}
		for _, path := range rule.Paths {
			pathDetail := types.IngressPathDetails{
				Path:     path.Path,
				PathType: path.PathType,
				Backend:  ingressBackendFactsToDetails(path.Backend),
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
		details.TLS = append(details.TLS, types.IngressTLSDetails{
			Hosts:      tls.Hosts,
			SecretName: secretName,
		})
	}

	details.LoadBalancerStatus = facts.Addresses

	if facts.DefaultBackend != nil {
		backend := ingressBackendFactsToDetails(*facts.DefaultBackend)
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

func (s *Service) buildIngressClassDetails(ic *networkingv1.IngressClass, ingresses []networkingv1.Ingress) *types.IngressClassDetails {
	model := resourcemodel.BuildIngressClassResourceModel(s.deps.ClusterID, ic)
	facts := model.Facts.IngressClass
	details := &types.IngressClassDetails{
		Kind:        "IngressClass",
		Name:        ic.Name,
		Controller:  facts.Controller,
		Age:         common.FormatAge(ic.CreationTimestamp.Time),
		Labels:      ic.Labels,
		Annotations: ic.Annotations,
	}

	details.IsDefault = facts.DefaultClass

	if ic.Spec.Parameters != nil {
		params := &types.IngressClassParameters{
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

func ingressClassNamePointer(className string) *string {
	if className == "" {
		return nil
	}
	return &className
}

func ingressBackendFactsToDetails(backend resourcemodel.IngressBackendFacts) types.IngressBackendDetails {
	return types.IngressBackendDetails{
		ServiceName: backend.ServiceName,
		ServicePort: backend.ServicePort,
		Resource:    backend.Resource,
	}
}
