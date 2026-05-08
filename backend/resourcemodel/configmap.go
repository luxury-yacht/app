package resourcemodel

import (
	"strconv"

	corev1 "k8s.io/api/core/v1"
)

func BuildConfigMapResourceModel(clusterID string, configMap *corev1.ConfigMap, relationships *ResourceRelationshipIndex, options ...ResourceModelBuildOptions) ResourceModel {
	buildOptions := BuildOptions(options...)
	facts := BuildConfigMapFacts(configMap, relationships, buildOptions)
	status := BuildConfigMapStatusPresentation(configMap)
	return configResourceModel(clusterID, "ConfigMap", "configmaps", configMap.ObjectMeta, status, ResourceFacts{ConfigMap: &facts})
}

func BuildConfigMapFacts(configMap *corev1.ConfigMap, relationships *ResourceRelationshipIndex, options ResourceModelBuildOptions) ConfigMapFacts {
	facts := ConfigMapFacts{
		DataKeys:       sortedStringMapKeys(configMap.Data),
		BinaryDataKeys: sortedBytesMapKeys(configMap.BinaryData),
		DataCount:      len(configMap.Data) + len(configMap.BinaryData),
	}
	if options.Materialization.Has(MaterializeReverseLinks) && relationships != nil {
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

func BuildConfigMapStatusPresentation(configMap *corev1.ConfigMap) ResourceStatusPresentation {
	dataCount := len(configMap.Data) + len(configMap.BinaryData)
	state := strconv.Itoa(dataCount)
	signals := []ResourceStatusSignal{{
		Type:   StatusSignalResourceState,
		Name:   "data.count",
		Status: state,
	}}
	lifecycle := configLifecycle(configMap.ObjectMeta)
	if status, ok := deletingConfigStatus(configMap.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}
	return configSourceStatus(itemCountLabel(dataCount), state, "", "ready", signals, lifecycle)
}

func ConfigMapUsageLinks(clusterID, namespace, name string, pods *corev1.PodList) []ResourceLink {
	relationships := NewResourceRelationshipIndex(clusterID, ResourceRelationshipIndexOptions{Pods: pods})
	if relationships == nil {
		return nil
	}
	return relationships.ConfigMapUsedBy(namespace, name)
}
