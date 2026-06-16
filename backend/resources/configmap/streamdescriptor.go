/*
 * backend/resources/configmap/streamdescriptor.go
 *
 * ConfigMap's resource-stream registry entry. Live streaming is handled by a
 * bespoke handler in resourcestream (it also drives a Helm-release refresh), so
 * CustomStreamHandler is set and registerDescriptorStreams skips it; this
 * descriptor exists so the namespace-config snapshot can loop the registry.
 */

package configmap

import (
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/streamspec"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
)

// StreamDescriptor registers ConfigMap for the namespace-config snapshot domain.
var StreamDescriptor = streamspec.Descriptor{
	Group:               "",
	Version:             "v1",
	Kind:                "ConfigMap",
	Resource:            "configmaps",
	Domain:              "namespace-config",
	ClusterScoped:       false,
	CustomStreamHandler: true,
	StreamRow: func(meta streamrows.ClusterMeta, obj metav1.Object) any {
		return BuildStreamSummary(meta, obj.(*corev1.ConfigMap))
	},
	Informer: func(factory informers.SharedInformerFactory) cache.SharedIndexInformer {
		return factory.Core().V1().ConfigMaps().Informer()
	},
}
