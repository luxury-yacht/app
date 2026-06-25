package snapshot

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/tools/cache"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/resources/service"
)

// seedNetworkMaintained wires a fresh Sink-fed maintained store onto the builder and feeds it
// the domain's OWN-rows the builder's own test sources carry — exactly the production wiring:
//
//   - the four cut kinds' (Service/EndpointSlice/Ingress/NetworkPolicy) Table-half NetworkSummary
//     rows are delivered to the store's Sink from the builder's fake ingest source, mirroring
//     RegisterNamespaceNetworkDomainWithGatewayAPI's AddSink-per-cut-GVR;
//   - the uncut Gateway-API kinds' rows are ingested into the SAME store from the builder's
//     descriptor test indexers via store.ingest(descriptor, obj), mirroring
//     registerMaintainedHandlers (which feeds only the Gateway-API kinds; the cut kinds' sentinel
//     indexers hold no objects, so iterating them contributes nothing).
//
// After seeding, Build serves every own-row from the store and re-joins the EndpointSlice
// endpoint count onto Service rows at serve. meta stamps the store's cluster identity (the rows
// carry their own ClusterMeta from the projector / StreamRow).
func seedNetworkMaintained(b *NamespaceNetworkBuilder, meta ClusterMeta) {
	b.maintained = newTypedMaintainedStore(meta, networkQuerypageSchema(), networkTableQueryAdapter())
	sink := b.maintained.Sink()
	if src, ok := b.networkIngest.(fakeNetworkIngestSource); ok {
		for _, gvr := range []schema.GroupVersionResource{ServiceGVR, EndpointSliceGVR, IngressGVR, NetworkPolicyGVR} {
			for _, raw := range src.Rows(gvr) {
				bundle, ok := raw.(ingest.Bundle)
				if !ok {
					continue
				}
				if row, ok := bundle.Table.(NetworkSummary); ok {
					sink.Upsert(row)
				}
			}
		}
	}
	if b.collectIndexer == nil {
		return
	}
	for _, d := range kindregistry.StreamDescriptorsForDomain(namespaceNetworkDomainName) {
		indexer := b.collectIndexer(d)
		if indexer == nil {
			continue
		}
		for _, obj := range indexer.List() {
			b.maintained.ingest(d, obj)
		}
	}
}

// TestNamespaceNetworkBuilderMaintainedMatchesIngestSource is the namespace-network maintained-
// store cutover gate: a builder serving every own-row from the Sink/informer-fed maintained
// store — the four cut kinds' Table halves via the Sink plus the uncut Gateway-API rows via
// store.ingest — must produce the byte-identical NamespaceNetworkSnapshot a builder serving the
// same projected rows produces. Both builders are wired identically and seeded from the same
// sources; the gate proves the store holds the same own-rows the projectors/StreamRow emit and
// that the serve-time EndpointSlice re-join is preserved.
func TestNamespaceNetworkBuilderMaintainedMatchesIngestSource(t *testing.T) {
	now := time.Now()
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "default", ResourceVersion: "61", CreationTimestamp: metav1.NewTime(now.Add(-30 * time.Minute))},
		Spec:       corev1.ServiceSpec{Type: corev1.ServiceTypeClusterIP, ClusterIP: "10.0.0.1", Ports: []corev1.ServicePort{{Port: 443, Protocol: corev1.ProtocolTCP}}},
	}
	ready := true
	port := int32(443)
	slice := &discoveryv1.EndpointSlice{
		ObjectMeta:  metav1.ObjectMeta{Name: "api-abcde", Namespace: "default", ResourceVersion: "62", CreationTimestamp: metav1.NewTime(now.Add(-29 * time.Minute)), Labels: map[string]string{discoveryv1.LabelServiceName: "api"}},
		AddressType: discoveryv1.AddressTypeIPv4,
		Ports:       []discoveryv1.EndpointPort{{Port: &port}},
		Endpoints:   []discoveryv1.Endpoint{{Addresses: []string{"10.1.0.1"}, Conditions: discoveryv1.EndpointConditions{Ready: &ready}}},
	}
	ing := &networkingv1.Ingress{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default", ResourceVersion: "63", CreationTimestamp: metav1.NewTime(now.Add(-20 * time.Minute))},
		Spec:       networkingv1.IngressSpec{Rules: []networkingv1.IngressRule{{Host: "app.example.com"}}},
	}
	hr1 := &gatewayv1.HTTPRoute{ObjectMeta: metav1.ObjectMeta{Name: "route-1", Namespace: "default", ResourceVersion: "70", CreationTimestamp: metav1.NewTime(now.Add(-10 * time.Minute))}}
	hr2 := &gatewayv1.HTTPRoute{ObjectMeta: metav1.ObjectMeta{Name: "route-2", Namespace: "app", ResourceVersion: "71", CreationTimestamp: metav1.NewTime(now.Add(-5 * time.Minute))}}

	hrIndexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	require.NoError(t, hrIndexer.Add(hr1))
	require.NoError(t, hrIndexer.Add(hr2))

	mk := func() *NamespaceNetworkBuilder {
		b := &NamespaceNetworkBuilder{
			networkIngest:         newFakeNetworkIngestSource(ClusterMeta{}, svc, slice, ing),
			includeServices:       true,
			includeEndpointSlices: true,
			includeIngresses:      true,
			collectIndexer: networkCollectIndexer(networkIndexers{
				ingress:   ingestAvailabilityIndexer, // cut kind: sentinel marks it available; rows come from ingest
				httproute: hrIndexer,
			}),
		}
		seedNetworkMaintained(b, ClusterMeta{})
		return b
	}
	a := mk()
	b := mk()

	scopes := []string{
		"namespace:default",
		"namespace:all",
		"namespace:default?sortField=kind&sortDirection=asc",
		"namespace:all?search=route",
		"namespace:all?kinds=HTTPRoute",
	}
	for _, scope := range scopes {
		as, err := a.Build(context.Background(), scope)
		require.NoError(t, err, "build a %q", scope)
		bs, err := b.Build(context.Background(), scope)
		require.NoError(t, err, "build b %q", scope)
		require.Equal(t,
			as.Payload.(NamespaceNetworkSnapshot),
			bs.Payload.(NamespaceNetworkSnapshot),
			"scope %q: the two Sink-fed builds must be equal", scope)
	}
}

// TestNamespaceNetworkMaintainedEndpointJoinFromStore is the network-specific relationship gate:
// it proves the EndpointSlice service-join stays a SERVE-time cross-kind join after the
// conversion. The Service OWN-row is served FROM THE MAINTAINED STORE (built with nil slices, so
// it carries no "Addresses: N" segment), while the EndpointSlice ready-counts are read FROM THE
// INGEST SOURCE at serve and re-applied by reaggregateServiceSummary — so the served Service row
// must carry the correct "Addresses: 2" for two ready endpoints, byte-identical to the typed path.
func TestNamespaceNetworkMaintainedEndpointJoinFromStore(t *testing.T) {
	now := time.Now()
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "default", ResourceVersion: "61", CreationTimestamp: metav1.NewTime(now.Add(-30 * time.Minute))},
		Spec:       corev1.ServiceSpec{Type: corev1.ServiceTypeClusterIP, ClusterIP: "10.0.0.1", Ports: []corev1.ServicePort{{Port: 443, Protocol: corev1.ProtocolTCP}}},
	}
	ready := true
	port := int32(443)
	slice := &discoveryv1.EndpointSlice{
		ObjectMeta:  metav1.ObjectMeta{Name: "api-abcde", Namespace: "default", ResourceVersion: "62", CreationTimestamp: metav1.NewTime(now.Add(-29 * time.Minute)), Labels: map[string]string{discoveryv1.LabelServiceName: "api"}},
		AddressType: discoveryv1.AddressTypeIPv4,
		Ports:       []discoveryv1.EndpointPort{{Port: &port}},
		Endpoints:   []discoveryv1.Endpoint{{Addresses: []string{"10.1.0.1", "10.1.0.2"}, Conditions: discoveryv1.EndpointConditions{Ready: &ready}}},
	}

	b := &NamespaceNetworkBuilder{
		networkIngest:         newFakeNetworkIngestSource(ClusterMeta{}, svc, slice),
		includeServices:       true,
		includeEndpointSlices: true,
		collectIndexer:        networkCollectIndexer(networkIndexers{}),
	}
	seedNetworkMaintained(b, ClusterMeta{})

	// Sanity: the Service OWN-row in the store carries NO endpoint-join segment (built with nil
	// slices), so the "Addresses: 2" below can only come from the serve-time ingest join.
	storeRows := b.maintained.rows("default", map[string]bool{service.Identity.Kind: true})
	require.Len(t, storeRows, 1)
	require.NotContains(t, storeRows[0].Details, "Addresses:",
		"the stored Service own-row must not carry the endpoint join; it is applied at serve")

	snap, err := b.Build(context.Background(), "namespace:default")
	require.NoError(t, err)
	payload := snap.Payload.(NamespaceNetworkSnapshot)
	serviceSummary, ok := findNetworkSummary(payload.Rows, "Service", "api")
	require.True(t, ok)
	require.Contains(t, serviceSummary.Details, "Addresses: 2",
		"the served Service row must re-join the two ready endpoints from the ingest source at serve")
}

// TestNetworkMaintainedStoreSpillRestoreRoundTrip proves the network maintained store — the
// per-cluster store of NetworkSummary OWN-rows fed by the four cut network GVRs' Table-half Sinks
// (plus the Gateway-API informer handlers) — spills to disk and restores into a fresh store with
// identical rows, the warm-paint capability the governor's Cold/re-warm uses. It goes through the
// network schema + adapter, so it proves the network store wiring round-trips, mirroring
// TestNodeMaintainedStoreSpillRestoreRoundTrip / TestWorkloadsMaintainedStoreSpillRestoreRoundTrip.
func TestNetworkMaintainedStoreSpillRestoreRoundTrip(t *testing.T) {
	meta := ClusterMeta{ClusterID: "c1", ClusterName: "cluster-one"}
	available := map[string]bool{"Service": true, "Ingress": true, "NetworkPolicy": true}

	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "default", ResourceVersion: "1"},
		Spec:       corev1.ServiceSpec{Type: corev1.ServiceTypeClusterIP, ClusterIP: "10.0.0.1"},
	}
	ing := &networkingv1.Ingress{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "staging", ResourceVersion: "2"},
		Spec:       networkingv1.IngressSpec{Rules: []networkingv1.IngressRule{{Host: "web.example.com"}}},
	}
	policy := &networkingv1.NetworkPolicy{
		ObjectMeta: metav1.ObjectMeta{Name: "deny-all", Namespace: "default", ResourceVersion: "3"},
	}
	src := newFakeNetworkIngestSource(meta, svc, ing, policy)

	orig := newTypedMaintainedStore(meta, networkQuerypageSchema(), networkTableQueryAdapter())
	sink := orig.Sink()
	for _, gvr := range []schema.GroupVersionResource{ServiceGVR, EndpointSliceGVR, IngressGVR, NetworkPolicyGVR} {
		for _, raw := range src.Rows(gvr) {
			if bundle, ok := raw.(ingest.Bundle); ok {
				if row, ok := bundle.Table.(NetworkSummary); ok {
					sink.Upsert(row)
				}
			}
		}
	}

	path := filepath.Join(t.TempDir(), "network.spill")
	require.NoError(t, orig.SpillTo(path))

	restored := newTypedMaintainedStore(meta, networkQuerypageSchema(), networkTableQueryAdapter())
	require.NoError(t, restored.RestoreFrom(path))

	require.ElementsMatch(t, orig.rows("", available), restored.rows("", available),
		"restored network maintained store must hold the same own-rows as the spilled one")
}
