/*
 * backend/resources/config/secrets.go
 *
 * Secret resource handlers.
 * - Builds detail and list views for the frontend.
 */

package config

import (
	"fmt"
	"sort"

	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func (s *Service) Secret(namespace, name string) (*restypes.SecretDetails, error) {
	secret, err := s.deps.KubernetesClient.CoreV1().Secrets(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get secret %s/%s: %v", namespace, name, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to get secret: %v", err)
	}

	pods := s.listNamespacePods(namespace)
	return s.processSecretDetails(secret, pods), nil
}

func (s *Service) Secrets(namespace string) ([]*restypes.SecretDetails, error) {
	secrets, err := s.deps.KubernetesClient.CoreV1().Secrets(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list secrets: %v", err)
	}

	pods := s.listNamespacePods(namespace)

	var detailsList []*restypes.SecretDetails
	for i := range secrets.Items {
		detailsList = append(detailsList, s.processSecretDetails(&secrets.Items[i], pods))
	}

	return detailsList, nil
}

func (s *Service) processSecretDetails(secret *corev1.Secret, pods *corev1.PodList) *restypes.SecretDetails {
	details := &restypes.SecretDetails{
		Kind:        "Secret",
		Name:        secret.Name,
		Namespace:   secret.Namespace,
		Age:         common.FormatAge(secret.CreationTimestamp.Time),
		SecretType:  string(secret.Type),
		DataCount:   len(secret.Data),
		Labels:      secret.Labels,
		Annotations: secret.Annotations,
		Data:        make(map[string]string, len(secret.Data)),
	}

	for key, value := range secret.Data {
		details.DataKeys = append(details.DataKeys, key)
		details.Data[key] = string(value)
	}
	sort.Strings(details.DataKeys)

	usedBy := s.collectSecretUsage(secret.Name, pods)
	if len(usedBy) > 0 {
		details.UsedBy = usedBy
	}

	secretType := details.SecretType
	if secretType == "" {
		secretType = "Opaque"
	}
	details.Details = fmt.Sprintf("%s, %d key(s)", secretType, details.DataCount)
	if len(details.UsedBy) > 0 {
		details.Details += fmt.Sprintf(", Used by %d pod(s)", len(details.UsedBy))
	}

	return details
}

func (s *Service) collectSecretUsage(name string, pods *corev1.PodList) []string {
	if pods == nil {
		return nil
	}

	usedBy := make(map[string]bool)
	for _, pod := range pods.Items {
		for _, volume := range pod.Spec.Volumes {
			if volume.Secret != nil && volume.Secret.SecretName == name {
				usedBy[pod.Name] = true
				break
			}
		}
		for _, pullSecret := range pod.Spec.ImagePullSecrets {
			if pullSecret.Name == name {
				usedBy[pod.Name] = true
				break
			}
		}
		s.collectEnvSecretUsage(pod.Name, name, pod.Spec.Containers, usedBy)
		s.collectEnvSecretUsage(pod.Name, name, pod.Spec.InitContainers, usedBy)
	}

	if len(usedBy) == 0 {
		return nil
	}

	var podNames []string
	for podName := range usedBy {
		podNames = append(podNames, podName)
	}
	sort.Strings(podNames)
	return podNames
}

func (s *Service) collectEnvSecretUsage(podName, name string, containers []corev1.Container, usedBy map[string]bool) {
	for _, container := range containers {
		for _, envFrom := range container.EnvFrom {
			if envFrom.SecretRef != nil && envFrom.SecretRef.Name == name {
				usedBy[podName] = true
				break
			}
		}
		for _, env := range container.Env {
			if env.ValueFrom != nil && env.ValueFrom.SecretKeyRef != nil && env.ValueFrom.SecretKeyRef.Name == name {
				usedBy[podName] = true
				break
			}
		}
	}
}
