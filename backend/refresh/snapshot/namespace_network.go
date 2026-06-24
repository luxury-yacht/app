package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

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
// shared factory no longer caches the typed objects, so the builder reads each kind's
// projected NetworkSummary (the Bundle Table half) from the ingest source instead of typed
// listers. Service rows are OWN-fields (built with nil slices); the serve path re-joins the
// endpoint count from the projected EndpointSlice store's join facts, byte-identical to the
// typed path. The Gateway-API kinds are NOT cut and stay descriptor-driven via the stream
// registry (collectIndexer + collectDescriptorTableRows). The include* flags record whether
// the request is permitted to read each cut kind (the gate the typed listers' presence used
// to imply).
type NamespaceNetworkBuilder struct {
	networkIngest          networkIngestSource
	includeServices        bool
	includeEndpointSlices  bool
	includeIngresses       bool
	includeNetworkPolicies bool
	collectIndexer         func(streamspec.Descriptor) cache.Indexer
	// gatewayMaintained holds the uncut Gateway-API kinds' projected NetworkSummary rows,
	// fed from the Gateway-API informers (the cut kinds are ingest-owned and skipped). When
	// set, Build reads the Gateway-API rows from it instead of listing the gateway indexers
	// per request; otherwise it falls back to collectDescriptorTableRows (the unit tests).
	gatewayMaintained *typedMaintainedStore[NetworkSummary]
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
// (IngestOwned): the shared factory no longer caches them, so the builder reads their
// projected rows from ingestManager. The per-kind include flags gate which cut kinds the
// request is permitted to read (the gate the typed listers' presence used to imply). The
// uncut Gateway-API kinds are still indexer-driven via collectIndexer. When ingestManager
// is nil (a unit test) the cut kinds have no source.
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

	// Maintain a store of the uncut Gateway-API kinds' rows, fed from the Gateway-API
	// informers. registerMaintainedHandlers skips the ingest-owned cut kinds (Service/
	// EndpointSlice/Ingress/NetworkPolicy), so the store holds only the Gateway-API rows.
	gatewayMaintained := newTypedMaintainedStore(clusterMeta, networkQuerypageSchema(), networkTableQueryAdapter())
	if err := registerMaintainedHandlers(gatewayMaintained, namespaceNetworkDomainName, collectIndexer, factory, gatewayFactory); err != nil {
		return err
	}

	builder := &NamespaceNetworkBuilder{
		networkIngest:          ingestManager,
		includeServices:        allowed.Allows("", "services"),
		includeEndpointSlices:  allowed.Allows("discovery.k8s.io", "endpointslices"),
		includeIngresses:       allowed.Allows("networking.k8s.io", "ingresses"),
		includeNetworkPolicies: allowed.Allows("networking.k8s.io", "networkpolicies"),
		collectIndexer:         collectIndexer,
		gatewayMaintained:      gatewayMaintained,
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

	// Service, EndpointSlice, Ingress, and NetworkPolicy are cut to the ingest path: read
	// each kind's projected NetworkSummary rows (the Bundle Table half) from the ingest
	// source instead of a typed lister, gated by the per-request runtime permission AND the
	// registration-time include flag (the gate the typed listers' presence used to imply).
	servicesAvailable := b.includeServices && runtimeResourceAllowed(ctx, namespaceNetworkDomainName, "", "services")
	endpointSlicesAvailable := b.includeEndpointSlices && runtimeResourceAllowed(ctx, namespaceNetworkDomainName, "discovery.k8s.io", "endpointslices")
	ingressesAvailable := b.includeIngresses && runtimeResourceAllowed(ctx, namespaceNetworkDomainName, "networking.k8s.io", "ingresses")
	networkPoliciesAvailable := b.includeNetworkPolicies && runtimeResourceAllowed(ctx, namespaceNetworkDomainName, "networking.k8s.io", "networkpolicies")

	var serviceOwnRows []NetworkSummary
	if servicesAvailable {
		serviceOwnRows = namespaceNetworkOwnRows(b.networkIngest, ServiceGVR, namespace)
	}
	// EndpointSlice rows AND the Service join facts both come from the EndpointSlice store.
	// The Service join needs the slices' ready counts even when EndpointSlice itself is not
	// a permitted source row, matching the typed path (which always listed slices to build
	// the Service join, and only emitted EndpointSlice rows when permitted).
	var endpointSliceRows []NetworkSummary
	if endpointSlicesAvailable {
		endpointSliceRows = namespaceNetworkOwnRows(b.networkIngest, EndpointSliceGVR, namespace)
	}
	readyCounts := namespaceEndpointSliceReadyCounts(b.networkIngest, namespace)
	var ingressRows []NetworkSummary
	if ingressesAvailable {
		ingressRows = namespaceNetworkOwnRows(b.networkIngest, IngressGVR, namespace)
	}
	var networkPolicyRows []NetworkSummary
	if networkPoliciesAvailable {
		networkPolicyRows = namespaceNetworkOwnRows(b.networkIngest, NetworkPolicyGVR, namespace)
	}

	// The Gateway-API kinds are NOT cut. Their SOURCE entries (availability) — and the cut
	// kinds' — come from collectDescriptorSources for ALL the domain's stream descriptors.
	// Their ROWS come from the maintained store (fed by the Gateway-API informers via the
	// same StreamRow projection) in production, or collectDescriptorTableRows in the unit
	// tests; the cut kinds' rows always come from ingest above.
	descriptorSources := collectDescriptorSources(ctx, namespaceNetworkDomainName, b.collectIndexer)
	var descriptorRows []NetworkSummary
	var version uint64
	if b.gatewayMaintained != nil {
		// The store holds ONLY the Gateway-API rows (registerMaintainedHandlers skips the
		// ingest-owned cut kinds), so a namespace filter is all that is needed.
		descriptorRows = b.gatewayMaintained.rowsInNamespace(namespace)
		version = b.gatewayMaintained.snapshotVersion()
	} else {
		rows, _, listVersion, err := collectDescriptorTableRows[NetworkSummary](ctx, namespaceNetworkDomainName, b.collectIndexer, meta, namespace)
		if err != nil {
			return nil, err
		}
		descriptorRows = rows
		version = listVersion
	}

	resources := make([]NetworkSummary, 0, len(serviceOwnRows)+len(endpointSliceRows)+len(ingressRows)+len(networkPolicyRows)+len(descriptorRows))
	// Service rows re-join the endpoint count from the EndpointSlice store's join facts,
	// reproducing the typed service.BuildStreamSummary(meta, svc, slices) row byte for byte.
	for _, own := range serviceOwnRows {
		resources = append(resources, reaggregateServiceSummary(own, readyCounts[serviceSliceKey(own.Namespace, own.Name)]))
	}
	resources = append(resources, endpointSliceRows...)
	resources = append(resources, ingressRows...)
	resources = append(resources, networkPolicyRows...)
	resources = append(resources, descriptorRows...)

	// The projected network rows carry no per-object RV (the typed objects are gone), so the
	// cut stores' latest RV is folded into the version watermark (which starts from the
	// Gateway-API descriptor rows' max RV) to keep refetch identity advancing on changes —
	// mirroring how the prior code folded each typed object's resourceVersion.
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
