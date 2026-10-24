/*
 * backend/resources/secret/streamdescriptor.go
 *
 * Secret's resource-stream registry entry. Secret is an owned-reflector ingest
 * kind: its namespace-config table and the Helm release table are fed by its
 * ingest sinks.
 */

package secret

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/resources/helm"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

// StreamDescriptor registers Secret for the namespace-config snapshot domain.
var StreamDescriptor = streamspec.Descriptor{
	Group:         Identity.Group,
	Version:       Identity.Version,
	Kind:          Identity.Kind,
	Resource:      Identity.Resource,
	Domain:        "namespace-config",
	ClusterScoped: !Identity.Namespaced,
	StreamRow: func(meta streamrows.ClusterMeta, obj metav1.Object) any {
		return BuildStreamSummary(meta, obj.(*corev1.Secret))
	},
	// Helm release Secrets carry their revision for the Helm release table
	// and the Helm response-cache eviction.
	AggregateRow: func(obj metav1.Object) any {
		if record, ok := helm.SecretStorageRecord(obj.(*corev1.Secret)); ok {
			return record
		}
		return nil
	},
}
