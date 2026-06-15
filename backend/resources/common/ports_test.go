/*
 * backend/resources/common/ports_test.go
 *
 * Tests for shared forwardable-port detection.
 */

package common

import (
	"testing"

	corev1 "k8s.io/api/core/v1"
)

func TestHasForwardableContainerPorts(t *testing.T) {
	tcp := []corev1.Container{{Ports: []corev1.ContainerPort{{Protocol: corev1.ProtocolTCP}}}}
	empty := []corev1.Container{{Ports: []corev1.ContainerPort{{Protocol: ""}}}}
	udp := []corev1.Container{{Ports: []corev1.ContainerPort{{Protocol: corev1.ProtocolUDP}}}}

	if !HasForwardableContainerPorts(tcp) || !HasForwardableContainerPorts(empty) {
		t.Fatal("TCP / empty-protocol ports should be forwardable")
	}
	if HasForwardableContainerPorts(udp) || HasForwardableContainerPorts(nil) {
		t.Fatal("UDP-only / no containers should not be forwardable")
	}
}

func TestServiceHasForwardablePorts(t *testing.T) {
	if !ServiceHasForwardablePorts([]corev1.ServicePort{{Protocol: ""}}) {
		t.Fatal("empty-protocol service port should be forwardable")
	}
	if ServiceHasForwardablePorts([]corev1.ServicePort{{Protocol: corev1.ProtocolUDP}}) {
		t.Fatal("UDP-only service should not be forwardable")
	}
}
