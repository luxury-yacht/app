package objectcatalog

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"github.com/luxury-yacht/app/backend/resources/common"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

type resourceIdentityKey struct {
	group   string
	version string
	kind    string
}

type resourceIdentityResolver struct {
	mu        sync.RWMutex
	deps      common.Dependencies
	logger    Logger
	resources map[resourceIdentityKey]resourceDescriptor
}

var builtinResourceCatalog = []resourceDescriptor{
	builtinDescriptor("", "v1", "Pod", "pods", true),
	builtinDescriptor("", "v1", "Service", "services", true),
	builtinDescriptor("", "v1", "ConfigMap", "configmaps", true),
	builtinDescriptor("", "v1", "Secret", "secrets", true),
	builtinDescriptor("", "v1", "ServiceAccount", "serviceaccounts", true),
	builtinDescriptor("", "v1", "Event", "events", true),
	builtinDescriptor("", "v1", "LimitRange", "limitranges", true),
	builtinDescriptor("", "v1", "ResourceQuota", "resourcequotas", true),
	builtinDescriptor("", "v1", "Endpoints", "endpoints", true),
	builtinDescriptor("", "v1", "PersistentVolumeClaim", "persistentvolumeclaims", true),
	builtinDescriptor("", "v1", "Namespace", "namespaces", false),
	builtinDescriptor("", "v1", "Node", "nodes", false),
	builtinDescriptor("", "v1", "PersistentVolume", "persistentvolumes", false),

	builtinDescriptor("apps", "v1", "Deployment", "deployments", true),
	builtinDescriptor("apps", "v1", "StatefulSet", "statefulsets", true),
	builtinDescriptor("apps", "v1", "DaemonSet", "daemonsets", true),
	builtinDescriptor("apps", "v1", "ReplicaSet", "replicasets", true),

	builtinDescriptor("batch", "v1", "Job", "jobs", true),
	builtinDescriptor("batch", "v1", "CronJob", "cronjobs", true),

	builtinDescriptor("autoscaling", "v1", "HorizontalPodAutoscaler", "horizontalpodautoscalers", true),
	builtinDescriptor("autoscaling", "v2", "HorizontalPodAutoscaler", "horizontalpodautoscalers", true),

	builtinDescriptor("networking.k8s.io", "v1", "Ingress", "ingresses", true),
	builtinDescriptor("networking.k8s.io", "v1", "NetworkPolicy", "networkpolicies", true),
	builtinDescriptor("networking.k8s.io", "v1", "IngressClass", "ingressclasses", false),

	builtinDescriptor("discovery.k8s.io", "v1", "EndpointSlice", "endpointslices", true),

	builtinDescriptor("gateway.networking.k8s.io", "v1", "Gateway", "gateways", true),
	builtinDescriptor("gateway.networking.k8s.io", "v1", "HTTPRoute", "httproutes", true),
	builtinDescriptor("gateway.networking.k8s.io", "v1", "GRPCRoute", "grpcroutes", true),
	builtinDescriptor("gateway.networking.k8s.io", "v1", "TLSRoute", "tlsroutes", true),
	builtinDescriptor("gateway.networking.k8s.io", "v1", "ListenerSet", "listenersets", true),
	builtinDescriptor("gateway.networking.k8s.io", "v1", "BackendTLSPolicy", "backendtlspolicies", true),
	builtinDescriptor("gateway.networking.k8s.io", "v1", "ReferenceGrant", "referencegrants", true),
	builtinDescriptor("gateway.networking.k8s.io", "v1", "GatewayClass", "gatewayclasses", false),

	builtinDescriptor("rbac.authorization.k8s.io", "v1", "Role", "roles", true),
	builtinDescriptor("rbac.authorization.k8s.io", "v1", "RoleBinding", "rolebindings", true),
	builtinDescriptor("rbac.authorization.k8s.io", "v1", "ClusterRole", "clusterroles", false),
	builtinDescriptor("rbac.authorization.k8s.io", "v1", "ClusterRoleBinding", "clusterrolebindings", false),

	builtinDescriptor("policy", "v1", "PodDisruptionBudget", "poddisruptionbudgets", true),

	builtinDescriptor("storage.k8s.io", "v1", "StorageClass", "storageclasses", false),
	builtinDescriptor("storage.k8s.io", "v1", "CSIDriver", "csidrivers", false),
	builtinDescriptor("storage.k8s.io", "v1", "CSINode", "csinodes", false),
	builtinDescriptor("storage.k8s.io", "v1", "VolumeAttachment", "volumeattachments", false),

	builtinDescriptor("admissionregistration.k8s.io", "v1", "MutatingWebhookConfiguration", "mutatingwebhookconfigurations", false),
	builtinDescriptor("admissionregistration.k8s.io", "v1", "ValidatingWebhookConfiguration", "validatingwebhookconfigurations", false),

	builtinDescriptor("coordination.k8s.io", "v1", "Lease", "leases", true),

	builtinDescriptor("apiextensions.k8s.io", "v1", "CustomResourceDefinition", "customresourcedefinitions", false),
}

func builtinDescriptor(group, version, kind, resource string, namespaced bool) resourceDescriptor {
	scope := ScopeCluster
	if namespaced {
		scope = ScopeNamespace
	}
	return resourceDescriptor{
		GVR: schema.GroupVersionResource{
			Group:    group,
			Version:  version,
			Resource: resource,
		},
		Namespaced: namespaced,
		Kind:       kind,
		Group:      group,
		Version:    version,
		Resource:   resource,
		Scope:      scope,
	}
}

// NewResourceResolver exposes the object-catalog resource identity contract to
// callers that need GVK -> GVR resolution before a long-running catalog service
// is available.
func NewResourceResolver(deps common.Dependencies, logger Logger) common.ResourceResolver {
	return newResourceIdentityResolver(deps, logger)
}

func newResourceIdentityResolver(deps common.Dependencies, logger Logger) *resourceIdentityResolver {
	deps.ResourceResolver = nil
	resolver := &resourceIdentityResolver{
		deps:      deps,
		logger:    logger,
		resources: make(map[resourceIdentityKey]resourceDescriptor, len(builtinResourceCatalog)),
	}
	resolver.seedBuiltins()
	return resolver
}

func (r *resourceIdentityResolver) seedBuiltins() {
	for _, desc := range builtinResourceCatalog {
		r.resources[identityKey(desc.Group, desc.Version, desc.Kind)] = desc
	}
}

func (r *resourceIdentityResolver) replaceDiscovered(descriptors []resourceDescriptor) {
	next := make(map[resourceIdentityKey]resourceDescriptor, len(builtinResourceCatalog)+len(descriptors))
	for _, desc := range builtinResourceCatalog {
		next[identityKey(desc.Group, desc.Version, desc.Kind)] = desc
	}
	for _, desc := range descriptors {
		next[identityKey(desc.Group, desc.Version, desc.Kind)] = desc
	}
	r.mu.Lock()
	r.resources = next
	r.mu.Unlock()
}

func (r *resourceIdentityResolver) ResolveResourceForGVK(ctx context.Context, gvk schema.GroupVersionKind) (common.ResolvedResource, bool, error) {
	if r == nil {
		return common.ResolvedResource{}, false, nil
	}
	key := identityKey(gvk.Group, gvk.Version, gvk.Kind)
	if key.version == "" || key.kind == "" {
		return common.ResolvedResource{}, false, nil
	}
	if resolved, ok := r.lookup(key); ok {
		return resolved, true, nil
	}
	if err := r.hydrate(ctx, gvk); err != nil {
		return common.ResolvedResource{}, false, err
	}
	resolved, ok := r.lookup(key)
	return resolved, ok, nil
}

func (r *resourceIdentityResolver) lookup(key resourceIdentityKey) (common.ResolvedResource, bool) {
	r.mu.RLock()
	desc, ok := r.resources[key]
	r.mu.RUnlock()
	if !ok {
		return common.ResolvedResource{}, false
	}
	return resolvedResourceFromDescriptor(desc), true
}

func (r *resourceIdentityResolver) hydrate(ctx context.Context, gvk schema.GroupVersionKind) error {
	if ctx == nil {
		ctx = r.deps.Context
		if ctx == nil {
			ctx = context.Background()
		}
	}

	var discoveryErr error
	if r.deps.KubernetesClient != nil {
		descriptors, err := discoverResourceDescriptors(ctx, r.deps, r.logger)
		if err != nil {
			discoveryErr = err
		} else {
			r.mergeDiscovered(descriptors)
			if hasDescriptorForGVK(descriptors, gvk) {
				return nil
			}
		}
	}

	crdDescriptor, ok, err := r.resolveCRD(ctx, gvk)
	if err != nil {
		return err
	}
	if ok {
		r.mergeDiscovered([]resourceDescriptor{crdDescriptor})
		return nil
	}
	if discoveryErr != nil {
		return discoveryErr
	}
	return nil
}

func (r *resourceIdentityResolver) mergeDiscovered(descriptors []resourceDescriptor) {
	if len(descriptors) == 0 {
		return
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, desc := range descriptors {
		r.resources[identityKey(desc.Group, desc.Version, desc.Kind)] = desc
	}
}

func (r *resourceIdentityResolver) resolveCRD(ctx context.Context, gvk schema.GroupVersionKind) (resourceDescriptor, bool, error) {
	if r.deps.APIExtensionsClient == nil {
		return resourceDescriptor{}, false, nil
	}
	crds, err := r.deps.APIExtensionsClient.ApiextensionsV1().CustomResourceDefinitions().List(ctx, metav1.ListOptions{})
	if err != nil {
		if r.logger != nil {
			r.logger.Debug(fmt.Sprintf("catalog resource identity CRD fallback failed: %v", err), componentName)
		}
		return resourceDescriptor{}, false, err
	}
	for _, crd := range crds.Items {
		if crd.Spec.Group != strings.TrimSpace(gvk.Group) {
			continue
		}
		if !strings.EqualFold(crd.Spec.Names.Kind, strings.TrimSpace(gvk.Kind)) {
			continue
		}
		for idx := range crd.Spec.Versions {
			version := crd.Spec.Versions[idx]
			if version.Name != strings.TrimSpace(gvk.Version) {
				continue
			}
			namespaced := crd.Spec.Scope == apiextensionsv1.NamespaceScoped
			return builtinDescriptor(crd.Spec.Group, version.Name, crd.Spec.Names.Kind, crd.Spec.Names.Plural, namespaced), true, nil
		}
	}
	return resourceDescriptor{}, false, nil
}

func hasDescriptorForGVK(descriptors []resourceDescriptor, gvk schema.GroupVersionKind) bool {
	key := identityKey(gvk.Group, gvk.Version, gvk.Kind)
	for _, desc := range descriptors {
		if identityKey(desc.Group, desc.Version, desc.Kind) == key {
			return true
		}
	}
	return false
}

func resolvedResourceFromDescriptor(desc resourceDescriptor) common.ResolvedResource {
	return common.ResolvedResource{
		Group:      desc.Group,
		Version:    desc.Version,
		Kind:       desc.Kind,
		Resource:   desc.Resource,
		Namespaced: desc.Namespaced,
	}
}

func identityKey(group, version, kind string) resourceIdentityKey {
	return resourceIdentityKey{
		group:   strings.TrimSpace(group),
		version: strings.TrimSpace(version),
		kind:    strings.ToLower(strings.TrimSpace(kind)),
	}
}
