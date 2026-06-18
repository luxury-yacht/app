/*
 * backend/resources/common/pod_filter.go
 *
 * Shared pod-owner filtering used by workload detail builders and port-forward
 * target resolution.
 */

package common

import corev1 "k8s.io/api/core/v1"

// FilterPodsByControllerOwner returns the pods in podList whose controlling
// owner reference matches the given kind and name. It is the shared
// implementation for workloads (DaemonSet, StatefulSet) and port-forward target
// resolution, which previously each carried an identical copy.
func FilterPodsByControllerOwner(podList *corev1.PodList, ownerKind, ownerName string) []corev1.Pod {
	if podList == nil {
		return nil
	}

	var filtered []corev1.Pod
	for _, pod := range podList.Items {
		for _, owner := range pod.OwnerReferences {
			if owner.Controller != nil && *owner.Controller && owner.Kind == ownerKind && owner.Name == ownerName {
				filtered = append(filtered, pod)
				break
			}
		}
	}
	return filtered
}
