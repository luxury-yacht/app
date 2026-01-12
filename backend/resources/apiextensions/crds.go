package apiextensions

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// CustomResourceDefinition returns a detailed view for a single CRD.
func (s *Service) CustomResourceDefinition(name string) (*restypes.CustomResourceDefinitionDetails, error) {
	if err := s.ensureAPIExtensions("CustomResourceDefinition"); err != nil {
		return nil, err
	}

	client := s.deps.Common.APIExtensionsClient
	crd, err := client.ApiextensionsV1().CustomResourceDefinitions().Get(s.deps.Common.Context, name, metav1.GetOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to get CRD %s: %v", name, err))
		return nil, fmt.Errorf("failed to get CRD: %v", err)
	}

	return s.buildCRDDetails(crd), nil
}

// CustomResourceDefinitions returns detailed views for all CRDs.
func (s *Service) CustomResourceDefinitions() ([]*restypes.CustomResourceDefinitionDetails, error) {
	if err := s.ensureAPIExtensions("CustomResourceDefinition"); err != nil {
		return nil, err
	}

	client := s.deps.Common.APIExtensionsClient
	crds, err := client.ApiextensionsV1().CustomResourceDefinitions().List(s.deps.Common.Context, metav1.ListOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to list CRDs: %v", err))
		return nil, fmt.Errorf("failed to list CRDs: %v", err)
	}

	result := make([]*restypes.CustomResourceDefinitionDetails, 0, len(crds.Items))
	for i := range crds.Items {
		result = append(result, s.buildCRDDetails(&crds.Items[i]))
	}

	return result, nil
}

func (s *Service) buildCRDDetails(crd *apiextensionsv1.CustomResourceDefinition) *restypes.CustomResourceDefinitionDetails {
	details := &restypes.CustomResourceDefinitionDetails{
		Kind:        "CustomResourceDefinition",
		Name:        crd.Name,
		Group:       crd.Spec.Group,
		Scope:       string(crd.Spec.Scope),
		Age:         common.FormatAge(crd.CreationTimestamp.Time),
		Labels:      crd.Labels,
		Annotations: crd.Annotations,
	}

	for _, version := range crd.Spec.Versions {
		entry := restypes.CRDVersion{
			Name:       version.Name,
			Served:     version.Served,
			Storage:    version.Storage,
			Deprecated: version.Deprecated,
		}
		if version.Schema != nil && version.Schema.OpenAPIV3Schema != nil {
			entry.Schema = map[string]interface{}{"type": "object", "hasSchema": true}
		}
		details.Versions = append(details.Versions, entry)
	}

	details.Names = restypes.CRDNames{
		Plural:     crd.Spec.Names.Plural,
		Singular:   crd.Spec.Names.Singular,
		Kind:       crd.Spec.Names.Kind,
		ListKind:   crd.Spec.Names.ListKind,
		ShortNames: append([]string{}, crd.Spec.Names.ShortNames...),
		Categories: append([]string{}, crd.Spec.Names.Categories...),
	}

	if crd.Spec.Conversion != nil {
		details.ConversionStrategy = string(crd.Spec.Conversion.Strategy)
	}

	for _, condition := range crd.Status.Conditions {
		details.Conditions = append(details.Conditions, restypes.CRDCondition{
			Kind:               string(condition.Type),
			Status:             string(condition.Status),
			Reason:             condition.Reason,
			Message:            condition.Message,
			LastTransitionTime: condition.LastTransitionTime,
		})
	}

	details.Details = fmt.Sprintf("Group: %s, Scope: %s", crd.Spec.Group, crd.Spec.Scope)
	if len(crd.Spec.Versions) > 0 {
		details.Details += fmt.Sprintf(", Versions: %d", len(crd.Spec.Versions))
	}

	return details
}

func (s *Service) ensureAPIExtensions(resource string) error {
	if s.deps.Common.EnsureAPIExtensions != nil {
		return s.deps.Common.EnsureAPIExtensions(resource)
	}
	if s.deps.Common.APIExtensionsClient == nil {
		return fmt.Errorf("apiextensions client not initialized")
	}
	return nil
}

func (s *Service) logError(msg string) {
	if s.deps.Common.Logger != nil {
		s.deps.Common.Logger.Error(msg, "ResourceLoader")
	}
}
