/*
 * backend/resources/common/ports.go
 *
 * Shared port-forward capability detection. Single source of truth for what
 * counts as a forwardable port, used by the object catalog, refresh snapshots,
 * and object map.
 */

package common

import corev1 "k8s.io/api/core/v1"

// HasForwardableContainerPorts reports whether any container declares a port
// that can be port-forwarded (TCP, including the unspecified-protocol default).
func HasForwardableContainerPorts(containers []corev1.Container) bool {
	for _, container := range containers {
		for _, port := range container.Ports {
			if port.Protocol == "" || port.Protocol == corev1.ProtocolTCP {
				return true
			}
		}
	}
	return false
}

// ServiceHasForwardablePorts reports whether any service port can be
// port-forwarded (TCP, including the unspecified-protocol default).
func ServiceHasForwardablePorts(ports []corev1.ServicePort) bool {
	for _, port := range ports {
		if port.Protocol == "" || port.Protocol == corev1.ProtocolTCP {
			return true
		}
	}
	return false
}
