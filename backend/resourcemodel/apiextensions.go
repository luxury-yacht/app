package resourcemodel

import (
	"fmt"
	"strings"

	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
)

const apiextensionsAPIGroup = "apiextensions.k8s.io"

func BuildCustomResourceDefinitionResourceModel(clusterID string, crd *apiextensionsv1.CustomResourceDefinition) ResourceModel {
	facts := BuildCustomResourceDefinitionFacts(crd)
	status := BuildCustomResourceDefinitionStatusPresentation(crd, facts)
	return networkResourceModel(clusterID, apiextensionsAPIGroup, "v1", "CustomResourceDefinition", "customresourcedefinitions", ResourceScopeCluster, crd.ObjectMeta, status, ResourceFacts{CustomResourceDefinition: &facts})
}

func BuildCustomResourceDefinitionFacts(crd *apiextensionsv1.CustomResourceDefinition) CustomResourceDefinitionFacts {
	storageVersion, extraServed := customResourceDefinitionVersionSummary(crd.Spec.Versions)
	facts := CustomResourceDefinitionFacts{
		Group:                   crd.Spec.Group,
		Scope:                   string(crd.Spec.Scope),
		Names:                   customResourceDefinitionNamesFacts(crd.Spec.Names),
		Versions:                customResourceDefinitionVersionFacts(crd.Spec.Versions),
		Conditions:              customResourceDefinitionConditionFacts(crd.Status.Conditions),
		StorageVersion:          storageVersion,
		ExtraServedVersionCount: extraServed,
	}
	if crd.Spec.Conversion != nil {
		facts.ConversionStrategy = string(crd.Spec.Conversion.Strategy)
	}
	return facts
}

func BuildCustomResourceDefinitionStatusPresentation(crd *apiextensionsv1.CustomResourceDefinition, facts CustomResourceDefinitionFacts) ResourceStatusPresentation {
	signals := make([]ResourceStatusSignal, 0, len(facts.Conditions)+1)
	if facts.StorageVersion != "" {
		signals = append(signals, ResourceStatusSignal{
			Type:   StatusSignalResourceState,
			Name:   "spec.versions.storage",
			Status: facts.StorageVersion,
		})
	}
	for _, condition := range facts.Conditions {
		signals = append(signals, ResourceStatusSignal{
			Type:    StatusSignalCondition,
			Name:    condition.Type,
			Status:  condition.Status,
			Reason:  condition.Reason,
			Message: condition.Message,
		})
	}

	lifecycle := networkLifecycle(crd.ObjectMeta)
	if status, ok := deletingNetworkStatus(crd.ObjectMeta, facts.StorageVersion, signals, lifecycle); ok {
		return status
	}
	return networkSourceStatus(CustomResourceDefinitionVersionDetails(facts), facts.StorageVersion, "", "ready", signals, lifecycle)
}

func CustomResourceDefinitionVersionDetails(facts CustomResourceDefinitionFacts) string {
	if len(facts.Versions) == 0 {
		return "Versions: -"
	}
	versions := make([]string, 0, len(facts.Versions))
	for _, version := range facts.Versions {
		label := version.Name
		if version.Served && version.Storage {
			label += "*"
		}
		versions = append(versions, label)
	}
	return fmt.Sprintf("Versions: %s", strings.Join(versions, ","))
}

func customResourceDefinitionVersionSummary(versions []apiextensionsv1.CustomResourceDefinitionVersion) (storageVersion string, extraServed int) {
	if len(versions) == 0 {
		return "", 0
	}
	for _, version := range versions {
		if version.Storage {
			storageVersion = version.Name
			break
		}
	}
	if storageVersion == "" {
		for _, version := range versions {
			if version.Served {
				storageVersion = version.Name
				break
			}
		}
	}
	if storageVersion == "" {
		storageVersion = versions[0].Name
	}
	for _, version := range versions {
		if version.Served && version.Name != storageVersion {
			extraServed++
		}
	}
	return storageVersion, extraServed
}

func customResourceDefinitionNamesFacts(names apiextensionsv1.CustomResourceDefinitionNames) CRDNamesFacts {
	return CRDNamesFacts{
		Plural:     names.Plural,
		Singular:   names.Singular,
		Kind:       names.Kind,
		ListKind:   names.ListKind,
		ShortNames: append([]string(nil), names.ShortNames...),
		Categories: append([]string(nil), names.Categories...),
	}
}

func customResourceDefinitionVersionFacts(versions []apiextensionsv1.CustomResourceDefinitionVersion) []CRDVersionFacts {
	if len(versions) == 0 {
		return nil
	}
	facts := make([]CRDVersionFacts, 0, len(versions))
	for _, version := range versions {
		facts = append(facts, CRDVersionFacts{
			Name:       version.Name,
			Served:     version.Served,
			Storage:    version.Storage,
			Deprecated: version.Deprecated,
			HasSchema:  version.Schema != nil && version.Schema.OpenAPIV3Schema != nil,
		})
	}
	return facts
}

func customResourceDefinitionConditionFacts(conditions []apiextensionsv1.CustomResourceDefinitionCondition) []ConditionFacts {
	if len(conditions) == 0 {
		return nil
	}
	facts := make([]ConditionFacts, 0, len(conditions))
	for _, condition := range conditions {
		facts = append(facts, ConditionFacts{
			Type:               string(condition.Type),
			Status:             string(condition.Status),
			Reason:             condition.Reason,
			Message:            condition.Message,
			LastTransitionTime: condition.LastTransitionTime,
		})
	}
	return facts
}
