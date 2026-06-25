package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"k8s.io/apimachinery/pkg/runtime/schema"
	informers "k8s.io/client-go/informers"
	"k8s.io/client-go/tools/cache"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/refresh/ingest"
	"github.com/luxury-yacht/app/backend/refresh/querypage"
	"github.com/luxury-yacht/app/backend/resources/backendtlspolicy"
	"github.com/luxury-yacht/app/backend/resources/endpointslice"
	"github.com/luxury-yacht/app/backend/resources/gateway"
	"github.com/luxury-yacht/app/backend/resources/grpcroute"
	"github.com/luxury-yacht/app/backend/resources/httproute"
	"github.com/luxury-yacht/app/backend/resources/ingress"
	"github.com/luxury-yacht/app/backend/resources/listenerset"
	"github.com/luxury-yacht/app/backend/resources/networkpolicy"
	"github.com/luxury-yacht/app/backend/resources/referencegrant"
	"github.com/luxury-yacht/app/backend/resources/service"
	"github.com/luxury-yacht/app/backend/resources/tlsroute"
)

const (
	namespaceNetworkDomainName       = "namespace-network"
	errNamespaceNetworkScopeRequired = "namespace scope is required"
)

// NamespaceNetworkBuilder constructs summaries for namespace-scoped network resources.
// Service, EndpointSlice, Ingress, and NetworkPolicy are owned-reflector ingest kinds: the
// shared factory no longer caches the typed objects, so each kind's projected NetworkSummary
// (the Bundle Table half) is fed into the maintained store from that GVR's ingest Sink — the
// SAME mechanism nodes/workloads use — and Build serves the OWN-rows straight from the store
// (scope + allowed-kind filtered) instead of pulling + re-projecting per request. Service rows
// are OWN-fields (built with nil slices); the serve path re-joins the endpoint count from the
// projected EndpointSlice store's join facts (a SERVE-time cross-kind join read from the ingest
// source, like the workloads pod-aggregate overlay), byte-identical to the typed path. The
// Gateway-API kinds are NOT cut and stay descriptor-driven via the stream registry
// (registerMaintainedHandlers feeds their rows into the SAME store). The include* flags record
// whether the request is permitted to read each cut kind (the gate the typed listers' presence
// used to imply).
type NamespaceNetworkBuilder struct {
	networkIngest          networkIngestSource
	includeServices        bool
	includeEndpointSlices  bool
	includeIngresses       bool
	includeNetworkPolicies bool
	collectIndexer         func(streamspec.Descriptor) cache.Indexer
	// maintained holds ALL the domain's OWN-rows (NetworkSummary): the four cut kinds'
	// (Service/EndpointSlice/Ingress/NetworkPolicy) Table halves fed by each GVR's ingest
	// Sink, AND the uncut Gateway-API kinds' rows fed from the Gateway-API informers
	// (registerMaintainedHandlers). Build reads every own-row from it (scope + allowed-kind
	// filtered) and re-joins the EndpointSlice endpoint count onto Service rows at serve. nil in
	// a unit test with no store wired, in which case no own-rows are served (the SAME no-fallback
	// contract nodes/workloads use; tests seed the store via the Sink).
	maintained *typedMaintainedStore[NetworkSummary]
}

// NamespaceNetworkSnapshot payload for the network tab.
type NamespaceNetworkSnapshot struct {
	ClusterMeta
	ResourceQueryEnvelope
	Rows []NetworkSummary `json:"rows"`
}

func namespaceNetworkQueryCapabilities() ResourceQueryCapabilities {
	return newTypedResourceCapabilities(
		[]string{"name", "kind", "namespace", "details", "age"},
		[]string{"kinds", "namespaces"},
		[]string{"kind", "name", "namespace", "details"},
		[]string{service.Identity.Kind, ingress.Identity.Kind, endpointslice.Identity.Kind, networkpolicy.Identity.Kind, gateway.Identity.Kind, httproute.Identity.Kind, grpcroute.Identity.Kind, tlsroute.Identity.Kind, listenerset.Identity.Kind, referencegrant.Identity.Kind, backendtlspolicy.Identity.Kind},
	)
}

// networkQuerypageSchema derives the querypage Schema for the network table from its
// typed-table adapter (reusing the adapter's exact sort encoder + row key), so the
// engine orders rows byte-identically to the live executor.
func networkQuerypageSchema() querypage.Schema[NetworkSummary] {
	return querypageSchemaFromAdapter(networkTableQueryAdapter(), []string{"name", "kind", "namespace", "details", "age"})
}

// NetworkSummary lives in the streamrows leaf so the kind packages can build it;
// this alias keeps the snapshot-side name and wire JSON unchanged.
type NetworkSummary = streamrows.NetworkSummary

// RegisterNamespaceNetworkDomainWithGatewayAPI registers the network domain,
// wiring Gateway-API kinds from the Gateway-API factory when it is available.
//
// Service, EndpointSlice, Ingress, and NetworkPolicy are owned-reflector ingest kinds
// (IngestOwned): the shared factory no longer caches them, so their projected OWN-rows (each
// kind's Table-half NetworkSummary) are fed into the maintained store from each GVR's ingest
// Sink — the SAME mechanism nodes/workloads use. Service and EndpointSlice are bespoke (no
// streamspec.Descriptor), so feedMaintainedFromIngest (which loops StreamDescriptors) cannot
// reach them; the four cut GVRs are wired explicitly here. The uncut Gateway-API kinds are fed
// into the SAME store from the Gateway-API informers (registerMaintainedHandlers skips the
// ingest-owned cut kinds, so it adds only the Gateway-API handlers). Build serves every own-row
// from the one store and re-joins the EndpointSlice endpoint count onto Service rows at serve
// (read from the ingest source, unchanged). The per-kind include flags gate which cut kinds the
// request is permitted to read (the gate the typed listers' presence used to imply). When
// ingestManager is nil (a unit test) the cut kinds have no Sink feed.
func RegisterNamespaceNetworkDomainWithGatewayAPI(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	gatewayFactory gatewayinformers.SharedInformerFactory,
	allowed domainpermissions.AllowedResources,
	clusterMeta ClusterMeta,
	ingestManager *ingest.IngestManager,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	collectIndexer := factoryIndexers(factory, gatewayFactory, allowed, namespaceNetworkDomainName, ingestManager)

	// One store holds ALL the domain's own-rows. Feed the four cut kinds' Table halves from
	// each GVR's whole-bundle ingest Sink (Service/EndpointSlice are bespoke, so they need an
	// explicit Sink each; Ingress/NetworkPolicy are stream-backed cut kinds, also wired explicitly
	// here for a single, uniform feed point), then feed the uncut Gateway-API kinds from their
	// informers (registerMaintainedHandlers skips the ingest-owned cut kinds). The Sinks/handlers
	// are registered BEFORE the ingest manager / informer factory start (this runs during
	// registration), so the snapshot sync gate guarantees the store is populated before the
	// first Build serves from it. nil ingestManager (a unit test) leaves the cut kinds unfed.
	maintained := newTypedMaintainedStore(clusterMeta, networkQuerypageSchema(), networkTableQueryAdapter())
	if ingestManager != nil {
		for _, gvr := range []schema.GroupVersionResource{ServiceGVR, EndpointSliceGVR, IngressGVR, NetworkPolicyGVR} {
			ingestManager.AddBundleSink(gvr, maintained.BundleSink())
		}
	}
	if err := registerMaintainedHandlers(maintained, namespaceNetworkDomainName, collectIndexer, factory, gatewayFactory); err != nil {
		return err
	}
	reg.RegisterMaintainedStore(namespaceNetworkDomainName, maintained) // spill/restore/reconcile across Cold/re-warm

	builder := &NamespaceNetworkBuilder{
		networkIngest:          ingestManager,
		includeServices:        allowed.Allows("", "services"),
		includeEndpointSlices:  allowed.Allows("discovery.k8s.io", "endpointslices"),
		includeIngresses:       allowed.Allows("networking.k8s.io", "ingresses"),
		includeNetworkPolicies: allowed.Allows("networking.k8s.io", "networkpolicies"),
		collectIndexer:         collectIndexer,
		maintained:             maintained,
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceNetworkDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build gathers services, endpoint slices, and every descriptor-driven network
// kind for the namespace.
func (b *NamespaceNetworkBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	baseScope, query, err := parseTypedTableQueryScope(clusterID, strings.TrimSpace(trimmed), namespaceNetworkDomainName, "")
	if err != nil {
		return nil, err
	}
	parsedScope, err := parseNamespaceSnapshotScope(refresh.JoinClusterScope(clusterID, baseScope), errNamespaceNetworkScopeRequired)
	if err != nil {
		return nil, err
	}
	namespace := parsedScope.Namespace

	// Service, EndpointSlice, Ingress, and NetworkPolicy are cut to the ingest path; their
	// per-request availability is the registration-time include flag AND the runtime
	// permission (the gate the typed listers' presence used to imply). Availability gates
	// which cut kinds' own-rows the maintained store serves for this request.
	servicesAvailable := b.includeServices && runtimeResourceAllowed(ctx, namespaceNetworkDomainName, "", "services")
	endpointSlicesAvailable := b.includeEndpointSlices && runtimeResourceAllowed(ctx, namespaceNetworkDomainName, "discovery.k8s.io", "endpointslices")
	ingressesAvailable := b.includeIngresses && runtimeResourceAllowed(ctx, namespaceNetworkDomainName, "networking.k8s.io", "ingresses")
	networkPoliciesAvailable := b.includeNetworkPolicies && runtimeResourceAllowed(ctx, namespaceNetworkDomainName, "networking.k8s.io", "networkpolicies")

	// The Service endpoint-count join is a SERVE-time cross-kind join: it sums each Service's
	// correlated EndpointSlices' ready endpoint addresses from the ingest source's Aggregate
	// half (NOT delivered to the maintained store's Sink, which carries only the Table half).
	// It is read from ingest exactly as before, so the re-joined Service row stays byte-
	// identical. The join needs the slices' ready counts even when EndpointSlice itself is not
	// a permitted source row, matching the typed path.
	readyCounts := namespaceEndpointSliceReadyCounts(b.networkIngest, namespace)

	descriptorSources := collectDescriptorSources(ctx, namespaceNetworkDomainName, b.collectIndexer)

	// All own-rows come from the one Sink/informer-fed store: the four cut kinds' Table halves
	// (gated by their per-request availability) plus the uncut Gateway-API rows (ungated at the
	// row level — registerMaintainedHandlers only feeds kinds whose indexer was registered, so
	// the store already holds only the permitted Gateway-API kinds). A nil store (a unit test
	// with no store wired) yields no own-rows — the SAME no-fallback contract nodes/workloads use;
	// the network tests seed the store via the Sink (seedNetworkMaintained).
	var ownRows []NetworkSummary
	var version uint64
	if b.maintained != nil {
		ownRows = b.maintained.rows(namespace, b.servedKinds(
			servicesAvailable, endpointSlicesAvailable, ingressesAvailable, networkPoliciesAvailable, descriptorSources,
		))
		version = b.maintained.snapshotVersion()
	}

	resources := make([]NetworkSummary, 0, len(ownRows))
	// Service rows re-join the endpoint count from the EndpointSlice store's join facts,
	// reproducing the typed service.BuildStreamSummary(meta, svc, slices) row byte for byte.
	// Every other kind's own-row is served as-is.
	for _, own := range ownRows {
		if own.Kind == service.Identity.Kind {
			resources = append(resources, reaggregateServiceSummary(own, readyCounts[serviceSliceKey(own.Namespace, own.Name)]))
			continue
		}
		resources = append(resources, own)
	}

	// The projected network rows carry no per-object RV (the typed objects are gone), so the
	// cut stores' latest RV is folded into the version watermark (which starts from the
	// maintained store / descriptor rows' max RV) to keep refetch identity advancing on
	// changes — mirroring how the prior code folded each typed object's resourceVersion.
	if wlVersion := namespaceNetworkIngestVersion(b.networkIngest, ServiceGVR, EndpointSliceGVR, IngressGVR, NetworkPolicyGVR); wlVersion > version {
		version = wlVersion
	}

	sortNetworkSummaries(resources)

	// Sources in the canonical order the table contract expects: Service and
	// EndpointSlice first, then the descriptor kinds in registry order.
	sources := append([]typedTableResourceSource{
		{Kind: service.Identity.Kind, Group: "", Resource: "services", Available: servicesAvailable},
		{Kind: endpointslice.Identity.Kind, Group: "discovery.k8s.io", Resource: "endpointslices", Available: endpointSlicesAvailable, QueryKinds: []string{endpointslice.Identity.Kind, service.Identity.Kind}},
	}, descriptorSources...)

	issues := typedTableQueryResourceIssues(ctx, namespaceNetworkDomainName, query, sources)
	resolved := resolveTypedSnapshotPageViaStore(
		namespaceNetworkDomainName,
		resources,
		query,
		networkTableQueryAdapter(),
		networkQuerypageSchema(),
		capabilitiesWithAvailableKinds(namespaceNetworkQueryCapabilities(), sources),
		config.SnapshotNamespaceNetworkEntryLimit,
		"network resources",
		func(resource NetworkSummary) string { return resource.Kind },
		issues,
	)
	return &refresh.Snapshot{
		Domain:  namespaceNetworkDomainName,
		Scope:   refresh.JoinClusterScope(clusterID, strings.TrimSpace(trimmed)),
		Version: version,
		Payload: NamespaceNetworkSnapshot{
			ClusterMeta:           meta,
			ResourceQueryEnvelope: resolved.Envelope,
			Rows:                  resolved.Rows,
		},
		Stats: resolved.Stats,
	}, nil
}

// servedKinds is the set of kinds whose own-rows this request serves from the maintained
// store: each cut kind gated by its per-request availability, plus EVERY Gateway-API
// descriptor kind (ungated at the row level — the store holds only the Gateway-API kinds
// whose informer handler was registered, matching the prior gateway-store rowsInNamespace
// read, while collectDescriptorSources still governs the published source availability).
func (b *NamespaceNetworkBuilder) servedKinds(
	servicesAvailable, endpointSlicesAvailable, ingressesAvailable, networkPoliciesAvailable bool,
	descriptorSources []typedTableResourceSource,
) map[string]bool {
	allowed := map[string]bool{
		service.Identity.Kind:       servicesAvailable,
		endpointslice.Identity.Kind: endpointSlicesAvailable,
		ingress.Identity.Kind:       ingressesAvailable,
		networkpolicy.Identity.Kind: networkPoliciesAvailable,
	}
	// The descriptor sources include the cut kinds (Ingress/NetworkPolicy) too; the cut-kind
	// entries above already set their availability, so only the Gateway-API kinds are added
	// here (their cut-kind names are overwritten with the same gated value they already hold
	// only if a future descriptor reorder collides, which it does not — the cut kinds are
	// keyed by their own gated flags above and not re-set to true).
	for _, src := range descriptorSources {
		switch src.Kind {
		case service.Identity.Kind, endpointslice.Identity.Kind, ingress.Identity.Kind, networkpolicy.Identity.Kind:
			// Cut kinds keep their per-request availability set above.
		default:
			allowed[src.Kind] = true
		}
	}
	return allowed
}

func sortNetworkSummaries(resources []NetworkSummary) {
	sort.SliceStable(resources, func(i, j int) bool {
		if resources[i].Namespace != resources[j].Namespace {
			return resources[i].Namespace < resources[j].Namespace
		}
		if resources[i].Name != resources[j].Name {
			return resources[i].Name < resources[j].Name
		}
		return resources[i].Kind < resources[j].Kind
	})
}

func serviceSliceKey(namespace, name string) string {
	return namespace + "/" + name
}
