package snapshot

import (
	"strings"

	corev1 "k8s.io/api/core/v1"
)

// podCountsAsNotReadySignal is the shared contract for the Cluster Overview
// count and the Attention finding selected by that count.
func podCountsAsNotReadySignal(phase string, ready, total int32) bool {
	return !strings.EqualFold(strings.TrimSpace(phase), string(corev1.PodSucceeded)) &&
		total > 0 && ready < total
}
