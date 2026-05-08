package resourcemodel

import (
	"strconv"

	corev1 "k8s.io/api/core/v1"
)

func BuildConfigMapResourceModel(clusterID string, configMap *corev1.ConfigMap, pods *corev1.PodList) ResourceModel {
	facts := BuildConfigMapFacts(clusterID, configMap, pods)
	status := BuildConfigMapStatusPresentation(configMap)
	return configResourceModel(clusterID, "ConfigMap", "configmaps", configMap.ObjectMeta, status, ResourceFacts{ConfigMap: &facts})
}

func BuildConfigMapFacts(clusterID string, configMap *corev1.ConfigMap, pods *corev1.PodList) ConfigMapFacts {
	facts := ConfigMapFacts{
		DataKeys:       sortedStringMapKeys(configMap.Data),
		BinaryDataKeys: sortedBytesMapKeys(configMap.BinaryData),
		DataCount:      len(configMap.Data) + len(configMap.BinaryData),
		UsedBy:         ConfigMapUsageLinks(clusterID, configMap.Namespace, configMap.Name, pods),
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
	if pods == nil {
		return nil
	}

	usedBy := make(map[string]ResourceLink)
	for _, pod := range pods.Items {
		if pod.Namespace != namespace {
			continue
		}
		if podUsesConfigMap(pod, name) {
			usedBy[pod.Namespace+"/"+pod.Name] = podResourceLink(clusterID, pod)
		}
	}
	if len(usedBy) == 0 {
		return nil
	}

	links := make([]ResourceLink, 0, len(usedBy))
	for _, link := range usedBy {
		links = append(links, link)
	}
	sortResourceLinksByObjectName(links)
	return links
}

func podUsesConfigMap(pod corev1.Pod, name string) bool {
	for _, volume := range pod.Spec.Volumes {
		if volume.ConfigMap != nil && volume.ConfigMap.Name == name {
			return true
		}
	}
	return containersUseConfigMap(pod.Spec.Containers, name) ||
		containersUseConfigMap(pod.Spec.InitContainers, name) ||
		ephemeralContainersUseConfigMap(pod.Spec.EphemeralContainers, name)
}

func containersUseConfigMap(containers []corev1.Container, name string) bool {
	for _, container := range containers {
		for _, envFrom := range container.EnvFrom {
			if envFrom.ConfigMapRef != nil && envFrom.ConfigMapRef.Name == name {
				return true
			}
		}
		for _, env := range container.Env {
			if env.ValueFrom != nil && env.ValueFrom.ConfigMapKeyRef != nil && env.ValueFrom.ConfigMapKeyRef.Name == name {
				return true
			}
		}
	}
	return false
}

func ephemeralContainersUseConfigMap(containers []corev1.EphemeralContainer, name string) bool {
	for _, container := range containers {
		for _, envFrom := range container.EnvFrom {
			if envFrom.ConfigMapRef != nil && envFrom.ConfigMapRef.Name == name {
				return true
			}
		}
		for _, env := range container.Env {
			if env.ValueFrom != nil && env.ValueFrom.ConfigMapKeyRef != nil && env.ValueFrom.ConfigMapKeyRef.Name == name {
				return true
			}
		}
	}
	return false
}
