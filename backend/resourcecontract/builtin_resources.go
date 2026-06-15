/*
 * backend/resourcecontract/builtin_resources.go
 *
 * Owns the built-in Kubernetes resource identity contract shared by catalog
 * identity resolution, refresh permission composition, and typed detail gates.
 */

package resourcecontract

import (
	"strings"

	"github.com/luxury-yacht/app/backend/resources/cronjob"
	"github.com/luxury-yacht/app/backend/resources/daemonset"
	"github.com/luxury-yacht/app/backend/resources/deployment"
	jobres "github.com/luxury-yacht/app/backend/resources/job"
	"github.com/luxury-yacht/app/backend/resources/replicaset"
	"github.com/luxury-yacht/app/backend/resources/statefulset"
	"k8s.io/apimachinery/pkg/runtime/schema"
)

// BuiltinResource describes one built-in Kubernetes resource identity.
type BuiltinResource struct {
	Group      string
	Version    string
	Kind       string
	Resource   string
	Namespaced bool
}

// BuiltinResources is the authoritative in-repo resource identity table for
// built-ins that Luxury Yacht handles without dynamic discovery.
var BuiltinResources = []BuiltinResource{
	builtin("", "v1", "Pod", "pods", true),
	builtin("", "v1", "Service", "services", true),
	builtin("", "v1", "ConfigMap", "configmaps", true),
	builtin("", "v1", "Secret", "secrets", true),
	builtin("", "v1", "ServiceAccount", "serviceaccounts", true),
	builtin("", "v1", "Event", "events", true),
	builtin("", "v1", "LimitRange", "limitranges", true),
	builtin("", "v1", "ResourceQuota", "resourcequotas", true),
	builtin("", "v1", "Endpoints", "endpoints", true),
	builtin("", "v1", "PersistentVolumeClaim", "persistentvolumeclaims", true),
	builtin("", "v1", "Namespace", "namespaces", false),
	builtin("", "v1", "Node", "nodes", false),
	builtin("", "v1", "PersistentVolume", "persistentvolumes", false),

	builtin(deployment.Identity.Group, deployment.Identity.Version, deployment.Identity.Kind, deployment.Identity.Resource, deployment.Identity.Namespaced),
	builtin(statefulset.Identity.Group, statefulset.Identity.Version, statefulset.Identity.Kind, statefulset.Identity.Resource, statefulset.Identity.Namespaced),
	builtin(daemonset.Identity.Group, daemonset.Identity.Version, daemonset.Identity.Kind, daemonset.Identity.Resource, daemonset.Identity.Namespaced),
	builtin(replicaset.Identity.Group, replicaset.Identity.Version, replicaset.Identity.Kind, replicaset.Identity.Resource, replicaset.Identity.Namespaced),

	builtin(jobres.Identity.Group, jobres.Identity.Version, jobres.Identity.Kind, jobres.Identity.Resource, jobres.Identity.Namespaced),
	builtin(cronjob.Identity.Group, cronjob.Identity.Version, cronjob.Identity.Kind, cronjob.Identity.Resource, cronjob.Identity.Namespaced),

	builtin("autoscaling", "v1", "HorizontalPodAutoscaler", "horizontalpodautoscalers", true),
	builtin("autoscaling", "v2", "HorizontalPodAutoscaler", "horizontalpodautoscalers", true),

	builtin("networking.k8s.io", "v1", "Ingress", "ingresses", true),
	builtin("networking.k8s.io", "v1", "NetworkPolicy", "networkpolicies", true),
	builtin("networking.k8s.io", "v1", "IngressClass", "ingressclasses", false),

	builtin("discovery.k8s.io", "v1", "EndpointSlice", "endpointslices", true),

	builtin("gateway.networking.k8s.io", "v1", "Gateway", "gateways", true),
	builtin("gateway.networking.k8s.io", "v1", "HTTPRoute", "httproutes", true),
	builtin("gateway.networking.k8s.io", "v1", "GRPCRoute", "grpcroutes", true),
	builtin("gateway.networking.k8s.io", "v1", "TLSRoute", "tlsroutes", true),
	builtin("gateway.networking.k8s.io", "v1", "ListenerSet", "listenersets", true),
	builtin("gateway.networking.k8s.io", "v1", "BackendTLSPolicy", "backendtlspolicies", true),
	builtin("gateway.networking.k8s.io", "v1", "ReferenceGrant", "referencegrants", true),
	builtin("gateway.networking.k8s.io", "v1", "GatewayClass", "gatewayclasses", false),

	builtin("rbac.authorization.k8s.io", "v1", "Role", "roles", true),
	builtin("rbac.authorization.k8s.io", "v1", "RoleBinding", "rolebindings", true),
	builtin("rbac.authorization.k8s.io", "v1", "ClusterRole", "clusterroles", false),
	builtin("rbac.authorization.k8s.io", "v1", "ClusterRoleBinding", "clusterrolebindings", false),

	builtin("policy", "v1", "PodDisruptionBudget", "poddisruptionbudgets", true),

	builtin("storage.k8s.io", "v1", "StorageClass", "storageclasses", false),
	builtin("storage.k8s.io", "v1", "CSIDriver", "csidrivers", false),
	builtin("storage.k8s.io", "v1", "CSINode", "csinodes", false),
	builtin("storage.k8s.io", "v1", "VolumeAttachment", "volumeattachments", false),

	builtin("admissionregistration.k8s.io", "v1", "MutatingWebhookConfiguration", "mutatingwebhookconfigurations", false),
	builtin("admissionregistration.k8s.io", "v1", "ValidatingWebhookConfiguration", "validatingwebhookconfigurations", false),

	builtin("coordination.k8s.io", "v1", "Lease", "leases", true),

	builtin("apiextensions.k8s.io", "v1", "CustomResourceDefinition", "customresourcedefinitions", false),
}

func builtin(group, version, kind, resource string, namespaced bool) BuiltinResource {
	return BuiltinResource{
		Group:      group,
		Version:    version,
		Kind:       kind,
		Resource:   resource,
		Namespaced: namespaced,
	}
}

// FindBuiltin returns a built-in resource by exact group/version/kind.
func FindBuiltin(group, version, kind string) (BuiltinResource, bool) {
	key := resourceKey(group, version, kind)
	for _, resource := range BuiltinResources {
		if resourceKey(resource.Group, resource.Version, resource.Kind) == key {
			return resource, true
		}
	}
	return BuiltinResource{}, false
}

// MustBuiltin returns a built-in resource and panics if the contract is missing it.
func MustBuiltin(group, version, kind string) BuiltinResource {
	resource, ok := FindBuiltin(group, version, kind)
	if !ok {
		panic("missing built-in resource contract for " + schema.GroupVersionKind{
			Group:   group,
			Version: version,
			Kind:    kind,
		}.String())
	}
	return resource
}

// GVK returns the resource's group/version/kind identity.
func (r BuiltinResource) GVK() schema.GroupVersionKind {
	return schema.GroupVersionKind{Group: r.Group, Version: r.Version, Kind: r.Kind}
}

// GVR returns the resource's group/version/resource identity.
func (r BuiltinResource) GVR() schema.GroupVersionResource {
	return schema.GroupVersionResource{Group: r.Group, Version: r.Version, Resource: r.Resource}
}

func resourceKey(group, version, kind string) string {
	return strings.TrimSpace(group) + "/" +
		strings.TrimSpace(version) + "/" +
		strings.ToLower(strings.TrimSpace(kind))
}
