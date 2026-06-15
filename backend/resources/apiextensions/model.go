/*
 * backend/resources/apiextensions/model.go
 *
 * CustomResourceDefinition resource model: the single definition of a CRD's
 * intrinsic fields + status presentation. Shared model helpers are reused from
 * resourcemodel (exported network base).
 */

package apiextensions

import (
	"fmt"
	"strings"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
)

const apiGroup = "apiextensions.k8s.io"

// BuildResourceModel builds the CustomResourceDefinition resource model. Facts are
// owned by this package (apiextensions.Facts); callers needing facts use BuildFacts.
func BuildResourceModel(clusterID string, crd *apiextensionsv1.CustomResourceDefinition) resourcemodel.ResourceModel {
	facts := BuildFacts(crd)
	status := statusPresentation(crd, facts)
	return resourcemodel.NetworkResourceModel(clusterID, apiGroup, "v1", "CustomResourceDefinition", "customresourcedefinitions", resourcemodel.ResourceScopeCluster, crd.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the CustomResourceDefinition facts from the raw object.
func BuildFacts(crd *apiextensionsv1.CustomResourceDefinition) Facts {
	storageVersion, extraServed := versionSummary(crd.Spec.Versions)
	facts := Facts{
		Group:                   crd.Spec.Group,
		Scope:                   string(crd.Spec.Scope),
		Names:                   namesFacts(crd.Spec.Names),
		Versions:                versionFacts(crd.Spec.Versions),
		Conditions:              conditionFacts(crd.Status.Conditions),
		StorageVersion:          storageVersion,
		ExtraServedVersionCount: extraServed,
	}
	if crd.Spec.Conversion != nil {
		facts.ConversionStrategy = string(crd.Spec.Conversion.Strategy)
	}
	return facts
}

func statusPresentation(crd *apiextensionsv1.CustomResourceDefinition, facts Facts) resourcemodel.ResourceStatusPresentation {
	signals := make([]resourcemodel.ResourceStatusSignal, 0, len(facts.Conditions)+1)
	if facts.StorageVersion != "" {
		signals = append(signals, resourcemodel.ResourceStatusSignal{
			Type:   resourcemodel.StatusSignalResourceState,
			Name:   "spec.versions.storage",
			Status: facts.StorageVersion,
		})
	}
	for _, condition := range facts.Conditions {
		signals = append(signals, resourcemodel.ResourceStatusSignal{
			Type:    resourcemodel.StatusSignalCondition,
			Name:    condition.Type,
			Status:  condition.Status,
			Reason:  condition.Reason,
			Message: condition.Message,
		})
	}

	lifecycle := resourcemodel.NetworkLifecycle(crd.ObjectMeta)
	if status, ok := resourcemodel.DeletingNetworkStatus(crd.ObjectMeta, facts.StorageVersion, signals, lifecycle); ok {
		return status
	}
	return resourcemodel.NetworkSourceStatus(CustomResourceDefinitionVersionDetails(facts), facts.StorageVersion, "", "ready", signals, lifecycle)
}

// CustomResourceDefinitionVersionDetails renders the one-line "Versions: ..." label
// used by both the status presentation and the snapshot streaming summary.
func CustomResourceDefinitionVersionDetails(facts Facts) string {
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

func versionSummary(versions []apiextensionsv1.CustomResourceDefinitionVersion) (storageVersion string, extraServed int) {
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

func namesFacts(names apiextensionsv1.CustomResourceDefinitionNames) NamesFacts {
	return NamesFacts{
		Plural:     names.Plural,
		Singular:   names.Singular,
		Kind:       names.Kind,
		ListKind:   names.ListKind,
		ShortNames: append([]string(nil), names.ShortNames...),
		Categories: append([]string(nil), names.Categories...),
	}
}

func versionFacts(versions []apiextensionsv1.CustomResourceDefinitionVersion) []VersionFacts {
	if len(versions) == 0 {
		return nil
	}
	facts := make([]VersionFacts, 0, len(versions))
	for _, version := range versions {
		facts = append(facts, VersionFacts{
			Name:       version.Name,
			Served:     version.Served,
			Storage:    version.Storage,
			Deprecated: version.Deprecated,
			HasSchema:  version.Schema != nil && version.Schema.OpenAPIV3Schema != nil,
		})
	}
	return facts
}

func conditionFacts(conditions []apiextensionsv1.CustomResourceDefinitionCondition) []resourcemodel.ConditionFacts {
	if len(conditions) == 0 {
		return nil
	}
	facts := make([]resourcemodel.ConditionFacts, 0, len(conditions))
	for _, condition := range conditions {
		facts = append(facts, resourcemodel.ConditionFacts{
			Type:               string(condition.Type),
			Status:             string(condition.Status),
			Reason:             condition.Reason,
			Message:            condition.Message,
			LastTransitionTime: condition.LastTransitionTime,
		})
	}
	return facts
}
