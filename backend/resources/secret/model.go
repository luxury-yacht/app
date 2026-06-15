/*
 * backend/resources/secret/model.go
 *
 * Secret resource model: the single definition of a Secret's intrinsic fields +
 * status presentation. Detail/object-map/streaming projections derive from it.
 * Shared config-family helpers are reused from resourcemodel.
 */

package secret

import (
	"strconv"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	corev1 "k8s.io/api/core/v1"
)

// BuildResourceModel builds the Secret resource model. Facts are owned by this
// package (secret.Facts); the shared ResourceModel carries identity + status, and
// callers needing facts use BuildFacts.
func BuildResourceModel(clusterID string, sec *corev1.Secret) resourcemodel.ResourceModel {
	status := BuildStatusPresentation(sec)
	return resourcemodel.ConfigResourceModel(clusterID, "Secret", "secrets", sec.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the Secret facts from the raw object.
func BuildFacts(sec *corev1.Secret, relationships *resourcemodel.ResourceRelationshipIndex, options ...resourcemodel.ResourceModelBuildOptions) Facts {
	buildOptions := resourcemodel.BuildOptions(options...)
	facts := Facts{
		Type:      secretType(sec),
		DataKeys:  resourcemodel.SortedBytesMapKeys(sec.Data),
		DataCount: len(sec.Data),
		Immutable: sec.Immutable,
	}
	if buildOptions.Materialization.Has(resourcemodel.MaterializeReverseLinks) && relationships != nil {
		facts.UsedBy = relationships.SecretUsedBy(sec.Namespace, sec.Name)
	}
	for _, value := range sec.Data {
		facts.DataSizeBytes += int64(len(value))
	}
	return facts
}

// BuildStatusPresentation derives the Secret status presentation.
func BuildStatusPresentation(sec *corev1.Secret) resourcemodel.ResourceStatusPresentation {
	state := secretType(sec)
	dataCount := len(sec.Data)
	signals := []resourcemodel.ResourceStatusSignal{
		{Type: resourcemodel.StatusSignalResourceState, Name: "type", Status: state},
		{Type: resourcemodel.StatusSignalResourceState, Name: "data.count", Status: strconv.Itoa(dataCount)},
	}
	lifecycle := resourcemodel.ConfigLifecycle(sec.ObjectMeta)
	if status, ok := resourcemodel.DeletingConfigStatus(sec.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}
	return resourcemodel.ConfigSourceStatus(state+", "+resourcemodel.KeyCountLabel(dataCount), state, "", "ready", signals, lifecycle)
}

func secretType(sec *corev1.Secret) string {
	if sec.Type == "" {
		return string(corev1.SecretTypeOpaque)
	}
	return string(sec.Type)
}
