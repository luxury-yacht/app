package snapshot

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"

	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	corelisters "k8s.io/client-go/listers/core/v1"
	discoverylisters "k8s.io/client-go/listers/discovery/v1"
	networklisters "k8s.io/client-go/listers/networking/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
	gatewayinformers "sigs.k8s.io/gateway-api/pkg/client/informers/externalversions"
	gatewaylisters "sigs.k8s.io/gateway-api/pkg/client/listers/apis/v1"

	"github.com/luxury-yacht/app/backend/internal/config"
	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

const (
	namespaceNetworkDomainName       = "namespace-network"
	errNamespaceNetworkScopeRequired = "namespace scope is required"
)

// NamespaceNetworkPermissions indicates which resources should be included in the domain.
type NamespaceNetworkPermissions struct {
	IncludeServices           bool
	IncludeEndpointSlices     bool
	IncludeIngresses          bool
	IncludeNetworkPolicies    bool
	IncludeGateways           bool
	IncludeHTTPRoutes         bool
	IncludeGRPCRoutes         bool
	IncludeTLSRoutes          bool
	IncludeListenerSets       bool
	IncludeReferenceGrants    bool
	IncludeBackendTLSPolicies bool
}

// NamespaceNetworkBuilder constructs summaries for namespace-scoped network resources.
type NamespaceNetworkBuilder struct {
	serviceLister          corelisters.ServiceLister
	endpointSliceLister    discoverylisters.EndpointSliceLister
	ingressLister          networklisters.IngressLister
	policyLister           networklisters.NetworkPolicyLister
	gatewayLister          gatewaylisters.GatewayLister
	httpRouteLister        gatewaylisters.HTTPRouteLister
	grpcRouteLister        gatewaylisters.GRPCRouteLister
	tlsRouteLister         gatewaylisters.TLSRouteLister
	listenerSetLister      gatewaylisters.ListenerSetLister
	referenceGrantLister   gatewaylisters.ReferenceGrantLister
	backendTLSPolicyLister gatewaylisters.BackendTLSPolicyLister
}

// NamespaceNetworkSnapshot payload for the network tab.
type NamespaceNetworkSnapshot struct {
	ClusterMeta
	Resources []NetworkSummary `json:"resources"`
	Kinds     []string         `json:"kinds,omitempty"`
}

// NetworkSummary mirrors the UI requirements for namespace network resources.
type NetworkSummary struct {
	ClusterMeta
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	Details   string `json:"details"`
	Age       string `json:"age"`
}

// RegisterNamespaceNetworkDomain registers the network domain with the registry.
// Only listers for permitted resources are wired; denied resources are left nil
// so the builder skips them gracefully.
func RegisterNamespaceNetworkDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	perms NamespaceNetworkPermissions,
) error {
	return RegisterNamespaceNetworkDomainWithGatewayAPI(reg, factory, nil, perms)
}

func RegisterNamespaceNetworkDomainWithGatewayAPI(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
	gatewayFactory gatewayinformers.SharedInformerFactory,
	perms NamespaceNetworkPermissions,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &NamespaceNetworkBuilder{}
	if perms.IncludeServices {
		builder.serviceLister = factory.Core().V1().Services().Lister()
	}
	if perms.IncludeEndpointSlices {
		builder.endpointSliceLister = factory.Discovery().V1().EndpointSlices().Lister()
	}
	if perms.IncludeIngresses {
		builder.ingressLister = factory.Networking().V1().Ingresses().Lister()
	}
	if perms.IncludeNetworkPolicies {
		builder.policyLister = factory.Networking().V1().NetworkPolicies().Lister()
	}
	if gatewayFactory != nil {
		gateway := gatewayFactory.Gateway().V1()
		if perms.IncludeGateways {
			builder.gatewayLister = gateway.Gateways().Lister()
		}
		if perms.IncludeHTTPRoutes {
			builder.httpRouteLister = gateway.HTTPRoutes().Lister()
		}
		if perms.IncludeGRPCRoutes {
			builder.grpcRouteLister = gateway.GRPCRoutes().Lister()
		}
		if perms.IncludeTLSRoutes {
			builder.tlsRouteLister = gateway.TLSRoutes().Lister()
		}
		if perms.IncludeListenerSets {
			builder.listenerSetLister = gateway.ListenerSets().Lister()
		}
		if perms.IncludeReferenceGrants {
			builder.referenceGrantLister = gateway.ReferenceGrants().Lister()
		}
		if perms.IncludeBackendTLSPolicies {
			builder.backendTLSPolicyLister = gateway.BackendTLSPolicies().Lister()
		}
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceNetworkDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build gathers services, endpoint slices, ingresses, and policies for the namespace.
func (b *NamespaceNetworkBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := ClusterMetaFromContext(ctx)
	clusterID, trimmed := refresh.SplitClusterScope(scope)
	trimmed = strings.TrimSpace(trimmed)
	if trimmed == "" {
		return nil, errors.New(errNamespaceNetworkScopeRequired)
	}

	isAll := isAllNamespaceScope(trimmed)
	var namespace string
	var err error
	scopeLabel := refresh.JoinClusterScope(clusterID, trimmed)
	if isAll {
		scopeLabel = refresh.JoinClusterScope(clusterID, "namespace:all")
	} else {
		namespace, err = parseAutoscalingNamespace(trimmed)
		if err != nil {
			return nil, errors.New(errNamespaceNetworkScopeRequired)
		}
	}

	var services []*corev1.Service
	if b.serviceLister != nil {
		services, err = b.listServices(namespace)
		if err != nil {
			return nil, fmt.Errorf("namespace network: failed to list services: %w", err)
		}
	}
	var slices []*discoveryv1.EndpointSlice
	if b.endpointSliceLister != nil {
		slices, err = b.listEndpointSlices(namespace)
		if err != nil {
			return nil, fmt.Errorf("namespace network: failed to list endpoint slices: %w", err)
		}
	}
	var ingresses []*networkingv1.Ingress
	if b.ingressLister != nil {
		ingresses, err = b.listIngresses(namespace)
		if err != nil {
			return nil, fmt.Errorf("namespace network: failed to list ingresses: %w", err)
		}
	}
	var policies []*networkingv1.NetworkPolicy
	if b.policyLister != nil {
		policies, err = b.listNetworkPolicies(namespace)
		if err != nil {
			return nil, fmt.Errorf("namespace network: failed to list network policies: %w", err)
		}
	}
	gatewayItems, err := b.listGatewayAPIResources(namespace)
	if err != nil {
		return nil, err
	}

	slicesByService := groupEndpointSlicesByService(slices)

	return b.buildSnapshot(meta, scopeLabel, services, slices, slicesByService, ingresses, policies, gatewayItems)
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

func (b *NamespaceNetworkBuilder) listIngresses(namespace string) ([]*networkingv1.Ingress, error) {
	if namespace == "" {
		return b.ingressLister.List(labels.Everything())
	}
	return b.ingressLister.Ingresses(namespace).List(labels.Everything())
}

func (b *NamespaceNetworkBuilder) listNetworkPolicies(namespace string) ([]*networkingv1.NetworkPolicy, error) {
	if namespace == "" {
		return b.policyLister.List(labels.Everything())
	}
	return b.policyLister.NetworkPolicies(namespace).List(labels.Everything())
}

type gatewayAPIResources struct {
	gateways           []*gatewayv1.Gateway
	httpRoutes         []*gatewayv1.HTTPRoute
	grpcRoutes         []*gatewayv1.GRPCRoute
	tlsRoutes          []*gatewayv1.TLSRoute
	listenerSets       []*gatewayv1.ListenerSet
	referenceGrants    []*gatewayv1.ReferenceGrant
	backendTLSPolicies []*gatewayv1.BackendTLSPolicy
}

func (b *NamespaceNetworkBuilder) listGatewayAPIResources(namespace string) (gatewayAPIResources, error) {
	var out gatewayAPIResources
	var err error
	if b.gatewayLister != nil {
		if namespace == "" {
			out.gateways, err = b.gatewayLister.List(labels.Everything())
		} else {
			out.gateways, err = b.gatewayLister.Gateways(namespace).List(labels.Everything())
		}
		if err != nil {
			return out, fmt.Errorf("namespace network: failed to list gateways: %w", err)
		}
	}
	if b.httpRouteLister != nil {
		if namespace == "" {
			out.httpRoutes, err = b.httpRouteLister.List(labels.Everything())
		} else {
			out.httpRoutes, err = b.httpRouteLister.HTTPRoutes(namespace).List(labels.Everything())
		}
		if err != nil {
			return out, fmt.Errorf("namespace network: failed to list http routes: %w", err)
		}
	}
	if b.grpcRouteLister != nil {
		if namespace == "" {
			out.grpcRoutes, err = b.grpcRouteLister.List(labels.Everything())
		} else {
			out.grpcRoutes, err = b.grpcRouteLister.GRPCRoutes(namespace).List(labels.Everything())
		}
		if err != nil {
			return out, fmt.Errorf("namespace network: failed to list grpc routes: %w", err)
		}
	}
	if b.tlsRouteLister != nil {
		if namespace == "" {
			out.tlsRoutes, err = b.tlsRouteLister.List(labels.Everything())
		} else {
			out.tlsRoutes, err = b.tlsRouteLister.TLSRoutes(namespace).List(labels.Everything())
		}
		if err != nil {
			return out, fmt.Errorf("namespace network: failed to list tls routes: %w", err)
		}
	}
	if b.listenerSetLister != nil {
		if namespace == "" {
			out.listenerSets, err = b.listenerSetLister.List(labels.Everything())
		} else {
			out.listenerSets, err = b.listenerSetLister.ListenerSets(namespace).List(labels.Everything())
		}
		if err != nil {
			return out, fmt.Errorf("namespace network: failed to list listener sets: %w", err)
		}
	}
	if b.referenceGrantLister != nil {
		if namespace == "" {
			out.referenceGrants, err = b.referenceGrantLister.List(labels.Everything())
		} else {
			out.referenceGrants, err = b.referenceGrantLister.ReferenceGrants(namespace).List(labels.Everything())
		}
		if err != nil {
			return out, fmt.Errorf("namespace network: failed to list reference grants: %w", err)
		}
	}
	if b.backendTLSPolicyLister != nil {
		if namespace == "" {
			out.backendTLSPolicies, err = b.backendTLSPolicyLister.List(labels.Everything())
		} else {
			out.backendTLSPolicies, err = b.backendTLSPolicyLister.BackendTLSPolicies(namespace).List(labels.Everything())
		}
		if err != nil {
			return out, fmt.Errorf("namespace network: failed to list backend tls policies: %w", err)
		}
	}
	return out, nil
}

func (b *NamespaceNetworkBuilder) buildSnapshot(
	meta ClusterMeta,
	scope string,
	services []*corev1.Service,
	slices []*discoveryv1.EndpointSlice,
	slicesByService map[string][]*discoveryv1.EndpointSlice,
	ingresses []*networkingv1.Ingress,
	policies []*networkingv1.NetworkPolicy,
	gatewayItems gatewayAPIResources,
) (*refresh.Snapshot, error) {
	resources := make([]NetworkSummary, 0, len(services)+len(slicesByService)+len(ingresses)+len(policies)+len(gatewayItems.gateways)+len(gatewayItems.httpRoutes)+len(gatewayItems.grpcRoutes)+len(gatewayItems.tlsRoutes)+len(gatewayItems.listenerSets)+len(gatewayItems.referenceGrants)+len(gatewayItems.backendTLSPolicies))
	var version uint64

	// Delegate to the shared row builders so the full-snapshot path and
	// the streaming/incremental update path emit identical row shapes.
	// See Build*NetworkSummary / BuildEndpointSliceSummary in
	// streaming_helpers.go.
	for _, svc := range services {
		if svc == nil {
			continue
		}
		resources = append(resources, BuildServiceNetworkSummary(meta, svc, slicesByService[svc.Name]))
		if v := resourceVersionOrTimestamp(svc); v > version {
			version = v
		}
	}

	for _, ing := range ingresses {
		if ing == nil {
			continue
		}
		resources = append(resources, BuildIngressNetworkSummary(meta, ing))
		if v := resourceVersionOrTimestamp(ing); v > version {
			version = v
		}
	}

	for _, policy := range policies {
		if policy == nil {
			continue
		}
		resources = append(resources, BuildNetworkPolicySummary(meta, policy))
		if v := resourceVersionOrTimestamp(policy); v > version {
			version = v
		}
	}

	for _, gateway := range gatewayItems.gateways {
		resources = append(resources, BuildGatewayNetworkSummary(meta, gateway))
		if v := resourceVersionOrTimestamp(gateway); v > version {
			version = v
		}
	}
	for _, route := range gatewayItems.httpRoutes {
		resources = append(resources, BuildHTTPRouteNetworkSummary(meta, route))
		if v := resourceVersionOrTimestamp(route); v > version {
			version = v
		}
	}
	for _, route := range gatewayItems.grpcRoutes {
		resources = append(resources, BuildGRPCRouteNetworkSummary(meta, route))
		if v := resourceVersionOrTimestamp(route); v > version {
			version = v
		}
	}
	for _, route := range gatewayItems.tlsRoutes {
		resources = append(resources, BuildTLSRouteNetworkSummary(meta, route))
		if v := resourceVersionOrTimestamp(route); v > version {
			version = v
		}
	}
	for _, listenerSet := range gatewayItems.listenerSets {
		resources = append(resources, BuildListenerSetNetworkSummary(meta, listenerSet))
		if v := resourceVersionOrTimestamp(listenerSet); v > version {
			version = v
		}
	}
	for _, referenceGrant := range gatewayItems.referenceGrants {
		resources = append(resources, BuildReferenceGrantNetworkSummary(meta, referenceGrant))
		if v := resourceVersionOrTimestamp(referenceGrant); v > version {
			version = v
		}
	}
	for _, policy := range gatewayItems.backendTLSPolicies {
		resources = append(resources, BuildBackendTLSPolicyNetworkSummary(meta, policy))
		if v := resourceVersionOrTimestamp(policy); v > version {
			version = v
		}
	}

	for _, slice := range slices {
		if slice == nil {
			continue
		}
		resources = append(resources, BuildEndpointSliceSummary(meta, slice))
		if v := resourceVersionOrTimestamp(slice); v > version {
			version = v
		}
	}

	sortNetworkSummaries(resources)

	if len(resources) > config.SnapshotNamespaceNetworkEntryLimit {
		resources = resources[:config.SnapshotNamespaceNetworkEntryLimit]
	}

	return &refresh.Snapshot{
		Domain:  namespaceNetworkDomainName,
		Scope:   scope,
		Version: version,
		Payload: NamespaceNetworkSnapshot{
			ClusterMeta: meta,
			Resources:   resources,
			Kinds:       snapshotSortedKinds(resources, func(resource NetworkSummary) string { return resource.Kind }),
		},
		Stats: refresh.SnapshotStats{ItemCount: len(resources)},
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

func describeService(svc *corev1.Service, slices []*discoveryv1.EndpointSlice) string {
	if svc == nil {
		return ""
	}
	parts := []string{fmt.Sprintf("Type: %s", svc.Spec.Type)}
	clusterIP := svc.Spec.ClusterIP
	if clusterIP == "" {
		clusterIP = "None"
	}
	parts = append(parts, fmt.Sprintf("ClusterIP: %s", clusterIP))
	if len(svc.Spec.Ports) > 0 {
		portStrings := make([]string, 0, len(svc.Spec.Ports))
		for _, port := range svc.Spec.Ports {
			portStrings = append(portStrings, fmt.Sprintf("%d/%s", port.Port, port.Protocol))
		}
		parts = append(parts, fmt.Sprintf("Ports: %s", strings.Join(portStrings, ",")))
	}
	if ready, _ := countAddressesFromSlices(slices); ready > 0 {
		parts = append(parts, fmt.Sprintf("Addresses: %d", ready))
	}
	return strings.Join(parts, ", ")
}

func describeIngress(ing *networkingv1.Ingress) string {
	if ing == nil {
		return ""
	}
	parts := []string{}
	if ing.Spec.IngressClassName != nil && *ing.Spec.IngressClassName != "" {
		parts = append(parts, fmt.Sprintf("Class: %s", *ing.Spec.IngressClassName))
	}
	if len(ing.Spec.Rules) > 0 {
		hosts := make([]string, 0, len(ing.Spec.Rules))
		for _, rule := range ing.Spec.Rules {
			if rule.Host != "" {
				hosts = append(hosts, rule.Host)
			}
		}
		if len(hosts) > 0 {
			parts = append(parts, fmt.Sprintf("Hosts: %s", strings.Join(hosts, ",")))
		}
		parts = append(parts, fmt.Sprintf("Rules: %d", len(ing.Spec.Rules)))
	}
	if len(parts) == 0 {
		return "No rules defined"
	}
	return strings.Join(parts, ", ")
}

func describeNetworkPolicy(policy *networkingv1.NetworkPolicy) string {
	if policy == nil {
		return ""
	}
	if len(policy.Spec.PolicyTypes) == 0 {
		return "Policy types: Ingress"
	}
	types := make([]string, 0, len(policy.Spec.PolicyTypes))
	for _, t := range policy.Spec.PolicyTypes {
		types = append(types, string(t))
	}
	return fmt.Sprintf("Policy types: %s", strings.Join(types, ","))
}

func describeEndpointSlices(slices []*discoveryv1.EndpointSlice) string {
	if len(slices) == 0 {
		return "No endpoint slices"
	}
	parts := []string{fmt.Sprintf("Slices: %d", len(slices))}
	ready, notReady := countAddressesFromSlices(slices)
	if ready > 0 {
		parts = append(parts, fmt.Sprintf("Ready addresses: %d", ready))
	}
	if notReady > 0 {
		parts = append(parts, fmt.Sprintf("Not Ready: %d", notReady))
	}
	return strings.Join(parts, ", ")
}

func countAddressesFromSlices(slices []*discoveryv1.EndpointSlice) (ready, notReady int) {
	for _, slice := range slices {
		if slice == nil {
			continue
		}
		for _, ep := range slice.Endpoints {
			if len(ep.Addresses) == 0 {
				continue
			}
			if endpointReady(ep) {
				ready += len(ep.Addresses)
			} else {
				notReady += len(ep.Addresses)
			}
		}
	}
	return ready, notReady
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
		result[service] = append(result[service], slice)
	}
	return result
}

func endpointReady(endpoint discoveryv1.Endpoint) bool {
	if endpoint.Conditions.Ready != nil && !*endpoint.Conditions.Ready {
		return false
	}
	if endpoint.Conditions.Serving != nil && !*endpoint.Conditions.Serving {
		return false
	}
	if endpoint.Conditions.Terminating != nil && *endpoint.Conditions.Terminating {
		return false
	}
	return true
}
