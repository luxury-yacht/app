/*
 * backend/resources/ingressclass/details.go
 *
 * IngressClass resource handlers, co-located in the per-kind package. Intrinsic
 * fields come from the single model (ingressclass.Facts).
 */

package ingressclass

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resources/common"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// Service provides detailed IngressClass views backed by shared dependencies.
type Service struct {
	deps common.Dependencies
}

// NewService constructs an IngressClass service using the supplied dependencies bundle.
func NewService(deps common.Dependencies) *Service {
	return &Service{deps: deps}
}

// IngressClass returns the detailed view for a single ingress class.
func (s *Service) IngressClass(name string) (*IngressClassDetails, error) {
	ic, err := s.deps.KubernetesClient.NetworkingV1().IngressClasses().Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get ingress class %s: %v", name, err), logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to get ingress class: %v", err)
	}
	return s.buildIngressClassDetails(ic, nil), nil
}

func (s *Service) buildIngressClassDetails(ic *networkingv1.IngressClass, ingresses []networkingv1.Ingress) *IngressClassDetails {
	facts := BuildFacts(ic)
	details := &IngressClassDetails{
		Kind:        "IngressClass",
		Name:        ic.Name,
		Controller:  facts.Controller,
		Labels:      ic.Labels,
		Annotations: ic.Annotations,
	}

	details.IsDefault = facts.DefaultClass

	if ic.Spec.Parameters != nil {
		params := &IngressClassParameters{
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
