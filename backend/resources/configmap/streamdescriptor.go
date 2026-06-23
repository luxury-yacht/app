/*
 * backend/resources/configmap/streamdescriptor.go
 *
 * ConfigMap's resource-stream registry entry. ConfigMap is an owned-reflector
 * ingest kind (IngestOwned), so its namespace-config live notify is driven by the
 * generic ingest notify sink (registerIngestNotifyStreams), not a shared-informer
 * handler. The Helm-release refresh side-effect that previously forced a bespoke
 * CustomStreamHandler is now served by the dedicated helm-storage source. The
 * Informer accessor stays so any uncut path can still resolve the kind.
 */

package configmap

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
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
	Informer: func(factory informers.SharedInformerFactory) cache.SharedIndexInformer {
		return factory.Core().V1().ConfigMaps().Informer()
	},
}
