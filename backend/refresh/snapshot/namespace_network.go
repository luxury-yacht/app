package snapshot

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	"k8s.io/apimachinery/pkg/labels"
	informers "k8s.io/client-go/informers"
	corelisters "k8s.io/client-go/listers/core/v1"
	discoverylisters "k8s.io/client-go/listers/discovery/v1"
	networklisters "k8s.io/client-go/listers/networking/v1"

	"github.com/luxury-yacht/app/backend/refresh"
	"github.com/luxury-yacht/app/backend/refresh/domain"
)

const (
	namespaceNetworkDomainName       = "namespace-network"
	namespaceNetworkEntryLimit       = 1000
	errNamespaceNetworkScopeRequired = "namespace scope is required"
)

// NamespaceNetworkBuilder constructs summaries for namespace-scoped network resources.
type NamespaceNetworkBuilder struct {
	serviceLister       corelisters.ServiceLister
	endpointSliceLister discoverylisters.EndpointSliceLister
	ingressLister       networklisters.IngressLister
	policyLister        networklisters.NetworkPolicyLister
}

// NamespaceNetworkSnapshot payload for the network tab.
type NamespaceNetworkSnapshot struct {
	ClusterMeta
	Resources []NetworkSummary `json:"resources"`
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
func RegisterNamespaceNetworkDomain(
	reg *domain.Registry,
	factory informers.SharedInformerFactory,
) error {
	if factory == nil {
		return fmt.Errorf("shared informer factory is nil")
	}
	builder := &NamespaceNetworkBuilder{
		serviceLister:       factory.Core().V1().Services().Lister(),
		endpointSliceLister: factory.Discovery().V1().EndpointSlices().Lister(),
		ingressLister:       factory.Networking().V1().Ingresses().Lister(),
		policyLister:        factory.Networking().V1().NetworkPolicies().Lister(),
	}
	return reg.Register(refresh.DomainConfig{
		Name:          namespaceNetworkDomainName,
		BuildSnapshot: builder.Build,
	})
}

// Build gathers services, endpoint slices, ingresses, and policies for the namespace.
func (b *NamespaceNetworkBuilder) Build(ctx context.Context, scope string) (*refresh.Snapshot, error) {
	meta := CurrentClusterMeta()
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

	services, err := b.listServices(namespace)
	if err != nil {
		return nil, fmt.Errorf("namespace network: failed to list services: %w", err)
	}
	slices, err := b.listEndpointSlices(namespace)
	if err != nil {
		return nil, fmt.Errorf("namespace network: failed to list endpoint slices: %w", err)
	}
	ingresses, err := b.listIngresses(namespace)
	if err != nil {
		return nil, fmt.Errorf("namespace network: failed to list ingresses: %w", err)
	}
	policies, err := b.listNetworkPolicies(namespace)
	if err != nil {
		return nil, fmt.Errorf("namespace network: failed to list network policies: %w", err)
	}

	slicesByService := groupEndpointSlicesByService(slices)

	return b.buildSnapshot(meta, scopeLabel, services, slicesByService, ingresses, policies)
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

func (b *NamespaceNetworkBuilder) buildSnapshot(
	meta ClusterMeta,
	scope string,
	services []*corev1.Service,
	slicesByService map[string][]*discoveryv1.EndpointSlice,
	ingresses []*networkingv1.Ingress,
	policies []*networkingv1.NetworkPolicy,
) (*refresh.Snapshot, error) {
	resources := make([]NetworkSummary, 0, len(services)+len(slicesByService)+len(ingresses)+len(policies))
	var version uint64

	for _, svc := range services {
		if svc == nil {
			continue
		}
		summary := NetworkSummary{
			ClusterMeta: meta,
			Kind:      "Service",
			Name:      svc.Name,
			Namespace: svc.Namespace,
			Details:   describeService(svc, slicesByService[svc.Name]),
			Age:       formatAge(svc.CreationTimestamp.Time),
		}
		resources = append(resources, summary)
		if v := resourceVersionOrTimestamp(svc); v > version {
			version = v
		}
	}

	for _, ing := range ingresses {
		if ing == nil {
			continue
		}
		summary := NetworkSummary{
			ClusterMeta: meta,
			Kind:      "Ingress",
			Name:      ing.Name,
			Namespace: ing.Namespace,
			Details:   describeIngress(ing),
			Age:       formatAge(ing.CreationTimestamp.Time),
		}
		resources = append(resources, summary)
		if v := resourceVersionOrTimestamp(ing); v > version {
			version = v
		}
	}

	for _, policy := range policies {
		if policy == nil {
			continue
		}
		summary := NetworkSummary{
			ClusterMeta: meta,
			Kind:      "NetworkPolicy",
			Name:      policy.Name,
			Namespace: policy.Namespace,
			Details:   describeNetworkPolicy(policy),
			Age:       formatAge(policy.CreationTimestamp.Time),
		}
		resources = append(resources, summary)
		if v := resourceVersionOrTimestamp(policy); v > version {
			version = v
		}
	}

	for svc, svcSlices := range slicesByService {
		if len(svcSlices) == 0 {
			continue
		}
		namespace := svcSlices[0].Namespace
		summary := NetworkSummary{
			ClusterMeta: meta,
			Kind:      "EndpointSlice",
			Name:      svc,
			Namespace: namespace,
			Details:   describeEndpointSlices(svcSlices),
			Age:       formatAge(earliestSliceCreation(svcSlices)),
		}
		resources = append(resources, summary)
		for _, slice := range svcSlices {
			if slice == nil {
				continue
			}
			if v := resourceVersionOrTimestamp(slice); v > version {
				version = v
			}
		}
	}

	sortNetworkSummaries(resources)

	if len(resources) > namespaceNetworkEntryLimit {
		resources = resources[:namespaceNetworkEntryLimit]
	}

	return &refresh.Snapshot{
		Domain:  namespaceNetworkDomainName,
		Scope:   scope,
		Version: version,
		Payload: NamespaceNetworkSnapshot{ClusterMeta: meta, Resources: resources},
		Stats:   refresh.SnapshotStats{ItemCount: len(resources)},
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
	if ready := countReadyAddressesFromSlices(slices); ready > 0 {
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
	ready := countReadyAddressesFromSlices(slices)
	if ready > 0 {
		parts = append(parts, fmt.Sprintf("Ready addresses: %d", ready))
	}
	if notReady := countNotReadyAddressesFromSlices(slices); notReady > 0 {
		parts = append(parts, fmt.Sprintf("Not Ready: %d", notReady))
	}
	return strings.Join(parts, ", ")
}

func countReadyAddressesFromSlices(slices []*discoveryv1.EndpointSlice) int {
	count := 0
	for _, slice := range slices {
		if slice == nil {
			continue
		}
		for _, ep := range slice.Endpoints {
			if len(ep.Addresses) == 0 || !endpointReady(ep) {
				continue
			}
			count += len(ep.Addresses)
		}
	}
	return count
}

func countNotReadyAddressesFromSlices(slices []*discoveryv1.EndpointSlice) int {
	count := 0
	for _, slice := range slices {
		if slice == nil {
			continue
		}
		for _, ep := range slice.Endpoints {
			if len(ep.Addresses) == 0 || endpointReady(ep) {
				continue
			}
			count += len(ep.Addresses)
		}
	}
	return count
}

func earliestSliceCreation(slices []*discoveryv1.EndpointSlice) time.Time {
	var earliest time.Time
	for _, slice := range slices {
		if slice == nil {
			continue
		}
		if earliest.IsZero() || slice.CreationTimestamp.Time.Before(earliest) {
			earliest = slice.CreationTimestamp.Time
		}
	}
	return earliest
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
