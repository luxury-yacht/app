/*
 * backend/resources/configmap/streamsummary.go
 *
 * ConfigMap's stream-summary builder, owned by the kind's package. Produces the
 * neutral streamrows.ConfigSummary row so the snapshot package's namespace-config
 * domain can dispatch to it from the registry instead of hand-coding a ConfigMap
 * row builder. Returns a leaf type, so no snapshot import (no cycle).
 */

package configmap

import (
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	corev1 "k8s.io/api/core/v1"
)

// BuildStreamSummary builds the namespace-config row for one ConfigMap.
func BuildStreamSummary(meta streamrows.ClusterMeta, cm *corev1.ConfigMap) streamrows.ConfigSummary {
	if cm == nil {
		return streamrows.ConfigSummary{ClusterMeta: meta, Kind: "ConfigMap", TypeAlias: "CM"}
	}
	facts := BuildFacts(cm, nil)
	return streamrows.ConfigSummary{
		ClusterMeta:  meta,
		Kind:         "ConfigMap",
		TypeAlias:    "CM",
		Name:         cm.GetName(),
		Namespace:    cm.GetNamespace(),
		Data:         facts.DataCount,
		Age:          streamrows.FormatAge(cm.GetCreationTimestamp().Time),
		AgeTimestamp: streamrows.CreationMillis(cm),
	}
}
