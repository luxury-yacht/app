/*
 * backend/resources/secret/streamdescriptor.go
 *
 * Secret's resource-stream registry entry. Secret is an owned-reflector ingest
 * kind (IngestOwned), so its namespace-config live notify is driven by the generic
 * ingest notify sink (registerIngestNotifyStreams), not a shared-informer handler.
 * The Helm-release refresh side-effect that previously forced a bespoke
 * CustomStreamHandler is now served by the dedicated helm-storage source. The
 * Informer accessor stays so any uncut path can still resolve the kind.
 */

package secret

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
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
	AggregateRow: func(obj metav1.Object) any {
		secret := obj.(*corev1.Secret)
		candidate, ok := resourcemodel.HelmReleaseStorageCandidateForObject(secret, string(secret.Type))
		if !ok {
			return nil
		}
		return candidate
	},
	Informer: func(factory informers.SharedInformerFactory) cache.SharedIndexInformer {
		return factory.Core().V1().Secrets().Informer()
	},
}
