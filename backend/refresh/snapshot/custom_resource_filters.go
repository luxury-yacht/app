package snapshot

import (
	"strings"

	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
)

type firstClassCRDKey struct {
	group    string
	resource string
	kind     string
}

var firstClassCustomResourceDefinitions = map[firstClassCRDKey]struct{}{
	{group: "gateway.networking.k8s.io", resource: "gatewayclasses", kind: "GatewayClass"}:         {},
	{group: "gateway.networking.k8s.io", resource: "gateways", kind: "Gateway"}:                    {},
	{group: "gateway.networking.k8s.io", resource: "httproutes", kind: "HTTPRoute"}:                {},
	{group: "gateway.networking.k8s.io", resource: "grpcroutes", kind: "GRPCRoute"}:                {},
	{group: "gateway.networking.k8s.io", resource: "tlsroutes", kind: "TLSRoute"}:                  {},
	{group: "gateway.networking.k8s.io", resource: "listenersets", kind: "ListenerSet"}:            {},
	{group: "gateway.networking.k8s.io", resource: "referencegrants", kind: "ReferenceGrant"}:      {},
	{group: "gateway.networking.k8s.io", resource: "backendtlspolicies", kind: "BackendTLSPolicy"}: {},
}

// IsFirstClassCustomResourceDefinition reports whether a CRD is rendered by a
// dedicated app domain instead of the generic Custom views.
func IsFirstClassCustomResourceDefinition(crd *apiextensionsv1.CustomResourceDefinition) bool {
	if crd == nil {
		return false
	}
	key := firstClassCRDKey{
		group:    crd.Spec.Group,
		resource: crd.Spec.Names.Plural,
		kind:     crd.Spec.Names.Kind,
	}
	if _, ok := firstClassCustomResourceDefinitions[key]; !ok {
		return false
	}
	return crdServesVersion(crd, "v1")
}

func crdServesVersion(crd *apiextensionsv1.CustomResourceDefinition, version string) bool {
	if crd == nil || strings.TrimSpace(version) == "" {
		return false
	}
	for _, crdVersion := range crd.Spec.Versions {
		if crdVersion.Name == version && crdVersion.Served {
			return true
		}
	}
	return false
}
