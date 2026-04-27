package backend

import (
	"strings"

	"k8s.io/apimachinery/pkg/runtime/schema"
)

type builtinResourceInfo struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}

func (r builtinResourceInfo) GVR() schema.GroupVersionResource {
	return schema.GroupVersionResource{
		Group:    r.Group,
		Version:  r.Version,
		Resource: r.Resource,
	}
}

func (r builtinResourceInfo) GR() schema.GroupResource {
	return schema.GroupResource{
		Group:    r.Group,
		Resource: r.Resource,
	}
}

type builtinResourceKey struct {
	group   string
	version string
	kind    string
}

var builtinResourceCatalog = []builtinResourceInfo{
	// core/v1
	{Group: "", Version: "v1", Kind: "Pod", Resource: "pods", Namespaced: true},
	{Group: "", Version: "v1", Kind: "Service", Resource: "services", Namespaced: true},
	{Group: "", Version: "v1", Kind: "ConfigMap", Resource: "configmaps", Namespaced: true},
	{Group: "", Version: "v1", Kind: "Secret", Resource: "secrets", Namespaced: true},
	{Group: "", Version: "v1", Kind: "ServiceAccount", Resource: "serviceaccounts", Namespaced: true},
	{Group: "", Version: "v1", Kind: "Event", Resource: "events", Namespaced: true},
	{Group: "", Version: "v1", Kind: "LimitRange", Resource: "limitranges", Namespaced: true},
	{Group: "", Version: "v1", Kind: "ResourceQuota", Resource: "resourcequotas", Namespaced: true},
	{Group: "", Version: "v1", Kind: "PersistentVolumeClaim", Resource: "persistentvolumeclaims", Namespaced: true},
	{Group: "", Version: "v1", Kind: "Namespace", Resource: "namespaces", Namespaced: false},
	{Group: "", Version: "v1", Kind: "Node", Resource: "nodes", Namespaced: false},
	{Group: "", Version: "v1", Kind: "PersistentVolume", Resource: "persistentvolumes", Namespaced: false},

	// apps/v1
	{Group: "apps", Version: "v1", Kind: "Deployment", Resource: "deployments", Namespaced: true},
	{Group: "apps", Version: "v1", Kind: "StatefulSet", Resource: "statefulsets", Namespaced: true},
	{Group: "apps", Version: "v1", Kind: "DaemonSet", Resource: "daemonsets", Namespaced: true},
	{Group: "apps", Version: "v1", Kind: "ReplicaSet", Resource: "replicasets", Namespaced: true},

	// batch/v1
	{Group: "batch", Version: "v1", Kind: "Job", Resource: "jobs", Namespaced: true},
	{Group: "batch", Version: "v1", Kind: "CronJob", Resource: "cronjobs", Namespaced: true},

	// autoscaling/v2
	{Group: "autoscaling", Version: "v2", Kind: "HorizontalPodAutoscaler", Resource: "horizontalpodautoscalers", Namespaced: true},

	// networking.k8s.io/v1
	{Group: "networking.k8s.io", Version: "v1", Kind: "Ingress", Resource: "ingresses", Namespaced: true},
	{Group: "networking.k8s.io", Version: "v1", Kind: "NetworkPolicy", Resource: "networkpolicies", Namespaced: true},
	{Group: "networking.k8s.io", Version: "v1", Kind: "IngressClass", Resource: "ingressclasses", Namespaced: false},

	// discovery.k8s.io/v1
	{Group: "discovery.k8s.io", Version: "v1", Kind: "EndpointSlice", Resource: "endpointslices", Namespaced: true},

	// gateway.networking.k8s.io/v1
	{Group: "gateway.networking.k8s.io", Version: "v1", Kind: "Gateway", Resource: "gateways", Namespaced: true},
	{Group: "gateway.networking.k8s.io", Version: "v1", Kind: "HTTPRoute", Resource: "httproutes", Namespaced: true},
	{Group: "gateway.networking.k8s.io", Version: "v1", Kind: "GRPCRoute", Resource: "grpcroutes", Namespaced: true},
	{Group: "gateway.networking.k8s.io", Version: "v1", Kind: "TLSRoute", Resource: "tlsroutes", Namespaced: true},
	{Group: "gateway.networking.k8s.io", Version: "v1", Kind: "ListenerSet", Resource: "listenersets", Namespaced: true},
	{Group: "gateway.networking.k8s.io", Version: "v1", Kind: "BackendTLSPolicy", Resource: "backendtlspolicies", Namespaced: true},
	{Group: "gateway.networking.k8s.io", Version: "v1", Kind: "ReferenceGrant", Resource: "referencegrants", Namespaced: true},
	{Group: "gateway.networking.k8s.io", Version: "v1", Kind: "GatewayClass", Resource: "gatewayclasses", Namespaced: false},

	// rbac.authorization.k8s.io/v1
	{Group: "rbac.authorization.k8s.io", Version: "v1", Kind: "Role", Resource: "roles", Namespaced: true},
	{Group: "rbac.authorization.k8s.io", Version: "v1", Kind: "RoleBinding", Resource: "rolebindings", Namespaced: true},
	{Group: "rbac.authorization.k8s.io", Version: "v1", Kind: "ClusterRole", Resource: "clusterroles", Namespaced: false},
	{Group: "rbac.authorization.k8s.io", Version: "v1", Kind: "ClusterRoleBinding", Resource: "clusterrolebindings", Namespaced: false},

	// policy/v1
	{Group: "policy", Version: "v1", Kind: "PodDisruptionBudget", Resource: "poddisruptionbudgets", Namespaced: true},

	// storage.k8s.io/v1
	{Group: "storage.k8s.io", Version: "v1", Kind: "StorageClass", Resource: "storageclasses", Namespaced: false},

	// admissionregistration.k8s.io/v1
	{Group: "admissionregistration.k8s.io", Version: "v1", Kind: "MutatingWebhookConfiguration", Resource: "mutatingwebhookconfigurations", Namespaced: false},
	{Group: "admissionregistration.k8s.io", Version: "v1", Kind: "ValidatingWebhookConfiguration", Resource: "validatingwebhookconfigurations", Namespaced: false},

	// apiextensions.k8s.io/v1
	{Group: "apiextensions.k8s.io", Version: "v1", Kind: "CustomResourceDefinition", Resource: "customresourcedefinitions", Namespaced: false},
}

var (
	builtinResourceByGVK  = buildBuiltinResourceByGVK()
	builtinResourceByKind = buildBuiltinResourceByKind()
)

func buildBuiltinResourceByGVK() map[builtinResourceKey]builtinResourceInfo {
	lookup := make(map[builtinResourceKey]builtinResourceInfo, len(builtinResourceCatalog))
	for _, resource := range builtinResourceCatalog {
		lookup[builtinResourceKey{
			group:   resource.Group,
			version: resource.Version,
			kind:    strings.ToLower(resource.Kind),
		}] = resource
	}
	return lookup
}

func buildBuiltinResourceByKind() map[string]builtinResourceInfo {
	lookup := make(map[string]builtinResourceInfo, len(builtinResourceCatalog))
	for _, resource := range builtinResourceCatalog {
		lookup[strings.ToLower(resource.Kind)] = resource
	}
	return lookup
}

func lookupBuiltinResourceByGVK(group, version, kind string) (builtinResourceInfo, bool) {
	key := builtinResourceKey{
		group:   strings.TrimSpace(group),
		version: strings.TrimSpace(version),
		kind:    strings.ToLower(strings.TrimSpace(kind)),
	}
	if key.version == "" || key.kind == "" {
		return builtinResourceInfo{}, false
	}
	resource, ok := builtinResourceByGVK[key]
	return resource, ok
}

func lookupBuiltinResourceByKind(kind string) (builtinResourceInfo, bool) {
	normalized := strings.ToLower(strings.TrimSpace(kind))
	if normalized == "" {
		return builtinResourceInfo{}, false
	}
	resource, ok := builtinResourceByKind[normalized]
	return resource, ok
}
