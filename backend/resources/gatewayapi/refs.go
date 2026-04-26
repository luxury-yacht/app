package gatewayapi

import (
	"strings"

	"github.com/luxury-yacht/app/backend/resources/common"
	"github.com/luxury-yacht/app/backend/resources/types"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"
)

func gatewayClassRef(deps common.Dependencies, name gatewayv1.ObjectName) types.ObjectRef {
	return types.ObjectRef{
		ClusterID: deps.ClusterID,
		Group:     Group,
		Version:   versionFor(deps, Group, "GatewayClass"),
		Kind:      "GatewayClass",
		Name:      string(name),
	}
}

func parentReferenceRef(deps common.Dependencies, currentNamespace string, ref gatewayv1.ParentReference) types.RefOrDisplay {
	group := Group
	if ref.Group != nil {
		group = string(*ref.Group)
	}
	kind := "Gateway"
	if ref.Kind != nil {
		kind = string(*ref.Kind)
	}
	namespace := currentNamespace
	if ref.Namespace != nil {
		namespace = string(*ref.Namespace)
	}
	return refOrDisplay(deps, group, kind, namespace, string(ref.Name))
}

func parentGatewayReferenceRef(deps common.Dependencies, currentNamespace string, ref gatewayv1.ParentGatewayReference) types.RefOrDisplay {
	group := Group
	if ref.Group != nil {
		group = string(*ref.Group)
	}
	kind := "Gateway"
	if ref.Kind != nil {
		kind = string(*ref.Kind)
	}
	namespace := currentNamespace
	if ref.Namespace != nil {
		namespace = string(*ref.Namespace)
	}
	return refOrDisplay(deps, group, kind, namespace, string(ref.Name))
}

func backendObjectReferenceRef(deps common.Dependencies, currentNamespace string, ref gatewayv1.BackendObjectReference) types.RefOrDisplay {
	group := ""
	if ref.Group != nil {
		group = string(*ref.Group)
	}
	kind := "Service"
	if ref.Kind != nil {
		kind = string(*ref.Kind)
	}
	namespace := currentNamespace
	if ref.Namespace != nil {
		namespace = string(*ref.Namespace)
	}
	return refOrDisplay(deps, group, kind, namespace, string(ref.Name))
}

func policyTargetReferenceRef(deps common.Dependencies, currentNamespace string, ref gatewayv1.LocalPolicyTargetReferenceWithSectionName) types.RefOrDisplay {
	return refOrDisplay(deps, string(ref.Group), string(ref.Kind), currentNamespace, string(ref.Name))
}

func referenceGrantToRef(deps common.Dependencies, currentNamespace string, ref gatewayv1.ReferenceGrantTo) types.RefOrDisplay {
	name := ""
	if ref.Name != nil {
		name = string(*ref.Name)
	}
	return refOrDisplay(deps, string(ref.Group), string(ref.Kind), currentNamespace, name)
}

func refOrDisplay(deps common.Dependencies, group, kind, namespace, name string) types.RefOrDisplay {
	group = strings.TrimSpace(group)
	kind = strings.TrimSpace(kind)
	name = strings.TrimSpace(name)
	version := versionFor(deps, group, kind)
	if version == "" || name == "" {
		return types.RefOrDisplay{Display: &types.DisplayRef{
			ClusterID: deps.ClusterID,
			Group:     group,
			Kind:      kind,
			Namespace: namespace,
			Name:      name,
		}}
	}
	return types.RefOrDisplay{Ref: &types.ObjectRef{
		ClusterID: deps.ClusterID,
		Group:     group,
		Version:   version,
		Kind:      kind,
		Namespace: namespace,
		Name:      name,
	}}
}

func versionFor(deps common.Dependencies, group, kind string) string {
	switch {
	case group == "":
		return "v1"
	case group == Group:
		if deps.GatewayVersionResolver != nil {
			if version := deps.GatewayVersionResolver.PreferredVersion(group, kind); version != "" {
				return version
			}
		}
		return "v1"
	default:
		if deps.GatewayVersionResolver != nil {
			return deps.GatewayVersionResolver.PreferredVersion(group, kind)
		}
		return ""
	}
}
