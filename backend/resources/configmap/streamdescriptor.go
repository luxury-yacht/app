/*
 * backend/resources/configmap/streamdescriptor.go
 *
 * ConfigMap's resource-stream registry entry. ConfigMap is an owned-reflector ingest
 * kind, so its namespace-config table is fed by its ingest sink.
 */

package configmap

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/resources/helm"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// StreamDescriptor registers ConfigMap for the namespace-config snapshot domain.
var StreamDescriptor = streamspec.Descriptor{
	Group:         Identity.Group,
	Version:       Identity.Version,
	Kind:          Identity.Kind,
	Resource:      Identity.Resource,
	Domain:        "namespace-config",
	ClusterScoped: !Identity.Namespaced,
	StreamRow: func(meta streamrows.ClusterMeta, obj metav1.Object) any {
		return BuildStreamSummary(meta, obj.(*corev1.ConfigMap))
	},
	// Helm release ConfigMaps name their release for the Helm response-cache
	// eviction.
	AggregateRow: func(obj metav1.Object) any {
		if record, ok := helm.ConfigMapStorageRecord(obj.(*corev1.ConfigMap)); ok {
			return record
		}
		return nil
	},
}
