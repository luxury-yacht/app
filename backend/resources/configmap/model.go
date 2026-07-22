/*
 * backend/resources/configmap/model.go
 *
 * ConfigMap resource model: the single definition of a ConfigMap's intrinsic
 * fields + status presentation. Detail/object-map/streaming projections derive
 * from it. Shared config-family helpers are reused from resourcemodel.
 */

package configmap

import (
	"strconv"

	"github.com/luxury-yacht/app/backend/resourcemodel"
	corev1 "k8s.io/api/core/v1"
)

// BuildResourceModel builds the ConfigMap resource model. Facts are owned by this
// package (configmap.Facts); the shared ResourceModel carries identity + status,
// and callers needing facts use BuildFacts.
func BuildResourceModel(clusterID string, configMap *corev1.ConfigMap) resourcemodel.ResourceModel {
	status := BuildStatusPresentation(configMap)
	return resourcemodel.KubernetesResourceModel(clusterID, "", "v1", "ConfigMap", "configmaps", resourcemodel.ResourceScopeNamespaced, configMap.ObjectMeta, status, resourcemodel.ResourceFacts{})
}

// BuildFacts extracts the ConfigMap facts from the raw object.
func BuildFacts(configMap *corev1.ConfigMap, relationships *resourcemodel.ResourceRelationshipIndex, options ...resourcemodel.ResourceModelBuildOptions) Facts {
	buildOptions := resourcemodel.BuildOptions(options...)
	facts := Facts{
		DataKeys:       resourcemodel.SortedStringMapKeys(configMap.Data),
		BinaryDataKeys: resourcemodel.SortedBytesMapKeys(configMap.BinaryData),
		DataCount:      len(configMap.Data) + len(configMap.BinaryData),
	}
	if buildOptions.Materialization.Has(resourcemodel.MaterializeReverseLinks) && relationships != nil {
		facts.UsedBy = relationships.ConfigMapUsedBy(configMap.Namespace, configMap.Name)
	}
	for _, value := range configMap.Data {
		facts.DataSizeBytes += int64(len(value))
	}
	for _, value := range configMap.BinaryData {
		facts.DataSizeBytes += int64(len(value))
	}
	return facts
}

// BuildStatusPresentation derives the ConfigMap status presentation.
func BuildStatusPresentation(configMap *corev1.ConfigMap) resourcemodel.ResourceStatusPresentation {
	dataCount := len(configMap.Data) + len(configMap.BinaryData)
	state := strconv.Itoa(dataCount)
	signals := []resourcemodel.ResourceStatusSignal{{
		Type:   resourcemodel.StatusSignalResourceState,
		Name:   "data.count",
		Status: state,
	}}
	lifecycle := resourcemodel.ObjectLifecycle(configMap.ObjectMeta)
	if status, ok := resourcemodel.DeletingObjectStatus(configMap.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}
	return resourcemodel.ObjectSourceStatus(resourcemodel.ItemCountLabel(dataCount), state, "", "", "ready", signals, lifecycle)
}
