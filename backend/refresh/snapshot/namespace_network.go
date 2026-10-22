package snapshot

import (
	"context"
	"sort"
	"strings"

	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
	"github.com/luxury-yacht/app/backend/refresh/doorbell"
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
	namespaceNetworkDiscoveryGroup   = "discovery.k8s.io"
	namespaceNetworkNetworkingGroup  = "networking.k8s.io"
)

// NamespaceNetworkBuilder constructs summaries for namespace-scoped network resources.
// Service, EndpointSlice, Ingress, and NetworkPolicy are owned-reflector ingest kinds: the
// shared factory no longer caches the typed objects, so each kind's projected NetworkSummary
// (the Bundle Table half) is fed into the maintained store from that GVR's ingest Sink — the
// SAME mechanism nodes/workloads use — and Build serves the OWN-rows straight from the store
// (scope + allowed-kind filtered) instead of pulling + re-projecting per request. Service rows
// are OWN-fields (built with nil slices); the serve path re-joins the endpoint count from the
// projected EndpointSlice store's join facts (a SERVE-time cross-kind join read from the ingest
// source, like the workloads pod-aggregate overlay). The Gateway API kinds are
// descriptor-driven via the stream registry and feed their rows into the SAME store. The
// include* flags record whether the request is permitted to read each kind.
type NamespaceNetworkBuilder struct {
	networkIngest          networkIngestSource
	includeServices        bool
	includeEndpointSlices  bool
	includeIngresses       bool
	includeNetworkPolicies bool
	available              kindAvailability
	// maintained holds ALL the domain's OWN-rows (NetworkSummary), each kind's Table half
	// fed by its GVR's ingest Sink. Build reads every own-row from it (scope + allowed-kind
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
		[]string{"name", "kind", "namespace", "context", "network", "age"},
		[]string{"kinds", "namespaces"},
		[]string{"kind", "name", "namespace", "context", "network", "summary"},
		[]string{service.Identity.Kind, ingress.Identity.Kind, endpointslice.Identity.Kind, networkpolicy.Identity.Kind, gateway.Identity.Kind, httproute.Identity.Kind, grpcroute.Identity.Kind, tlsroute.Identity.Kind, listenerset.Identity.Kind, referencegrant.Identity.Kind, backendtlspolicy.Identity.Kind},
	)
}

// networkQuerypageSchema derives the querypage Schema for the network table from its
// typed-table adapter (reusing the adapter's exact sort encoder + row key), so the
// engine orders rows byte-identically to the live executor.
func networkQuerypageSchema() querypage.Schema[NetworkSummary] {
	return querypageSchemaFromAdapter(networkTableQueryAdapter(), namespaceNetworkQueryCapabilities().SortableFields)
}

// NetworkSummary lives in the streamrows leaf so the kind packages can build it;
// this alias keeps the snapshot-side name and wire JSON unchanged.
type NetworkSummary = streamrows.NetworkSummary

// RegisterNamespaceNetworkDomain registers the network domain.
//
// Every network kind is an owned-reflector ingest kind, so each kind's projected
// OWN-row (its Table-half NetworkSummary) is fed into one maintained store from
// its ingest Sink. Service and EndpointSlice are bespoke (no
// streamspec.Descriptor), so feedMaintainedFromIngest (which loops
// StreamDescriptors) cannot reach them and they are wired explicitly here;
// Ingress, NetworkPolicy, and the Gateway API kinds are stream-backed and fed by
// feedMaintainedFromIngest. Build serves every own-row from the one store and
// re-joins the EndpointSlice endpoint count onto Service rows at serve. The
// per-kind include flags gate which kinds the request may read. When
// ingestManager is nil (a unit test) the store has no feed.
func RegisterNamespaceNetworkDomain(
	reg *domain.Registry,
	allowed domainpermissions.AllowedResources,
	clusterMeta ClusterMeta,
	ingestManager *ingest.IngestManager,
	bell doorbell.Bell,
) error {
	available := ingestAvailability(allowed, namespaceNetworkDomainName, ingestManager)

	// One store holds ALL the domain's own-rows. Each kind's bundle sink is scoped
	// to its kind, so one kind's relist replaces only that kind's rows. The sinks
	// are registered BEFORE the ingest manager starts (this runs during
	// registration), so the snapshot sync gate guarantees the store is populated
	// before the first Build serves from it.
	maintained := newTypedMaintainedStore(clusterMeta, networkQuerypageSchema(), networkTableQueryAdapter())
	if ingestManager != nil {
		for _, nk := range []struct {
			GVR  schema.GroupVersionResource
			Kind string
		}{
			{ServiceGVR, service.Identity.Kind},
			{EndpointSliceGVR, endpointslice.Identity.Kind},
		} {
			ingestManager.AddBundleSink(nk.GVR, maintained.sinkFor(nk.Kind, namespacedRowPublication(maintained, namespaceNetworkDomainName, bell)))
		}
	}
	feedMaintainedFromIngest(maintained, namespaceNetworkDomainName, ingestManager, bell, rowDerivation[NetworkSummary]{})
	reg.RegisterMaintainedStore(namespaceNetworkDomainName, maintained) // spill/restore across Cold/re-warm

	builder := &NamespaceNetworkBuilder{
		networkIngest:          ingestManager,
		includeServices:        allowed.Allows("", "services"),
		includeEndpointSlices:  allowed.Allows(namespaceNetworkDiscoveryGroup, "endpointslices"),
		includeIngresses:       allowed.Allows(namespaceNetworkNetworkingGroup, "ingresses"),
		includeNetworkPolicies: allowed.Allows(namespaceNetworkNetworkingGroup, "networkpolicies"),
		available:              available,
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
	parsedScope, err := parseNamespaceSnapshotScope(namespaceNetworkDomainName, clusterID, baseScope, errNamespaceNetworkScopeRequired)
	if err != nil {
		return nil, err
	}
	namespace := parsedScope.Namespace

	// Service, EndpointSlice, Ingress, and NetworkPolicy are cut to the ingest path; their
	// per-request availability is the registration-time include flag AND the runtime
	// permission (the gate the typed listers' presence used to imply). Availability gates
	// which cut kinds' own-rows the maintained store serves for this request.
	servicesAvailable := b.includeServices && runtimeResourceAllowed(ctx, namespaceNetworkDomainName, "", "services")
	endpointSlicesAvailable := b.includeEndpointSlices && runtimeResourceAllowed(ctx, namespaceNetworkDomainName, namespaceNetworkDiscoveryGroup, "endpointslices")
	ingressesAvailable := b.includeIngresses && runtimeResourceAllowed(ctx, namespaceNetworkDomainName, namespaceNetworkNetworkingGroup, "ingresses")
	networkPoliciesAvailable := b.includeNetworkPolicies && runtimeResourceAllowed(ctx, namespaceNetworkDomainName, namespaceNetworkNetworkingGroup, "networkpolicies")

	// The Service endpoint-count join is a SERVE-time cross-kind join: it sums each Service's
	// correlated EndpointSlices' ready endpoint addresses from the ingest source's Aggregate
	// half (NOT delivered to the maintained store's Sink, which carries only the Table half).
	// It is read from ingest exactly as before, so the re-joined Service row stays byte-
	// identical. The join needs the slices' ready counts even when EndpointSlice itself is not
	// a permitted source row, matching the typed path.
	readyCounts := namespaceEndpointSliceReadyCounts(b.networkIngest, namespace)

	descriptorSources := collectDescriptorSources(ctx, namespaceNetworkDomainName, b.available)

	// All own-rows come from the one Sink-fed store: the four cut kinds' Table halves
	// (gated by their per-request availability) plus Gateway-API rows whose descriptor source
	// still permits serving. Retained rows must follow current permission/readiness decisions,
	// even when their reflector was allowed at registration. A nil store (a unit test
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
		if own.Ref.Kind == service.Identity.Kind {
			resources = append(resources, reaggregateServiceSummary(own, readyCounts[serviceSliceKey(own.Ref.Namespace, own.Ref.Name)]))
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
		{Kind: service.Identity.Kind, Group: "", Resource: "services", State: typedTableSourceState(servicesAvailable)},
		{Kind: endpointslice.Identity.Kind, Group: namespaceNetworkDiscoveryGroup, Resource: "endpointslices", State: typedTableSourceState(endpointSlicesAvailable), QueryKinds: []string{endpointslice.Identity.Kind, service.Identity.Kind}},
	}, descriptorSources...)

	issues := typedTableQueryResourceIssues(ctx, namespaceNetworkDomainName, query, sources)
	resolved := resolveTypedSnapshotPageViaStore(
		namespaceNetworkDomainName,
		resources,
		query,
		networkTableQueryAdapter(),
		networkQuerypageSchema(),
		newTypedSnapshotPageConfig(
			capabilitiesWithAvailableKinds(namespaceNetworkQueryCapabilities(), sources),
			config.SnapshotNamespaceNetworkEntryLimit,
			"network resources",
			func(resource NetworkSummary) string { return resource.Ref.Kind },
			issues,
		),
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
// store. Both cut kinds and Gateway-API kinds follow their current source availability.
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
	// Cut kinds have explicit availability above; descriptors supply the Gateway-API kinds.
	for _, src := range descriptorSources {
		switch src.Kind {
		case service.Identity.Kind, endpointslice.Identity.Kind, ingress.Identity.Kind, networkpolicy.Identity.Kind:
			// Cut kinds keep their per-request availability set above.
		default:
			allowed[src.Kind] = src.State.servesRows()
		}
	}
	return allowed
}

func sortNetworkSummaries(resources []NetworkSummary) {
	sort.SliceStable(resources, func(i, j int) bool {
		if resources[i].Ref.Namespace != resources[j].Ref.Namespace {
			return resources[i].Ref.Namespace < resources[j].Ref.Namespace
		}
		if resources[i].Ref.Name != resources[j].Ref.Name {
			return resources[i].Ref.Name < resources[j].Ref.Name
		}
		return resources[i].Ref.Kind < resources[j].Ref.Kind
	})
}

func serviceSliceKey(namespace, name string) string {
	return namespace + "/" + name
}
