package snapshot

import (
	"context"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	corev1 "k8s.io/api/core/v1"
	networkingv1 "k8s.io/api/networking/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/tools/cache"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
)

// TestNamespaceNetworkBuilderMaintainedMatchesListPath is the namespace-network maintained-
// store cutover gate for the (uncut) Gateway-API kinds: serving their rows from the
// gateway-informer-fed store must produce the byte-identical NamespaceNetworkSnapshot the
// list path (collectDescriptorTableRows) produces. The cut kinds (Service/Ingress) come from
// the SAME fake ingest source on both sides, so any difference is the Gateway-API row source.
func TestNamespaceNetworkBuilderMaintainedMatchesListPath(t *testing.T) {
	now := time.Now()
	svc := &corev1.Service{
		ObjectMeta: metav1.ObjectMeta{Name: "api", Namespace: "default", ResourceVersion: "61", CreationTimestamp: metav1.NewTime(now.Add(-30 * time.Minute))},
		Spec:       corev1.ServiceSpec{Type: corev1.ServiceTypeClusterIP, ClusterIP: "10.0.0.1", Ports: []corev1.ServicePort{{Port: 443, Protocol: corev1.ProtocolTCP}}},
	}
	ing := &networkingv1.Ingress{
		ObjectMeta: metav1.ObjectMeta{Name: "web", Namespace: "default", ResourceVersion: "63", CreationTimestamp: metav1.NewTime(now.Add(-20 * time.Minute))},
		Spec:       networkingv1.IngressSpec{Rules: []networkingv1.IngressRule{{Host: "app.example.com"}}},
	}
	hr1 := &gatewayv1.HTTPRoute{ObjectMeta: metav1.ObjectMeta{Name: "route-1", Namespace: "default", ResourceVersion: "70", CreationTimestamp: metav1.NewTime(now.Add(-10 * time.Minute))}}
	hr2 := &gatewayv1.HTTPRoute{ObjectMeta: metav1.ObjectMeta{Name: "route-2", Namespace: "app", ResourceVersion: "71", CreationTimestamp: metav1.NewTime(now.Add(-5 * time.Minute))}}

	ingestSrc := newFakeNetworkIngestSource(ClusterMeta{}, svc, ing)

	hrIndexer := cache.NewIndexer(cache.MetaNamespaceKeyFunc, cache.Indexers{cache.NamespaceIndex: cache.MetaNamespaceIndexFunc})
	require.NoError(t, hrIndexer.Add(hr1))
	require.NoError(t, hrIndexer.Add(hr2))
	collectIndexer := networkCollectIndexer(networkIndexers{
		ingress:   ingestAvailabilityIndexer, // cut kind: sentinel marks it available; rows come from ingest
		httproute: hrIndexer,
	})

	maintained := newTypedMaintainedStore(ClusterMeta{}, networkQuerypageSchema(), networkTableQueryAdapter())
	for _, d := range kindregistry.StreamDescriptorsForDomain(namespaceNetworkDomainName) {
		if d.Resource == "httproutes" {
			maintained.ingest(d, hr1)
			maintained.ingest(d, hr2)
		}
	}

	mk := func(withMaintained bool) *NamespaceNetworkBuilder {
		b := &NamespaceNetworkBuilder{
			networkIngest:    ingestSrc,
			includeServices:  true,
			includeIngresses: true,
			collectIndexer:   collectIndexer,
		}
		if withMaintained {
			b.gatewayMaintained = maintained
		}
		return b
	}
	listBuilder := mk(false)
	maintainedBuilder := mk(true)

	scopes := []string{
		"namespace:default",
		"namespace:all",
		"namespace:default?sortField=kind&sortDirection=asc",
		"namespace:all?search=route",
		"namespace:all?kinds=HTTPRoute",
	}
	for _, scope := range scopes {
		listSnap, err := listBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "list build %q", scope)
		maintSnap, err := maintainedBuilder.Build(context.Background(), scope)
		require.NoError(t, err, "maintained build %q", scope)

		require.Equal(t,
			listSnap.Payload.(NamespaceNetworkSnapshot),
			maintSnap.Payload.(NamespaceNetworkSnapshot),
			"scope %q: maintained Build payload must equal the list Build payload", scope)
	}
}
