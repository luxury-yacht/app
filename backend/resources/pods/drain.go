/*
 * backend/resources/pods/drain.go
 *
 * Which pods matter when a node is drained or removed.
 */

package pods

import (
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

const daemonSetKind = "DaemonSet"

// ExemptFromDrain reports whether removing the pod's node would not disrupt it.
// It follows what kubectl drain leaves alone: DaemonSet and static pods belong
// to the node, and a finished pod has nothing left to stop. A terminating pod
// still counts until it is gone.
func ExemptFromDrain(pod *corev1.Pod) bool {
	if pod.Status.Phase == corev1.PodSucceeded || pod.Status.Phase == corev1.PodFailed {
		return true
	}
	if _, static := pod.Annotations[corev1.MirrorPodAnnotationKey]; static {
		return true
	}
	controller := metav1.GetControllerOf(pod)
	return controller != nil && controller.Kind == daemonSetKind
}
