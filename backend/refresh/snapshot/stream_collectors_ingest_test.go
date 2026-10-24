package snapshot

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
	apiextensionsfake "k8s.io/apiextensions-apiserver/pkg/client/clientset/clientset/fake"
	kubefake "k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
	gatewayfake "sigs.k8s.io/gateway-api/pkg/client/clientset/versioned/fake"
)

// ingestManagerForTest builds an IngestManager from a fake kube clientset so its
// per-GVR stores exist (StoreFor != nil) without a live apiserver. It is NOT started,
// so no reflector runs; the availability gate only reads store presence.
func ingestManagerForTest(t *testing.T) *ingest.IngestManager {
	t.Helper()
	return ingest.NewIngestManager(
		streamrows.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		kubefake.NewSimpleClientset(),
		apiextensionsfake.NewClientset(),
		&ingest.GatewaySource{Client: gatewayfake.NewSimpleClientset(), Presence: everyGatewayKind{}}, //nolint:staticcheck // no reflector runs
	)
}

// everyGatewayKind is a cluster that serves every Gateway API kind.
type everyGatewayKind struct{}

func (everyGatewayKind) Has(string) bool    { return true }
func (everyGatewayKind) Absent(string) bool { return false }

// allowAll builds an AllowedResources permitting every descriptor in the domain, so the
// registration gate passes and the only remaining factor is ingest-store presence.
func allowAll(domainName string) domainpermissions.AllowedResources {
	allowed := domainpermissions.AllowedResources{}
	for _, d := range kindregistry.StreamDescriptorsForDomain(domainName) {
		allowed[permissions.ResourceKey(d.Group, d.Resource)] = true
	}
	return allowed
}

// TestIngestAvailabilityResolvesKindsFromIngestStore is the availability-gate proof:
// for an access-gated domain (namespace-quotas) every permitted kind reports available
// from its ingest store.
func TestIngestAvailabilityResolvesKindsFromIngestStore(t *testing.T) {
	domainName := namespaceQuotasDomainName
	cut := kindregistry.StreamDescriptorsForDomain(domainName)
	require.NotEmpty(t, cut, "namespace-quotas must have stream kinds")

	ingestManager := ingestManagerForTest(t)

	// Every permitted kind resolves from the ingest store's sentinel indexer.
	collect := ingestAvailability(allowAll(domainName), domainName, ingestManager)
	for _, d := range cut {
		require.Equal(t, typedTableResourceAvailable, collect(d),
			"kind %s must be available from its ingest store", d.Kind)
	}
}

// TestIngestAvailabilityRespectsRegistrationPermission proves the access-gated
// availability is byte-equivalent: a cut kind DENIED at registration is unavailable
// even though its ingest store exists — the registration permission gate still applies,
// exactly as when the indexer came from a permitted typed source.
func TestIngestAvailabilityRespectsRegistrationPermission(t *testing.T) {
	domainName := namespaceQuotasDomainName
	cut := kindregistry.StreamDescriptorsForDomain(domainName)
	require.NotEmpty(t, cut, "namespace-quotas must have stream kinds")

	ingestManager := ingestManagerForTest(t)

	// Permit nothing: the registration gate denies every kind, so none is available
	// regardless of ingest-store presence.
	denied := domainpermissions.AllowedResources{}
	collect := ingestAvailability(denied, domainName, ingestManager)
	for _, d := range cut {
		require.Equal(t, typedTableResourceUnavailable, collect(d),
			"cut kind %s denied at registration must be unavailable even with an ingest store", d.Kind)
	}
}

// TestUnconditionalIngestAvailabilityResolvesKindsFromIngestStore proves the
// unconditional storage-domain path: kinds (PersistentVolume in cluster-storage)
// report available from the ingest store unconditionally, since these domains gate
// access at the domain level.
func TestUnconditionalIngestAvailabilityResolvesKindsFromIngestStore(t *testing.T) {
	domainName := clusterStorageDomainName
	cut := kindregistry.StreamDescriptorsForDomain(domainName)
	require.NotEmpty(t, cut, "cluster-storage must have stream kinds")

	ingestManager := ingestManagerForTest(t)
	collect := unconditionalIngestAvailability(domainName, ingestManager)
	for _, d := range cut {
		require.Equal(t, typedTableResourceAvailable, collect(d),
			"kind %s must be available from its ingest store", d.Kind)
	}
}

// TestEveryTypedTableDomainResolvesAvailabilityFromIngest is the consolidated
// availability proof: across EVERY typed-table domain, the production indexer source
// resolves every stream kind from its ingest store.
func TestEveryTypedTableDomainResolvesAvailabilityFromIngest(t *testing.T) {
	ingestManager := ingestManagerForTest(t)

	// Each domain with its production indexer source.
	cases := []struct {
		domain  string
		collect kindAvailability
	}{
		{namespaceQuotasDomainName, ingestAvailability(allowAll(namespaceQuotasDomainName), namespaceQuotasDomainName, ingestManager)},
		{namespaceRBACDomainName, ingestAvailability(allowAll(namespaceRBACDomainName), namespaceRBACDomainName, ingestManager)},
		{namespaceStorageDomainName, unconditionalIngestAvailability(namespaceStorageDomainName, ingestManager)},
		{namespaceConfigDomainName, ingestAvailability(allowAll(namespaceConfigDomainName), namespaceConfigDomainName, ingestManager)},
		{clusterRBACDomainName, ingestAvailability(allowAll(clusterRBACDomainName), clusterRBACDomainName, ingestManager)},
		{clusterStorageDomainName, unconditionalIngestAvailability(clusterStorageDomainName, ingestManager)},
		{clusterCRDDomainName, unconditionalIngestAvailability(clusterCRDDomainName, ingestManager)},
		{clusterConfigDomainName, ingestAvailability(allowAll(clusterConfigDomainName), clusterConfigDomainName, ingestManager)},
		// namespace-network's cut Stream-backed kinds are Ingress and NetworkPolicy (Service/
		// EndpointSlice are Stream-less bespoke — see TestStreamlessKindsAreBespoke).
		{namespaceNetworkDomainName, ingestAvailability(allowAll(namespaceNetworkDomainName), namespaceNetworkDomainName, ingestManager)},
		{namespaceAutoscalingDomainName, unconditionalIngestAvailability(namespaceAutoscalingDomainName, ingestManager)},
	}

	// StreamDescriptorsForDomain loops the domain's STREAM descriptors, so it returns
	// only the Stream-backed cut kinds (namespace-network's Ingress/NetworkPolicy); the
	// Stream-LESS bespoke cut kinds (Service/EndpointSlice) have no stream descriptor and are
	// covered by TestStreamlessKindsAreBespoke, not this generic gate.
	totalCut := 0
	for _, tc := range cases {
		cut := kindregistry.StreamDescriptorsForDomain(tc.domain)
		require.NotEmptyf(t, cut, "domain %s expected to have stream kinds", tc.domain)
		for _, d := range cut {
			totalCut++
			require.Equalf(t, typedTableResourceAvailable, tc.collect(d),
				"domain %s kind %s must resolve from its ingest store", tc.domain, d.Kind)
		}
	}
	// Every kind with a Stream descriptor is covered by these 6 typed-table
	// domains. The Stream-LESS stream kinds (Pod plus the five workload kinds) carry a
	// bespoke cross-kind table — PodSummary / WorkloadSummary — served by their own domain's
	// maintained store, not the generic collectDescriptorTableRows path, so they are covered
	// by their own availability path, not these gates — see
	// TestStreamlessKindsAreBespoke.
	streamedCut := 0
	for _, d := range kindregistry.All {
		if d.Stream != nil {
			streamedCut++
		}
	}
	require.Equal(t, streamedCut, totalCut,
		"every Stream-backed kind must be covered by a typed-table domain's ingest-sourced availability gate")
}

// TestStreamlessKindsAreBespoke pins the documented exception: the
// kinds WITHOUT a Stream descriptor are Pod, the five workload kinds
// (Deployment/StatefulSet/DaemonSet/Job/CronJob), the two network join kinds
// (Service/EndpointSlice), Node, ReplicaSet, Namespace, and Event. Each carries a bespoke
// table — PodSummary / WorkloadSummary, the Service↔EndpointSlice-joined NetworkSummary, the
// NodeSummary whose row joins per-node pod aggregates + metrics, the NamespaceSummary joined
// with workload presence, or the two Events tables fed from one row — served by its own
// domain (or, for ReplicaSet, no table) rather than the generic typed-table availability gate. This is the reason
// TestEveryTypedTableDomainResolvesAvailabilityFromIngest counts only Stream-backed cut
// kinds.
func TestStreamlessKindsAreBespoke(t *testing.T) {
	expected := map[string]struct{}{
		"Pod": {}, "Deployment": {}, "StatefulSet": {}, "DaemonSet": {}, "Job": {}, "CronJob": {},
		"Service": {}, "EndpointSlice": {}, "Node": {}, "ReplicaSet": {}, "Namespace": {}, "Event": {},
	}
	got := map[string]struct{}{}
	for _, d := range kindregistry.All {
		if d.Stream == nil {
			got[d.Identity.Kind] = struct{}{}
		}
	}
	require.Equal(t, expected, got,
		"the Stream-less stream kinds must be exactly Pod, the five workload kinds, the two network join kinds, Node, ReplicaSet, Namespace, and Event")
}

// TestIngestAvailabilityWithNoIngestManagerIsUnavailable proves the documented edge:
// with no ingest manager wired (e.g. a unit test), a cut kind has no ingest store, so
// the gate reports it unavailable rather than fabricating a typed source.
func TestIngestAvailabilityWithNoIngestManagerIsUnavailable(t *testing.T) {
	domainName := namespaceQuotasDomainName
	cut := kindregistry.StreamDescriptorsForDomain(domainName)
	require.NotEmpty(t, cut)

	collect := ingestAvailability(allowAll(domainName), domainName, nil)
	for _, d := range cut {
		require.Equal(t, typedTableResourceUnavailable, collect(d),
			"kind %s with no ingest manager must be unavailable", d.Kind)
	}
}

// gatewayDiscovery is a cluster's Gateway API discovery result: the cluster
// serves no Gateway kind, and complete says whether discovery finished for the
// Gateway group (so the absence is confirmed).
type gatewayDiscovery struct{ complete bool }

func (gatewayDiscovery) Has(string) bool      { return false }
func (d gatewayDiscovery) Absent(string) bool { return d.complete }

// A cluster that does not serve the Gateway API has no GatewayClasses to miss:
// Cluster Config reports no GatewayClass gap and offers no GatewayClass kind.
// When discovery could not tell, GatewayClass stays reported as unavailable.
func TestClusterConfigLeavesOutGatewayClassWhenTheClusterDoesNotServeIt(t *testing.T) {
	for _, tc := range []struct {
		name           string
		discovery      gatewayDiscovery
		wantIssueKinds []string
	}{
		{name: "Gateway API not served", discovery: gatewayDiscovery{complete: true}, wantIssueKinds: nil},
		{name: "Gateway API discovery failed", discovery: gatewayDiscovery{complete: false}, wantIssueKinds: []string{"GatewayClass"}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			ingestManager := ingest.NewIngestManager(
				streamrows.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
				kubefake.NewSimpleClientset(),
				apiextensionsfake.NewClientset(),
				&ingest.GatewaySource{Presence: tc.discovery},
			)
			builder := &ClusterConfigBuilder{
				available:  ingestAvailability(allowAll(clusterConfigDomainName), clusterConfigDomainName, ingestManager),
				maintained: maintainedFromIndexers(ClusterMeta{}, clusterConfigDomainSpec(), func(streamspec.Descriptor) cache.Indexer { return nil }),
			}

			snapshot, err := builder.Build(context.Background(), "c1|?limit=10")
			require.NoError(t, err)
			payload := snapshot.Payload.(ClusterConfigSnapshot)
			var issueKinds []string
			for _, issue := range payload.Issues {
				issueKinds = append(issueKinds, issue.Kind)
			}
			require.Equal(t, tc.wantIssueKinds, issueKinds)
			require.NotContains(t, payload.Capabilities.KindVocabulary, "GatewayClass")
			require.Contains(t, payload.Capabilities.KindVocabulary, "StorageClass")
		})
	}
}
