package snapshot

import (
	"strconv"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// fakeNetworkIngestSource is a test networkIngestSource: it projects the supplied typed
// network objects through the SAME per-kind ingest projectors the reflector uses, then
// serves the resulting Bundles keyed by GVR — so a namespace-network domain unit test
// feeds the builder exactly the projected rows ingest would supply (Service OWN-rows,
// EndpointSlice rows + join facts, Ingress/NetworkPolicy rows). It also serves a per-GVR
// resourceVersion for the version watermark.
type fakeNetworkIngestSource struct {
	bundles map[schema.GroupVersionResource][]ingest.Bundle
	rv      map[schema.GroupVersionResource]string
}

func (s fakeNetworkIngestSource) Rows(gvr schema.GroupVersionResource) []interface{} {
	out := make([]interface{}, 0, len(s.bundles[gvr]))
	for _, b := range s.bundles[gvr] {
		out = append(out, b)
	}
	return out
}

func (s fakeNetworkIngestSource) StoreResourceVersion(gvr schema.GroupVersionResource) string {
	return s.rv[gvr]
}

// newFakeNetworkIngestSource projects the supplied typed network objects (any mix of
// Service / EndpointSlice / Ingress / NetworkPolicy) to the Bundle each kind's reflector
// would build, indexed by GVR. The per-GVR resourceVersion is the highest typed object RV,
// so the network version watermark matches the prior typed path. meta stamps the projected
// rows' cluster identity.
func newFakeNetworkIngestSource(meta ClusterMeta, objects ...metav1.Object) fakeNetworkIngestSource {
	src := fakeNetworkIngestSource{
		bundles: map[schema.GroupVersionResource][]ingest.Bundle{},
		rv:      map[schema.GroupVersionResource]string{},
	}
	svcProj := NewServiceIngestProjector(meta)
	epsProj := NewEndpointSliceIngestProjector(meta)
	// Ingress / NetworkPolicy are the generic-ingest cut kinds: their reflector builds the
	// bundle from the StreamRow descriptor + catalog + object-map projectors. The test
	// projects them via the same descriptor StreamRow to mirror what the ingest store holds.
	add := func(gvr schema.GroupVersionResource, bundle ingest.Bundle, obj metav1.Object) {
		src.bundles[gvr] = append(src.bundles[gvr], bundle)
		if rv, err := strconv.ParseUint(obj.GetResourceVersion(), 10, 64); err == nil {
			if cur, _ := strconv.ParseUint(src.rv[gvr], 10, 64); rv > cur {
				src.rv[gvr] = strconv.FormatUint(rv, 10)
			}
		}
	}

	for _, obj := range objects {
		switch o := obj.(type) {
		case *corev1.Service:
			if raw, err := svcProj(o); err == nil {
				add(ServiceGVR, raw.(ingest.Bundle), o)
			}
		case *discoveryv1.EndpointSlice:
			if raw, err := epsProj(o); err == nil {
				add(EndpointSliceGVR, raw.(ingest.Bundle), o)
			}
		case *networkingv1.Ingress:
			add(IngressGVR, networkDescriptorBundle(meta, IngressGVR, o), o)
		case *networkingv1.NetworkPolicy:
			add(NetworkPolicyGVR, networkDescriptorBundle(meta, NetworkPolicyGVR, o), o)
		}
	}
	return src
}

// networkDescriptorBundle builds the Table-half bundle the generic ingest reflector would
// hold for a Stream-backed cut kind (Ingress/NetworkPolicy), running the kind's StreamRow
// descriptor exactly as the IngestManager's generic projection does.
func networkDescriptorBundle(meta ClusterMeta, gvr schema.GroupVersionResource, obj metav1.Object) ingest.Bundle {
	for _, d := range kindregistry.StreamDescriptorsForDomain(namespaceNetworkDomainName) {
		if d.GVR() == gvr {
			return ingest.Bundle{Table: d.StreamRow(meta, obj)}
		}
	}
	return ingest.Bundle{}
}
