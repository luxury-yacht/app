package resourcestream

// SupportedDomains returns the refresh domains served by the resource
// WebSocket stream. Keep this list aligned with normalizeScopeForDomain and
// the frontend resource stream domain descriptors.
func SupportedDomains() []string {
	return append([]string(nil), supportedDomains...)
}

var supportedDomains = []string{
	domainPods,
	domainWorkloads,
	domainNamespaceConfig,
	domainNamespaceNetwork,
	domainNamespaceRBAC,
	domainNamespaceCustom,
	domainNamespaceHelm,
	domainNamespaceAutoscaling,
	domainNamespaceQuotas,
	domainNamespaceStorage,
	domainClusterRBAC,
	domainClusterStorage,
	domainClusterConfig,
	domainClusterCRDs,
	domainClusterCustom,
	domainNodes,
}
