/*
 * backend/resources/storageclass/streamdescriptor.go
 *
 * StorageClass's resource-stream registry entry.
 */

package storageclass

import (
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/streamspec"
	storagev1 "k8s.io/api/storage/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
)

// StreamDescriptor registers StorageClass for resource streaming (cluster-config).
var StreamDescriptor = streamspec.Descriptor{
	Group:         "storage.k8s.io",
	Version:       "v1",
	Kind:          "StorageClass",
	Resource:      "storageclasses",
	Domain:        "cluster-config",
	ClusterScoped: true,
	StreamRow: func(meta streamrows.ClusterMeta, obj metav1.Object) any {
		return BuildStreamSummary(meta, obj.(*storagev1.StorageClass))
	},
	Informer: func(factory informers.SharedInformerFactory) cache.SharedIndexInformer {
		return factory.Storage().V1().StorageClasses().Informer()
	},
}
