package resourcestream

import "github.com/luxury-yacht/app/backend/refresh/permissions"

// PermissionRequirementsByDomain returns the list/watch resources the resource
// stream may wire for each streamed refresh domain.
func PermissionRequirementsByDomain() map[string][]permissions.ResourceRequirement {
	requirements := map[string][]permissions.ResourceRequirement{
		domainPods: {
			listWatch("", "pods"),
		},
		domainWorkloads: {
			listWatch("", "pods"),
			listWatch("apps", "replicasets"),
			listWatch("apps", "deployments"),
			listWatch("apps", "statefulsets"),
			listWatch("apps", "daemonsets"),
			listWatch("batch", "jobs"),
			listWatch("batch", "cronjobs"),
		},
		domainNamespaceConfig: {
			listWatch("", "configmaps"),
			listWatch("", "secrets"),
		},
		domainNamespaceNetwork: {
			listWatch("", "services"),
			listWatch("discovery.k8s.io", "endpointslices"),
			listWatch("networking.k8s.io", "ingresses"),
			listWatch("networking.k8s.io", "networkpolicies"),
			listWatch("gateway.networking.k8s.io", "gateways"),
			listWatch("gateway.networking.k8s.io", "httproutes"),
			listWatch("gateway.networking.k8s.io", "grpcroutes"),
			listWatch("gateway.networking.k8s.io", "tlsroutes"),
			listWatch("gateway.networking.k8s.io", "listenersets"),
			listWatch("gateway.networking.k8s.io", "referencegrants"),
			listWatch("gateway.networking.k8s.io", "backendtlspolicies"),
		},
		domainNamespaceRBAC: {
			listWatch("rbac.authorization.k8s.io", "roles"),
			listWatch("rbac.authorization.k8s.io", "rolebindings"),
			listWatch("", "serviceaccounts"),
		},
		domainNamespaceCustom: {
			listWatch("apiextensions.k8s.io", "customresourcedefinitions"),
		},
		domainNamespaceHelm: {
			listWatch("", "secrets"),
			listWatch("", "configmaps"),
		},
		domainNamespaceAutoscaling: {
			listWatch("autoscaling", "horizontalpodautoscalers"),
		},
		domainNamespaceQuotas: {
			listWatch("", "resourcequotas"),
			listWatch("", "limitranges"),
			listWatch("policy", "poddisruptionbudgets"),
		},
		domainNamespaceStorage: {
			listWatch("", "persistentvolumeclaims"),
		},
		domainClusterRBAC: {
			listWatch("rbac.authorization.k8s.io", "clusterroles"),
			listWatch("rbac.authorization.k8s.io", "clusterrolebindings"),
		},
		domainClusterStorage: {
			listWatch("", "persistentvolumes"),
		},
		domainClusterConfig: {
			listWatch("storage.k8s.io", "storageclasses"),
			listWatch("networking.k8s.io", "ingressclasses"),
			listWatch("gateway.networking.k8s.io", "gatewayclasses"),
			listWatch("admissionregistration.k8s.io", "validatingwebhookconfigurations"),
			listWatch("admissionregistration.k8s.io", "mutatingwebhookconfigurations"),
		},
		domainClusterCRDs: {
			listWatch("apiextensions.k8s.io", "customresourcedefinitions"),
		},
		domainClusterCustom: {
			listWatch("apiextensions.k8s.io", "customresourcedefinitions"),
		},
		domainNodes: {
			listWatch("", "nodes"),
		},
	}

	copied := make(map[string][]permissions.ResourceRequirement, len(requirements))
	for domain, reqs := range requirements {
		copied[domain] = append([]permissions.ResourceRequirement(nil), reqs...)
	}
	return copied
}

func listWatch(group, resource string) permissions.ResourceRequirement {
	return permissions.ListRequirement(group, resource)
}
