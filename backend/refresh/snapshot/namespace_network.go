package snapshot

import (
	"context"
	"fmt"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	corelisters "k8s.io/client-go/listers/core/v1"
	discoverylisters "k8s.io/client-go/listers/discovery/v1"
	"k8s.io/client-go/tools/cache"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/kind/streamrows"
	"github.com/luxury-yacht/app/backend/kind/streamspec"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
	"github.com/luxury-yacht/app/backend/refresh/domainpermissions"
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

// NamespaceNetworkBuilder constructs summaries for namespace-scoped network
// resources. Service and EndpointSlice stay custom because a Service row is
// projected together with its correlated EndpointSlices (which the per-object
// descriptor StreamRow cannot carry); every other network kind is descriptor-
// driven via the stream registry (collectIndexer + collectDescriptorTableRows).
type NamespaceNetworkBuilder struct {
	serviceLister       corelisters.ServiceLister
	endpointSliceLister discoverylisters.EndpointSliceLister
	collectIndexer      func(streamspec.Descriptor) cache.Indexer
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

// NetworkSummary lives in the streamrows leaf so the kind packages can build it;
// this alias keeps the snapshot-side name and wire JSON unchanged.
type NetworkSummary = streamrows.NetworkSummary

// RegisterNamespaceNetworkDomain registers the network domain with the registry.
func RegisterNamespaceNetworkDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	allowed domainpermissions.AllowedResources,
) error {
	return RegisterNamespaceNetworkDomainWithGatewayAPI(reg, factory, nil, allowed)
}

// RegisterNamespaceNetworkDomainWithGatewayAPI registers the network domain,
// wiring Gateway-API kinds from the Gateway-API factory when it is available.
// Only indexers/listers for permitted resources are wired; denied resources are
// skipped so they appear in the source list but are not listed.
func RegisterNamespaceNetworkDomainWithGatewayAPI(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	gatewayFactory gatewayinformers.SharedInformerFactory,
	allowed domainpermissions.AllowedResources,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &NamespaceNetworkBuilder{
		collectIndexer: factoryIndexers(factory, gatewayFactory, allowed, namespaceNetworkDomainName),
	}
	if allowed.Allows("", "services") {
		builder.serviceLister = factory.Core().V1().Services().Lister()
	}
	if allowed.Allows("discovery.k8s.io", "endpointslices") {
		builder.endpointSliceLister = factory.Discovery().V1().EndpointSlices().Lister()
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

	// Service and EndpointSlice are listed by hand because a Service row is built
	// together with its correlated EndpointSlices.
	servicesAvailable := b.serviceLister != nil && runtimeResourceAllowed(ctx, namespaceNetworkDomainName, "", "services")
	var services []*corev1.Service
	if servicesAvailable {
		services, err = b.listServices(namespace)
		if err != nil {
			return nil, fmt.Errorf("namespace network: failed to list services: %w", err)
		}
	}
	endpointSlicesAvailable := b.endpointSliceLister != nil && runtimeResourceAllowed(ctx, namespaceNetworkDomainName, "discovery.k8s.io", "endpointslices")
	var slices []*discoveryv1.EndpointSlice
	if endpointSlicesAvailable {
		slices, err = b.listEndpointSlices(namespace)
		if err != nil {
			return nil, fmt.Errorf("namespace network: failed to list endpoint slices: %w", err)
		}
	}
	slicesByService := groupEndpointSlicesByService(slices)

	// Every other network kind (Ingress, NetworkPolicy, Gateway API) is plain
	// object→row and is driven from the stream descriptor registry.
	descriptorRows, descriptorSources, version, err := collectDescriptorTableRows[NetworkSummary](ctx, namespaceNetworkDomainName, b.collectIndexer, meta, namespace)
	if err != nil {
		return nil, err
	}

	resources := make([]NetworkSummary, 0, len(services)+len(slices)+len(descriptorRows))
	// Delegate to the shared row builders so the full-snapshot path and the
	// streaming/incremental update path emit identical row shapes.
	for _, svc := range services {
		if svc == nil {
			continue
		}
		resources = append(resources, service.BuildStreamSummary(meta, svc, slicesByService[serviceSliceKey(svc.Namespace, svc.Name)]))
		if v := resourceVersionOrTimestamp(svc); v > version {
			version = v
		}
	}
	for _, slice := range slices {
		if slice == nil {
			continue
		}
		resources = append(resources, endpointslice.BuildStreamSummary(meta, slice))
		if v := resourceVersionOrTimestamp(slice); v > version {
			version = v
		}
	}
	resources = append(resources, descriptorRows...)

	sortNetworkSummaries(resources)

	// Sources in the canonical order the table contract expects: Service and
	// EndpointSlice first, then the descriptor kinds in registry order.
	sources := append([]typedTableResourceSource{
		{Kind: service.Identity.Kind, Group: "", Resource: "services", Available: servicesAvailable},
		{Kind: endpointslice.Identity.Kind, Group: "discovery.k8s.io", Resource: "endpointslices", Available: endpointSlicesAvailable, QueryKinds: []string{endpointslice.Identity.Kind, service.Identity.Kind}},
	}, descriptorSources...)

	issues := typedTableQueryResourceIssues(ctx, namespaceNetworkDomainName, query, sources)
	resolved := resolveTypedSnapshotPage(
		namespaceNetworkDomainName,
		resources,
		query,
		networkTableQueryAdapter(),
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

func (b *NamespaceNetworkBuilder) listServices(namespace string) ([]*corev1.Service, error) {
	if namespace == "" {
		return b.serviceLister.List(labels.Everything())
	}
	return b.serviceLister.Services(namespace).List(labels.Everything())
}

func (b *NamespaceNetworkBuilder) listEndpointSlices(namespace string) ([]*discoveryv1.EndpointSlice, error) {
	if namespace == "" {
		return b.endpointSliceLister.List(labels.Everything())
	}
	return b.endpointSliceLister.EndpointSlices(namespace).List(labels.Everything())
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

func groupEndpointSlicesByService(slices []*discoveryv1.EndpointSlice) map[string][]*discoveryv1.EndpointSlice {
	result := make(map[string][]*discoveryv1.EndpointSlice)
	for _, slice := range slices {
		if slice == nil {
			continue
		}
		service := slice.Labels[discoveryv1.LabelServiceName]
		if service == "" {
			continue
		}
		result[serviceSliceKey(slice.Namespace, service)] = append(result[serviceSliceKey(slice.Namespace, service)], slice)
	}
	return result
}

func serviceSliceKey(namespace, name string) string {
	return namespace + "/" + name
}
