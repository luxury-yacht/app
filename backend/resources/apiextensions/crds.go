/*
 * backend/resources/apiextensions/crds.go
 *
 * CustomResourceDefinition resource handlers.
 * - Builds detail and list views for the frontend.
 */

package apiextensions

import (
	"fmt"

	"github.com/luxury-yacht/app/backend/internal/applog"
	"github.com/luxury-yacht/app/backend/internal/logsources"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// CustomResourceDefinition returns a detailed view for a single CRD.
func (s *Service) CustomResourceDefinition(name string) (*types.CustomResourceDefinitionDetails, error) {
	if err := s.ensureAPIExtensions("CustomResourceDefinition"); err != nil {
		return nil, err
	}

	client := s.deps.APIExtensionsClient
	crd, err := client.ApiextensionsV1().CustomResourceDefinitions().Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to get CRD %s: %v", name, err))
		return nil, fmt.Errorf("failed to get CRD: %v", err)
	}

	return s.buildCRDDetails(crd), nil
}

// CustomResourceDefinitions returns detailed views for all CRDs.
func (s *Service) CustomResourceDefinitions() ([]*types.CustomResourceDefinitionDetails, error) {
	if err := s.ensureAPIExtensions("CustomResourceDefinition"); err != nil {
		return nil, err
	}

	client := s.deps.APIExtensionsClient
	crds, err := client.ApiextensionsV1().CustomResourceDefinitions().List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.logError(fmt.Sprintf("Failed to list CRDs: %v", err))
		return nil, fmt.Errorf("failed to list CRDs: %v", err)
	}

	result := make([]*types.CustomResourceDefinitionDetails, 0, len(crds.Items))
	for i := range crds.Items {
		result = append(result, s.buildCRDDetails(&crds.Items[i]))
	}

	return result, nil
}

func (s *Service) buildCRDDetails(crd *apiextensionsv1.CustomResourceDefinition) *types.CustomResourceDefinitionDetails {
	model := resourcemodel.BuildCustomResourceDefinitionResourceModel(s.deps.ClusterID, crd)
	facts := model.Facts.CustomResourceDefinition
	details := &types.CustomResourceDefinitionDetails{
		Kind:        "CustomResourceDefinition",
		Name:        crd.Name,
		Age:         common.FormatAge(crd.CreationTimestamp.Time),
		Labels:      model.Metadata.Labels,
		Annotations: model.Metadata.Annotations,
	}

	if facts != nil {
		details.Group = facts.Group
		details.Scope = facts.Scope
		details.Versions = crdVersionsFromFacts(facts.Versions)
		details.Names = crdNamesFromFacts(facts.Names)
		details.ConversionStrategy = facts.ConversionStrategy
		details.Conditions = crdConditionsFromFacts(facts.Conditions)
		details.Details = fmt.Sprintf("Group: %s, Scope: %s", facts.Group, facts.Scope)
		if len(facts.Versions) > 0 {
			details.Details += fmt.Sprintf(", Versions: %d", len(facts.Versions))
		}
	}

	return details
}

func crdVersionsFromFacts(facts []resourcemodel.CRDVersionFacts) []types.CRDVersion {
	if len(facts) == 0 {
		return nil
	}
	versions := make([]types.CRDVersion, 0, len(facts))
	for _, fact := range facts {
		version := types.CRDVersion{
			Name:       fact.Name,
			Served:     fact.Served,
			Storage:    fact.Storage,
			Deprecated: fact.Deprecated,
		}
		if fact.HasSchema {
			version.Schema = map[string]interface{}{"type": "object", "hasSchema": true}
		}
		versions = append(versions, version)
	}
	return versions
}

func crdNamesFromFacts(facts resourcemodel.CRDNamesFacts) types.CRDNames {
	return types.CRDNames{
		Plural:     facts.Plural,
		Singular:   facts.Singular,
		Kind:       facts.Kind,
		ListKind:   facts.ListKind,
		ShortNames: append([]string(nil), facts.ShortNames...),
		Categories: append([]string(nil), facts.Categories...),
	}
}

func crdConditionsFromFacts(facts []resourcemodel.ConditionFacts) []types.CRDCondition {
	if len(facts) == 0 {
		return nil
	}
	conditions := make([]types.CRDCondition, 0, len(facts))
	for _, fact := range facts {
		conditions = append(conditions, types.CRDCondition{
			Kind:               fact.Type,
			Status:             fact.Status,
			Reason:             fact.Reason,
			Message:            fact.Message,
			LastTransitionTime: fact.LastTransitionTime,
		})
	}
	return conditions
}

func (s *Service) ensureAPIExtensions(resource string) error {
	if s.deps.EnsureAPIExtensions != nil {
		return s.deps.EnsureAPIExtensions(resource)
	}
	if s.deps.APIExtensionsClient == nil {
		return fmt.Errorf("apiextensions client not initialized")
	}
	return nil
}

func (s *Service) logError(msg string) {
	applog.Error(s.deps.Logger, msg, logsources.ResourceLoader)
}
