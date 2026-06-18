/*
 * backend/resources/secret/streamdescriptor.go
 *
 * Secret's resource-stream registry entry. Live streaming is handled by a bespoke
 * handler in resourcestream (it also drives a Helm-release refresh), so
 * CustomStreamHandler is set and registerDescriptorStreams skips it; this
 * descriptor exists so the namespace-config snapshot can loop the registry.
 */

package secret

import (
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
)

// StreamDescriptor registers Secret for the namespace-config snapshot domain.
var StreamDescriptor = streamspec.Descriptor{
	Group:               Identity.Group,
	Version:             Identity.Version,
	Kind:                Identity.Kind,
	Resource:            Identity.Resource,
	Domain:              "namespace-config",
	ClusterScoped:       !Identity.Namespaced,
	CustomStreamHandler: true,
	StreamRow: func(meta streamrows.ClusterMeta, obj metav1.Object) any {
		return BuildStreamSummary(meta, obj.(*corev1.Secret))
	},
	Informer: func(factory informers.SharedInformerFactory) cache.SharedIndexInformer {
		return factory.Core().V1().Secrets().Informer()
	},
}
