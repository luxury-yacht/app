/*
 * backend/resources/admission/streamdescriptor.go
 *
 * Resource-stream registry entries for the admission webhook pair (cluster-config).
 */

package admission

import (
	"github.com/luxury-yacht/app/backend/refresh/streamrows"
	"github.com/luxury-yacht/app/backend/refresh/streamspec"
	admissionregistrationv1 "k8s.io/api/admissionregistration/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
)

// ValidatingStreamDescriptor registers ValidatingWebhookConfiguration for streaming.
var ValidatingStreamDescriptor = streamspec.Descriptor{
	Group:         "admissionregistration.k8s.io",
	Version:       "v1",
	Kind:          "ValidatingWebhookConfiguration",
	Resource:      "validatingwebhookconfigurations",
	Domain:        "cluster-config",
	ClusterScoped: true,
	StreamRow: func(meta streamrows.ClusterMeta, obj metav1.Object) any {
		return BuildValidatingStreamSummary(meta, obj.(*admissionregistrationv1.ValidatingWebhookConfiguration))
	},
	Informer: func(factory informers.SharedInformerFactory) cache.SharedIndexInformer {
		return factory.Admissionregistration().V1().ValidatingWebhookConfigurations().Informer()
	},
}

// MutatingStreamDescriptor registers MutatingWebhookConfiguration for streaming.
var MutatingStreamDescriptor = streamspec.Descriptor{
	Group:         "admissionregistration.k8s.io",
	Version:       "v1",
	Kind:          "MutatingWebhookConfiguration",
	Resource:      "mutatingwebhookconfigurations",
	Domain:        "cluster-config",
	ClusterScoped: true,
	StreamRow: func(meta streamrows.ClusterMeta, obj metav1.Object) any {
		return BuildMutatingStreamSummary(meta, obj.(*admissionregistrationv1.MutatingWebhookConfiguration))
	},
	Informer: func(factory informers.SharedInformerFactory) cache.SharedIndexInformer {
		return factory.Admissionregistration().V1().MutatingWebhookConfigurations().Informer()
	},
}
