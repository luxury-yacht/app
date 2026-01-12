/*
 * backend/resources/config/configmaps.go
 *
 * ConfigMap resource handlers.
 * - Builds detail and list views for the frontend.
 */

package config

import (
	"encoding/base64"
	"fmt"
	"sort"

	"github.com/luxury-yacht/app/backend/resources/common"
	restypes "github.com/luxury-yacht/app/backend/resources/types"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func (s *Service) ConfigMap(namespace, name string) (*restypes.ConfigMapDetails, error) {
	cm, err := s.deps.KubernetesClient.CoreV1().ConfigMaps(namespace).Get(s.deps.Context, name, metav1.GetOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to get configmap %s/%s: %v", namespace, name, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to get configmap: %v", err)
	}

	pods := s.listNamespacePods(namespace)
	return s.processConfigMapDetails(cm, pods), nil
}

func (s *Service) ConfigMaps(namespace string) ([]*restypes.ConfigMapDetails, error) {
	configMaps, err := s.deps.KubernetesClient.CoreV1().ConfigMaps(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Error(fmt.Sprintf("Failed to list configmaps in namespace %s: %v", namespace, err), "ResourceLoader")
		return nil, fmt.Errorf("failed to list configmaps: %v", err)
	}

	pods := s.listNamespacePods(namespace)

	var detailsList []*restypes.ConfigMapDetails
	for i := range configMaps.Items {
		detailsList = append(detailsList, s.processConfigMapDetails(&configMaps.Items[i], pods))
	}

	return detailsList, nil
}

func (s *Service) processConfigMapDetails(cm *corev1.ConfigMap, pods *corev1.PodList) *restypes.ConfigMapDetails {
	details := &restypes.ConfigMapDetails{
		Kind:        "ConfigMap",
		Name:        cm.Name,
		Namespace:   cm.Namespace,
		Age:         common.FormatAge(cm.CreationTimestamp.Time),
		Data:        cm.Data,
		DataCount:   len(cm.Data) + len(cm.BinaryData),
		Labels:      cm.Labels,
		Annotations: cm.Annotations,
	}

	if len(cm.BinaryData) > 0 {
		details.BinaryData = make(map[string]string, len(cm.BinaryData))
		for key, value := range cm.BinaryData {
			details.BinaryData[key] = base64.StdEncoding.EncodeToString(value)
		}
	}

	usedBy := s.collectConfigMapUsage(cm.Name, pods)
	if len(usedBy) > 0 {
		details.UsedBy = usedBy
	}

	details.Details = fmt.Sprintf("Data items: %d", details.DataCount)
	if len(details.UsedBy) > 0 {
		details.Details += fmt.Sprintf(", Used by %d pod(s)", len(details.UsedBy))
	}

	return details
}

func (s *Service) listNamespacePods(namespace string) *corev1.PodList {
	pods, err := s.deps.KubernetesClient.CoreV1().Pods(namespace).List(s.deps.Context, metav1.ListOptions{})
	if err != nil {
		s.deps.Logger.Warn(fmt.Sprintf("Failed to list pods in namespace %s: %v", namespace, err), "ResourceLoader")
		return nil
	}
	return pods
}

func (s *Service) collectConfigMapUsage(name string, pods *corev1.PodList) []string {
	if pods == nil {
		return nil
	}

	usedBy := make(map[string]bool)
	for _, pod := range pods.Items {
		for _, volume := range pod.Spec.Volumes {
			if volume.ConfigMap != nil && volume.ConfigMap.Name == name {
				usedBy[pod.Name] = true
				break
			}
		}
		s.collectEnvConfigMapUsage(pod.Name, name, pod.Spec.Containers, usedBy)
		s.collectEnvConfigMapUsage(pod.Name, name, pod.Spec.InitContainers, usedBy)
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

func (s *Service) collectEnvConfigMapUsage(podName, name string, containers []corev1.Container, usedBy map[string]bool) {
	for _, container := range containers {
		for _, envFrom := range container.EnvFrom {
			if envFrom.ConfigMapRef != nil && envFrom.ConfigMapRef.Name == name {
				usedBy[podName] = true
				break
			}
		}
		for _, env := range container.Env {
			if env.ValueFrom != nil && env.ValueFrom.ConfigMapKeyRef != nil && env.ValueFrom.ConfigMapKeyRef.Name == name {
				usedBy[podName] = true
				break
			}
		}
	}
}
