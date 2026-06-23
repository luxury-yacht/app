package snapshot

import (
	"testing"

	"github.com/stretchr/testify/require"
	kubefake "k8s.io/client-go/kubernetes/fake"
	"k8s.io/client-go/tools/cache"

	"github.com/luxury-yacht/app/backend/kind/kindregistry"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/permissions"
)

// ingestManagerForTest builds an IngestManager from a fake kube clientset so its
// per-GVR stores exist (StoreFor != nil) without a live apiserver. It is NOT started,
// so no reflector runs; the availability gate only reads store presence.
func ingestManagerForTest(t *testing.T) *ingest.IngestManager {
	t.Helper()
	return ingest.NewIngestManager(
		streamrows.ClusterMeta{ClusterID: "c1", ClusterName: "cluster"},
		kubefake.NewSimpleClientset(),
		nil,
		nil,
	)
}

// ingestOwnedDescriptorsForDomain returns the domain's IngestOwned stream descriptors.
func ingestOwnedDescriptorsForDomain(domainName string) []streamspec.Descriptor {
	owned := kindregistry.IngestOwnedGVRs()
	var out []streamspec.Descriptor
	for _, d := range kindregistry.StreamDescriptorsForDomain(domainName) {
		if _, ok := owned[d.GVR()]; ok {
			out = append(out, d)
		}
	}
	return out
}

// allowAll builds an AllowedResources permitting every descriptor in the domain, so the
// registration gate passes and the only remaining factor is ingest-store presence.
func allowAll(domainName string) domainpermissions.AllowedResources {
	allowed := domainpermissions.AllowedResources{}
	for _, d := range kindregistry.StreamDescriptorsForDomain(domainName) {
		allowed[permissions.ResourceKey(d.Group, d.Resource)] = true
	}
	return allowed
}

// TestFactoryIndexersResolvesIngestOwnedFromIngestStore is the availability-gate proof:
// for an access-gated domain (namespace-quotas, all-cut) the cut kinds report available
// from the ingest store WITHOUT any shared informer factory (a nil factory cannot
// create one), so collectIndexer(d) != nil holds exactly as it did when it sourced a
// typed informer indexer. This proves the gate is sourced from ingest, not a typed
// informer.
func TestFactoryIndexersResolvesIngestOwnedFromIngestStore(t *testing.T) {
	domainName := namespaceQuotasDomainName
	cut := ingestOwnedDescriptorsForDomain(domainName)
	require.NotEmpty(t, cut, "namespace-quotas must have IngestOwned kinds")

	ingestManager := ingestManagerForTest(t)

	// nil shared factory: if the gate still touched d.Informer(shared) it would panic
	// or yield nil; instead it must resolve every permitted cut kind from the ingest
	// store's sentinel indexer.
	collect := sharedFactoryIndexers(nil, allowAll(domainName), domainName, ingestManager)
	for _, d := range cut {
		require.NotNil(t, collect(d),
			"cut kind %s must be available from the ingest store with no shared informer", d.Kind)
	}
}

// TestFactoryIndexersIngestOwnedRespectsRegistrationPermission proves the access-gated
// availability is byte-equivalent: a cut kind DENIED at registration is unavailable
// even though its ingest store exists — the registration permission gate still applies,
// exactly as when the indexer came from a permitted typed informer.
func TestFactoryIndexersIngestOwnedRespectsRegistrationPermission(t *testing.T) {
	domainName := namespaceQuotasDomainName
	cut := ingestOwnedDescriptorsForDomain(domainName)
	require.NotEmpty(t, cut, "namespace-quotas must have IngestOwned kinds")

	ingestManager := ingestManagerForTest(t)

	// Permit nothing: the registration gate denies every kind, so none is available
	// regardless of ingest-store presence.
	denied := domainpermissions.AllowedResources{}
	collect := sharedFactoryIndexers(nil, denied, domainName, ingestManager)
	for _, d := range cut {
		require.Nil(t, collect(d),
			"cut kind %s denied at registration must be unavailable even with an ingest store", d.Kind)
	}
}

// TestUnconditionalSharedIndexersResolvesIngestOwnedFromIngestStore proves the
// unconditional storage-domain path: cut kinds (PersistentVolume in cluster-storage)
// report available from the ingest store with no shared informer — unconditional, since
// these domains gate access at the domain level, mirroring the old unconditional
// d.Informer(factory) registration.
func TestUnconditionalSharedIndexersResolvesIngestOwnedFromIngestStore(t *testing.T) {
	domainName := clusterStorageDomainName
	cut := ingestOwnedDescriptorsForDomain(domainName)
	require.NotEmpty(t, cut, "cluster-storage must have IngestOwned kinds")

	ingestManager := ingestManagerForTest(t)
	collect := unconditionalSharedIndexers(nil, domainName, ingestManager)
	for _, d := range cut {
		require.NotNil(t, collect(d),
			"cut kind %s must be available from the ingest store with no shared informer", d.Kind)
	}
}

// TestEveryIngestOwnedDomainAvailabilityFromIngestNotInformer is the consolidated
// memory proof for the availability gate: across EVERY typed-table domain that holds
// IngestOwned kinds, the production indexer source resolves every cut kind from the
// ingest store with a NIL shared informer factory — i.e. no typed informer is created.
// A nil factory cannot serve d.Informer(shared); if any cut kind still routed through it
// the gate would report nil and this fails. This is the gate-side twin of the notify
// proof (registerDescriptorStreams skips IngestOwned kinds).
func TestEveryIngestOwnedDomainAvailabilityFromIngestNotInformer(t *testing.T) {
	ingestManager := ingestManagerForTest(t)

	// Each domain with its production indexer source, built with a NIL shared factory so
	// the only way a cut kind can be available is via the ingest store.
	cases := []struct {
		domain  string
		collect func(streamspec.Descriptor) cache.Indexer
	}{
		{namespaceQuotasDomainName, sharedFactoryIndexers(nil, allowAll(namespaceQuotasDomainName), namespaceQuotasDomainName, ingestManager)},
		{namespaceRBACDomainName, sharedFactoryIndexers(nil, allowAll(namespaceRBACDomainName), namespaceRBACDomainName, ingestManager)},
		{namespaceStorageDomainName, unconditionalSharedIndexers(nil, namespaceStorageDomainName, ingestManager)},
		{namespaceConfigDomainName, sharedFactoryIndexers(nil, allowAll(namespaceConfigDomainName), namespaceConfigDomainName, ingestManager)},
		{clusterRBACDomainName, sharedFactoryIndexers(nil, allowAll(clusterRBACDomainName), clusterRBACDomainName, ingestManager)},
		{clusterStorageDomainName, unconditionalSharedIndexers(nil, clusterStorageDomainName, ingestManager)},
		{clusterConfigDomainName, factoryIndexers(nil, nil, allowAll(clusterConfigDomainName), clusterConfigDomainName, ingestManager)},
		// namespace-network's cut Stream-backed kinds are Ingress and NetworkPolicy (Service/
		// EndpointSlice are Stream-less bespoke — see TestStreamlessIngestOwnedKindsAreBespoke).
		{namespaceNetworkDomainName, factoryIndexers(nil, nil, allowAll(namespaceNetworkDomainName), namespaceNetworkDomainName, ingestManager)},
	}

	// ingestOwnedDescriptorsForDomain loops the domain's STREAM descriptors, so it returns
	// only the Stream-backed cut kinds (namespace-network's Ingress/NetworkPolicy); the
	// Stream-LESS bespoke cut kinds (Service/EndpointSlice) have no stream descriptor and are
	// covered by TestStreamlessIngestOwnedKindsAreBespoke, not this generic gate.
	totalCut := 0
	for _, tc := range cases {
		cut := ingestOwnedDescriptorsForDomain(tc.domain)
		require.NotEmptyf(t, cut, "domain %s expected to have IngestOwned kinds", tc.domain)
		for _, d := range cut {
			totalCut++
			require.NotNilf(t, tc.collect(d),
				"domain %s cut kind %s must resolve from the ingest store with NO shared informer", tc.domain, d.Kind)
		}
	}
	// Every IngestOwned kind with a Stream descriptor is covered by these 6 typed-table
	// domains. The Stream-LESS IngestOwned kinds (Pod plus the five workload kinds) carry a
	// bespoke cross-kind table — PodSummary / WorkloadSummary — served by their own domain's
	// maintained store, not the generic collectDescriptorTableRows path, so they are covered
	// by their own availability path, not these gates — see
	// TestStreamlessIngestOwnedKindsAreBespoke.
	streamedCut := 0
	for _, d := range kindregistry.IngestOwnedDescriptors() {
		if d.Stream != nil {
			streamedCut++
		}
	}
	require.Equal(t, streamedCut, totalCut,
		"every Stream-backed IngestOwned kind must be covered by a typed-table domain's ingest-sourced availability gate")
}

// TestStreamlessIngestOwnedKindsAreBespoke pins the documented exception: the IngestOwned
// kinds WITHOUT a Stream descriptor are Pod, the five workload kinds
// (Deployment/StatefulSet/DaemonSet/Job/CronJob), the two network join kinds
// (Service/EndpointSlice), and Node. Each carries a bespoke table — PodSummary /
// WorkloadSummary, the Service↔EndpointSlice-joined NetworkSummary, or the NodeSummary whose
// row joins per-node pod aggregates + metrics — served by its own domain's serve-side re-join
// rather than the generic typed-table availability gate. This is the reason
// TestEveryIngestOwnedDomainAvailabilityFromIngestNotInformer counts only Stream-backed cut
// kinds.
func TestStreamlessIngestOwnedKindsAreBespoke(t *testing.T) {
	expected := map[string]struct{}{
		"Pod": {}, "Deployment": {}, "StatefulSet": {}, "DaemonSet": {}, "Job": {}, "CronJob": {},
		"Service": {}, "EndpointSlice": {}, "Node": {},
	}
	got := map[string]struct{}{}
	for _, d := range kindregistry.IngestOwnedDescriptors() {
		if d.Stream == nil {
			got[d.Identity.Kind] = struct{}{}
		}
	}
	require.Equal(t, expected, got,
		"the Stream-less IngestOwned kinds must be exactly Pod, the five workload kinds, the two network join kinds, and Node")
}

// TestIngestOwnedAvailabilityNilIngestManagerIsUnavailable proves the documented edge:
// with no ingest manager wired (e.g. a unit test), a cut kind has no ingest store, so
// the gate reports it unavailable rather than fabricating a typed informer.
func TestIngestOwnedAvailabilityNilIngestManagerIsUnavailable(t *testing.T) {
	domainName := namespaceQuotasDomainName
	cut := ingestOwnedDescriptorsForDomain(domainName)
	require.NotEmpty(t, cut)

	collect := sharedFactoryIndexers(nil, allowAll(domainName), domainName, nil)
	for _, d := range cut {
		require.Nil(t, collect(d),
			"cut kind %s with no ingest manager and no shared informer must be unavailable", d.Kind)
	}
}
