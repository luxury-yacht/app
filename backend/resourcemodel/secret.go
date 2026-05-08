package resourcemodel

import (
	"strconv"

	corev1 "k8s.io/api/core/v1"
)

func BuildSecretResourceModel(clusterID string, secret *corev1.Secret, pods *corev1.PodList) ResourceModel {
	facts := BuildSecretFacts(clusterID, secret, pods)
	status := BuildSecretStatusPresentation(secret)
	return configResourceModel(clusterID, "Secret", "secrets", secret.ObjectMeta, status, ResourceFacts{Secret: &facts})
}

func BuildSecretFacts(clusterID string, secret *corev1.Secret, pods *corev1.PodList) SecretFacts {
	facts := SecretFacts{
		Type:      secretType(secret),
		DataKeys:  sortedBytesMapKeys(secret.Data),
		DataCount: len(secret.Data),
		Immutable: secret.Immutable,
		UsedBy:    SecretUsageLinks(clusterID, secret.Namespace, secret.Name, pods),
	}
	for _, value := range secret.Data {
		facts.DataSizeBytes += int64(len(value))
	}
	return facts
}

func BuildSecretStatusPresentation(secret *corev1.Secret) ResourceStatusPresentation {
	state := secretType(secret)
	dataCount := len(secret.Data)
	signals := []ResourceStatusSignal{
		{Type: StatusSignalResourceState, Name: "type", Status: state},
		{Type: StatusSignalResourceState, Name: "data.count", Status: strconv.Itoa(dataCount)},
	}
	lifecycle := configLifecycle(secret.ObjectMeta)
	if status, ok := deletingConfigStatus(secret.ObjectMeta, state, signals, lifecycle); ok {
		return status
	}
	return configSourceStatus(state+", "+keyCountLabel(dataCount), state, "", "ready", signals, lifecycle)
}

func SecretUsageLinks(clusterID, namespace, name string, pods *corev1.PodList) []ResourceLink {
	if pods == nil {
		return nil
	}

	usedBy := make(map[string]ResourceLink)
	for _, pod := range pods.Items {
		if pod.Namespace != namespace {
			continue
		}
		if podUsesSecret(pod, name) {
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

func secretType(secret *corev1.Secret) string {
	if secret.Type == "" {
		return string(corev1.SecretTypeOpaque)
	}
	return string(secret.Type)
}

func podUsesSecret(pod corev1.Pod, name string) bool {
	for _, volume := range pod.Spec.Volumes {
		if volume.Secret != nil && volume.Secret.SecretName == name {
			return true
		}
	}
	for _, pullSecret := range pod.Spec.ImagePullSecrets {
		if pullSecret.Name == name {
			return true
		}
	}
	return containersUseSecret(pod.Spec.Containers, name) ||
		containersUseSecret(pod.Spec.InitContainers, name) ||
		ephemeralContainersUseSecret(pod.Spec.EphemeralContainers, name)
}

func containersUseSecret(containers []corev1.Container, name string) bool {
	for _, container := range containers {
		for _, envFrom := range container.EnvFrom {
			if envFrom.SecretRef != nil && envFrom.SecretRef.Name == name {
				return true
			}
		}
		for _, env := range container.Env {
			if env.ValueFrom != nil && env.ValueFrom.SecretKeyRef != nil && env.ValueFrom.SecretKeyRef.Name == name {
				return true
			}
		}
	}
	return false
}

func ephemeralContainersUseSecret(containers []corev1.EphemeralContainer, name string) bool {
	for _, container := range containers {
		for _, envFrom := range container.EnvFrom {
			if envFrom.SecretRef != nil && envFrom.SecretRef.Name == name {
				return true
			}
		}
		for _, env := range container.Env {
			if env.ValueFrom != nil && env.ValueFrom.SecretKeyRef != nil && env.ValueFrom.SecretKeyRef.Name == name {
				return true
			}
		}
	}
	return false
}
