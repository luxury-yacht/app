/*
 * backend/resources/ingressclass/details.go
 *
 * IngressClass resource handlers, co-located in the per-kind package. Intrinsic
 * fields come from the single model (ingressclass.Facts).
 */

package ingressclass

import (
	"context"
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
func (s *Service) IngressClass(ctx context.Context, name string) (*IngressClassDetails, error) {
	ic, err := s.deps.KubernetesClient.NetworkingV1().IngressClasses().Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		err = s.deps.LogResourceRequestFailure(err, fmt.Sprintf("Failed to get ingress class %s", name), "get", Identity, logsources.ResourceLoader)
		return nil, fmt.Errorf("failed to get ingress class: %w", err)
	}
	return s.buildIngressClassDetails(ic), nil
}

func (s *Service) buildIngressClassDetails(ic *networkingv1.IngressClass) *IngressClassDetails {
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

	details.Details = fmt.Sprintf("Controller: %s", ic.Spec.Controller)
	if details.IsDefault {
		details.Details += " (default)"
	}

	return details
}
