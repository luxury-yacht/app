package resourcemodel

import (
	"strconv"

	corev1 "k8s.io/api/core/v1"
)

func BuildSecretResourceModel(clusterID string, secret *corev1.Secret, relationships *ResourceRelationshipIndex, options ...ResourceModelBuildOptions) ResourceModel {
	buildOptions := BuildOptions(options...)
	facts := BuildSecretFacts(secret, relationships, buildOptions)
	status := BuildSecretStatusPresentation(secret)
	return configResourceModel(clusterID, "Secret", "secrets", secret.ObjectMeta, status, ResourceFacts{Secret: &facts})
}

func BuildSecretFacts(secret *corev1.Secret, relationships *ResourceRelationshipIndex, options ResourceModelBuildOptions) SecretFacts {
	facts := SecretFacts{
		Type:      secretType(secret),
		DataKeys:  sortedBytesMapKeys(secret.Data),
		DataCount: len(secret.Data),
		Immutable: secret.Immutable,
	}
	if options.Materialization.Has(MaterializeReverseLinks) && relationships != nil {
		facts.UsedBy = relationships.SecretUsedBy(secret.Namespace, secret.Name)
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
	relationships := NewResourceRelationshipIndex(clusterID, ResourceRelationshipIndexOptions{Pods: pods})
	if relationships == nil {
		return nil
	}
	return relationships.SecretUsedBy(namespace, name)
}

func secretType(secret *corev1.Secret) string {
	if secret.Type == "" {
		return string(corev1.SecretTypeOpaque)
	}
	return string(secret.Type)
}
