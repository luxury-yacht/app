package snapshot

import (
	"context"
	"errors"
	"fmt"

	admissionregistrationv1 "k8s.io/api/admissionregistration/v1"
	appsv1 "k8s.io/api/apps/v1"
	autoscalingv1 "k8s.io/api/autoscaling/v1"
	batchv1 "k8s.io/api/batch/v1"
	corev1 "k8s.io/api/core/v1"
	discoveryv1 "k8s.io/api/discovery/v1"
	networkingv1 "k8s.io/api/networking/v1"
	policyv1 "k8s.io/api/policy/v1"
	rbacv1 "k8s.io/api/rbac/v1"
	storagev1 "k8s.io/api/storage/v1"
	apiextensionsv1 "k8s.io/apiextensions-apiserver/pkg/apis/apiextensions/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	appslisters "k8s.io/client-go/listers/apps/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"

	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/resourcemodel"
)

// BuildPodSummary builds a pod row payload that matches snapshot formatting.
func BuildPodSummary(meta ClusterMeta, pod *corev1.Pod, usage map[string]metrics.PodUsage, rsLister appslisters.ReplicaSetLister) PodSummary {
	if pod == nil {
		return PodSummary{ClusterMeta: meta}
	}
	if usage == nil {
		usage = map[string]metrics.PodUsage{}
	}
	rsMap := buildReplicaSetDeploymentMapForPod(pod, rsLister)
	return buildPodSummary(meta, pod, usage, rsMap)
}

// BuildConfigMapSummary builds a config map row payload that matches snapshot formatting.
func BuildConfigMapSummary(meta ClusterMeta, cm *corev1.ConfigMap) ConfigSummary {
	if cm == nil {
		return ConfigSummary{ClusterMeta: meta, Kind: "ConfigMap", TypeAlias: "CM"}
	}
	model := resourcemodel.BuildConfigMapResourceModel(meta.ClusterID, cm, nil)
	dataCount := len(cm.Data) + len(cm.BinaryData)
	if facts := model.Facts.ConfigMap; facts != nil {
		dataCount = facts.DataCount
	}
	return ConfigSummary{
		ClusterMeta: meta,
		Kind:        "ConfigMap",
		TypeAlias:   "CM",
		Name:        cm.Name,
		Namespace:   cm.Namespace,
		Data:        dataCount,
		Age:         formatAge(cm.CreationTimestamp.Time),
	}
}

// BuildSecretSummary builds a secret row payload that matches snapshot formatting.
func BuildSecretSummary(meta ClusterMeta, secret *corev1.Secret) ConfigSummary {
	if secret == nil {
		return ConfigSummary{ClusterMeta: meta, Kind: "Secret"}
	}
	model := resourcemodel.BuildSecretResourceModel(meta.ClusterID, secret, nil)
	dataCount := len(secret.Data) + len(secret.StringData)
	if facts := model.Facts.Secret; facts != nil {
		dataCount = facts.DataCount
	}
	return ConfigSummary{
		ClusterMeta: meta,
		Kind:        "Secret",
		TypeAlias:   secretTypeAlias(secret),
		Name:        secret.Name,
		Namespace:   secret.Namespace,
		Data:        dataCount,
		Age:         formatAge(secret.CreationTimestamp.Time),
	}
}

// BuildRoleSummary builds a role row payload that matches snapshot formatting.
func BuildRoleSummary(meta ClusterMeta, role *rbacv1.Role) RBACSummary {
	if role == nil {
		return RBACSummary{ClusterMeta: meta, Kind: "Role"}
	}
	model := resourcemodel.BuildRoleResourceModel(meta.ClusterID, role, nil)
	return RBACSummary{
		ClusterMeta: meta,
		Kind:        "Role",
		Name:        role.Name,
		Namespace:   role.Namespace,
		Details:     describeRoleFacts(model.Facts.Role),
		Age:         formatAge(role.CreationTimestamp.Time),
	}
}

// BuildRoleBindingSummary builds a role binding row payload that matches snapshot formatting.
func BuildRoleBindingSummary(meta ClusterMeta, binding *rbacv1.RoleBinding) RBACSummary {
	if binding == nil {
		return RBACSummary{ClusterMeta: meta, Kind: "RoleBinding"}
	}
	model := resourcemodel.BuildRoleBindingResourceModel(meta.ClusterID, binding)
	return RBACSummary{
		ClusterMeta: meta,
		Kind:        "RoleBinding",
		Name:        binding.Name,
		Namespace:   binding.Namespace,
		Details:     describeRoleBindingFacts(model.Facts.RoleBinding),
		Age:         formatAge(binding.CreationTimestamp.Time),
	}
}

// BuildServiceAccountSummary builds a service account row payload that matches snapshot formatting.
func BuildServiceAccountSummary(meta ClusterMeta, sa *corev1.ServiceAccount) RBACSummary {
	if sa == nil {
		return RBACSummary{ClusterMeta: meta, Kind: "ServiceAccount"}
	}
	model := resourcemodel.BuildServiceAccountResourceModel(meta.ClusterID, sa, nil, nil, nil)
	return RBACSummary{
		ClusterMeta: meta,
		Kind:        "ServiceAccount",
		Name:        sa.Name,
		Namespace:   sa.Namespace,
		Details:     describeServiceAccountFacts(model.Facts.ServiceAccount),
		Age:         formatAge(sa.CreationTimestamp.Time),
	}
}

// BuildServiceNetworkSummary builds a service row payload that matches snapshot formatting.
func BuildServiceNetworkSummary(
	meta ClusterMeta,
	svc *corev1.Service,
	slices []*discoveryv1.EndpointSlice,
) NetworkSummary {
	if svc == nil {
		return NetworkSummary{ClusterMeta: meta, Kind: "Service"}
	}
	model := resourcemodel.BuildServiceResourceModel(meta.ClusterID, svc, slices)
	return NetworkSummary{
		ClusterMeta: meta,
		Kind:        "Service",
		Name:        svc.Name,
		Namespace:   svc.Namespace,
		Details:     describeServiceFacts(model.Facts.Service),
		Age:         formatAge(svc.CreationTimestamp.Time),
	}
}

// BuildIngressNetworkSummary builds an ingress row payload that matches snapshot formatting.
func BuildIngressNetworkSummary(meta ClusterMeta, ing *networkingv1.Ingress) NetworkSummary {
	if ing == nil {
		return NetworkSummary{ClusterMeta: meta, Kind: "Ingress"}
	}
	model := resourcemodel.BuildIngressResourceModel(meta.ClusterID, ing)
	return NetworkSummary{
		ClusterMeta: meta,
		Kind:        "Ingress",
		Name:        ing.Name,
		Namespace:   ing.Namespace,
		Details:     describeIngressFacts(model.Facts.Ingress),
		Age:         formatAge(ing.CreationTimestamp.Time),
	}
}

// BuildNetworkPolicySummary builds a network policy row payload that matches snapshot formatting.
func BuildNetworkPolicySummary(meta ClusterMeta, policy *networkingv1.NetworkPolicy) NetworkSummary {
	if policy == nil {
		return NetworkSummary{ClusterMeta: meta, Kind: "NetworkPolicy"}
	}
	model := resourcemodel.BuildNetworkPolicyResourceModel(meta.ClusterID, policy)
	return NetworkSummary{
		ClusterMeta: meta,
		Kind:        "NetworkPolicy",
		Name:        policy.Name,
		Namespace:   policy.Namespace,
		Details:     describeNetworkPolicyFacts(model.Facts.NetworkPolicy),
		Age:         formatAge(policy.CreationTimestamp.Time),
	}
}

func BuildGatewayNetworkSummary(meta ClusterMeta, gateway *gatewayv1.Gateway) NetworkSummary {
	if gateway == nil {
		return NetworkSummary{ClusterMeta: meta, Kind: "Gateway"}
	}
	model := resourcemodel.BuildGatewayResourceModel(meta.ClusterID, gateway)
	return NetworkSummary{
		ClusterMeta: meta,
		Kind:        "Gateway",
		Name:        gateway.Name,
		Namespace:   gateway.Namespace,
		Details:     describeGatewayFacts(model.Facts.Gateway),
		Age:         formatAge(gateway.CreationTimestamp.Time),
	}
}

func BuildHTTPRouteNetworkSummary(meta ClusterMeta, route *gatewayv1.HTTPRoute) NetworkSummary {
	if route == nil {
		return NetworkSummary{ClusterMeta: meta, Kind: "HTTPRoute"}
	}
	model := resourcemodel.BuildHTTPRouteResourceModel(meta.ClusterID, route)
	return NetworkSummary{
		ClusterMeta: meta,
		Kind:        "HTTPRoute",
		Name:        route.Name,
		Namespace:   route.Namespace,
		Details:     describeGatewayRouteFacts(model.Facts.HTTPRoute.RouteCommonFacts),
		Age:         formatAge(route.CreationTimestamp.Time),
	}
}

func BuildGRPCRouteNetworkSummary(meta ClusterMeta, route *gatewayv1.GRPCRoute) NetworkSummary {
	if route == nil {
		return NetworkSummary{ClusterMeta: meta, Kind: "GRPCRoute"}
	}
	model := resourcemodel.BuildGRPCRouteResourceModel(meta.ClusterID, route)
	return NetworkSummary{
		ClusterMeta: meta,
		Kind:        "GRPCRoute",
		Name:        route.Name,
		Namespace:   route.Namespace,
		Details:     describeGatewayRouteFacts(model.Facts.GRPCRoute.RouteCommonFacts),
		Age:         formatAge(route.CreationTimestamp.Time),
	}
}

func BuildTLSRouteNetworkSummary(meta ClusterMeta, route *gatewayv1.TLSRoute) NetworkSummary {
	if route == nil {
		return NetworkSummary{ClusterMeta: meta, Kind: "TLSRoute"}
	}
	model := resourcemodel.BuildTLSRouteResourceModel(meta.ClusterID, route)
	return NetworkSummary{
		ClusterMeta: meta,
		Kind:        "TLSRoute",
		Name:        route.Name,
		Namespace:   route.Namespace,
		Details:     describeGatewayRouteFacts(model.Facts.TLSRoute.RouteCommonFacts),
		Age:         formatAge(route.CreationTimestamp.Time),
	}
}

func BuildListenerSetNetworkSummary(meta ClusterMeta, listenerSet *gatewayv1.ListenerSet) NetworkSummary {
	if listenerSet == nil {
		return NetworkSummary{ClusterMeta: meta, Kind: "ListenerSet"}
	}
	model := resourcemodel.BuildListenerSetResourceModel(meta.ClusterID, listenerSet)
	return NetworkSummary{
		ClusterMeta: meta,
		Kind:        "ListenerSet",
		Name:        listenerSet.Name,
		Namespace:   listenerSet.Namespace,
		Details:     describeListenerSetFacts(model.Facts.ListenerSet),
		Age:         formatAge(listenerSet.CreationTimestamp.Time),
	}
}

func BuildReferenceGrantNetworkSummary(meta ClusterMeta, grant *gatewayv1.ReferenceGrant) NetworkSummary {
	if grant == nil {
		return NetworkSummary{ClusterMeta: meta, Kind: "ReferenceGrant"}
	}
	model := resourcemodel.BuildReferenceGrantResourceModel(meta.ClusterID, grant)
	return NetworkSummary{
		ClusterMeta: meta,
		Kind:        "ReferenceGrant",
		Name:        grant.Name,
		Namespace:   grant.Namespace,
		Details:     describeReferenceGrantFacts(model.Facts.ReferenceGrant),
		Age:         formatAge(grant.CreationTimestamp.Time),
	}
}

func BuildBackendTLSPolicyNetworkSummary(meta ClusterMeta, policy *gatewayv1.BackendTLSPolicy) NetworkSummary {
	if policy == nil {
		return NetworkSummary{ClusterMeta: meta, Kind: "BackendTLSPolicy"}
	}
	model := resourcemodel.BuildBackendTLSPolicyResourceModel(meta.ClusterID, policy)
	return NetworkSummary{
		ClusterMeta: meta,
		Kind:        "BackendTLSPolicy",
		Name:        policy.Name,
		Namespace:   policy.Namespace,
		Details:     describeBackendTLSPolicyFacts(model.Facts.BackendTLSPolicy),
		Age:         formatAge(policy.CreationTimestamp.Time),
	}
}

// BuildNamespaceCustomSummary builds a custom resource row payload that
// matches snapshot formatting. This is the **single source of truth** for
// namespace-scoped custom resource row construction — the full-snapshot
// builder in namespace_custom.go calls this helper rather than inlining
// its own construction, so the two paths cannot drift.
//
// crdName is the canonical Kubernetes CRD name (`<plural>.<group>`,
// e.g. "dbinstances.rds.services.k8s.aws"). The snapshot path passes
// `crd.Name` directly from the apiextensions object; the streaming path
// computes it from the GVR (`gvr.Resource + "." + gvr.Group`). Used by
// the frontend's CRD column to render a clickable cell that opens the
// owning CRD in the object panel.
//
// defaultNamespace is used when the unstructured resource itself carries
// an empty namespace (rare but possible for newly-created items or
// malformed objects returned from list-with-all-namespaces queries). The
// snapshot path passes its scope namespace; the streaming path passes
// the resource's own namespace (so the fallback is a no-op for it unless
// the resource is pathologically empty).
//
// Any new field added to NamespaceCustomSummary MUST be populated here.
func BuildNamespaceCustomSummary(
	meta ClusterMeta,
	resource *unstructured.Unstructured,
	apiGroup string,
	apiVersion string,
	kindFallback string,
	crdName string,
	defaultNamespace string,
) NamespaceCustomSummary {
	if resource == nil {
		return NamespaceCustomSummary{
			ClusterMeta: meta,
			Kind:        kindFallback,
			APIGroup:    apiGroup,
			APIVersion:  apiVersion,
			CRDName:     crdName,
		}
	}
	gvr := schema.GroupVersionResource{Group: apiGroup, Version: apiVersion}
	model := resourcemodel.BuildCustomResourceModel(meta.ClusterID, resource, gvr, kindFallback, crdName, resourcemodel.ResourceScopeNamespaced, defaultNamespace)
	facts := model.Facts.CustomResource
	return NamespaceCustomSummary{
		ClusterMeta:        meta,
		Kind:               model.Ref.Kind,
		Name:               model.Ref.Name,
		APIGroup:           model.Ref.Group,
		APIVersion:         model.Ref.Version,
		CRDName:            crdName,
		Namespace:          model.Ref.Namespace,
		Status:             model.Status.Label,
		StatusState:        model.Status.State,
		Ready:              facts.Ready,
		ObservedGeneration: facts.ObservedGeneration,
		Conditions:         facts.Conditions,
		Age:                formatAge(model.Metadata.CreationTimestamp.Time),
		Labels:             model.Metadata.Labels,
		Annotations:        model.Metadata.Annotations,
	}
}

// BuildClusterRoleSummary builds a cluster role row payload that matches snapshot formatting.
func BuildClusterRoleSummary(meta ClusterMeta, role *rbacv1.ClusterRole) ClusterRBACEntry {
	if role == nil {
		return ClusterRBACEntry{ClusterMeta: meta, Kind: "ClusterRole"}
	}
	model := resourcemodel.BuildClusterRoleResourceModel(meta.ClusterID, role, nil, nil)
	return ClusterRBACEntry{
		ClusterMeta: meta,
		Kind:        "ClusterRole",
		Name:        role.Name,
		Details:     describeClusterRoleFacts(model.Facts.ClusterRole),
		Age:         formatAge(role.CreationTimestamp.Time),
		TypeAlias:   "CR",
	}
}

// BuildClusterRoleBindingSummary builds a cluster role binding row payload that matches snapshot formatting.
func BuildClusterRoleBindingSummary(meta ClusterMeta, binding *rbacv1.ClusterRoleBinding) ClusterRBACEntry {
	if binding == nil {
		return ClusterRBACEntry{ClusterMeta: meta, Kind: "ClusterRoleBinding"}
	}
	model := resourcemodel.BuildClusterRoleBindingResourceModel(meta.ClusterID, binding)
	return ClusterRBACEntry{
		ClusterMeta: meta,
		Kind:        "ClusterRoleBinding",
		Name:        binding.Name,
		Details:     describeClusterRoleBindingFacts(model.Facts.ClusterRoleBinding),
		Age:         formatAge(binding.CreationTimestamp.Time),
		TypeAlias:   "CRB",
	}
}

// BuildClusterStorageSummary builds a persistent volume row payload that matches snapshot formatting.
func BuildClusterStorageSummary(meta ClusterMeta, pv *corev1.PersistentVolume) ClusterStorageEntry {
	if pv == nil {
		return ClusterStorageEntry{ClusterMeta: meta, Kind: "PersistentVolume"}
	}
	model := resourcemodel.BuildPersistentVolumeResourceModel(meta.ClusterID, pv)
	return ClusterStorageEntry{
		ClusterMeta:        meta,
		Kind:               "PersistentVolume",
		Name:               pv.Name,
		StorageClass:       pv.Spec.StorageClassName,
		Capacity:           formatStorageCapacity(pv),
		AccessModes:        formatAccessModes(pv.Spec.AccessModes),
		Status:             model.Status.Label,
		StatusState:        model.Status.State,
		StatusPresentation: model.Status.Presentation,
		StatusReason:       model.Status.Reason,
		Claim:              formatClaimRef(pv.Spec.ClaimRef),
		Age:                formatAge(pv.CreationTimestamp.Time),
	}
}

// BuildClusterStorageClassSummary builds a storage class entry that matches snapshot formatting.
func BuildClusterStorageClassSummary(meta ClusterMeta, sc *storagev1.StorageClass) ClusterConfigEntry {
	if sc == nil {
		return ClusterConfigEntry{ClusterMeta: meta, Kind: "StorageClass"}
	}
	model := resourcemodel.BuildStorageClassResourceModel(meta.ClusterID, sc)
	facts := model.Facts.StorageClass
	isDefault := false
	provisioner := sc.Provisioner
	if facts != nil {
		isDefault = facts.DefaultClass
		provisioner = facts.Provisioner
	}
	return ClusterConfigEntry{
		ClusterMeta: meta,
		Kind:        "StorageClass",
		Name:        sc.Name,
		Details:     provisioner,
		IsDefault:   isDefault,
		Age:         formatAge(sc.CreationTimestamp.Time),
	}
}

// BuildClusterIngressClassSummary builds an ingress class entry that matches snapshot formatting.
func BuildClusterIngressClassSummary(meta ClusterMeta, ic *networkingv1.IngressClass) ClusterConfigEntry {
	if ic == nil {
		return ClusterConfigEntry{ClusterMeta: meta, Kind: "IngressClass"}
	}
	model := resourcemodel.BuildIngressClassResourceModel(meta.ClusterID, ic)
	facts := model.Facts.IngressClass
	controller := ic.Spec.Controller
	isDefault := isDefaultClass(ic.Annotations)
	if facts != nil {
		controller = facts.Controller
		isDefault = facts.DefaultClass
	}
	return ClusterConfigEntry{
		ClusterMeta: meta,
		Kind:        "IngressClass",
		Name:        ic.Name,
		Details:     controller,
		IsDefault:   isDefault,
		Age:         formatAge(ic.CreationTimestamp.Time),
	}
}

// BuildClusterGatewayClassSummary builds a gateway class entry that matches snapshot formatting.
func BuildClusterGatewayClassSummary(meta ClusterMeta, gc *gatewayv1.GatewayClass) ClusterConfigEntry {
	if gc == nil {
		return ClusterConfigEntry{ClusterMeta: meta, Kind: "GatewayClass"}
	}
	model := resourcemodel.BuildGatewayClassResourceModel(meta.ClusterID, gc)
	details := string(gc.Spec.ControllerName)
	if model.Facts.GatewayClass != nil {
		details = model.Facts.GatewayClass.ControllerName
	}
	return ClusterConfigEntry{
		ClusterMeta: meta,
		Kind:        "GatewayClass",
		Name:        gc.Name,
		Details:     details,
		Age:         formatAge(gc.CreationTimestamp.Time),
	}
}

// BuildClusterValidatingWebhookSummary builds a validating webhook entry that matches snapshot formatting.
func BuildClusterValidatingWebhookSummary(
	meta ClusterMeta,
	webhook *admissionregistrationv1.ValidatingWebhookConfiguration,
) ClusterConfigEntry {
	if webhook == nil {
		return ClusterConfigEntry{ClusterMeta: meta, Kind: "ValidatingWebhookConfiguration"}
	}
	model := resourcemodel.BuildValidatingWebhookConfigurationResourceModel(meta.ClusterID, webhook)
	count := len(webhook.Webhooks)
	if facts := model.Facts.ValidatingWebhookConfiguration; facts != nil {
		count = len(facts.Webhooks)
	}
	return ClusterConfigEntry{
		ClusterMeta: meta,
		Kind:        "ValidatingWebhookConfiguration",
		Name:        webhook.Name,
		Details:     resourcemodel.WebhookCountDetails(count),
		Age:         formatAge(webhook.CreationTimestamp.Time),
	}
}

// BuildClusterMutatingWebhookSummary builds a mutating webhook entry that matches snapshot formatting.
func BuildClusterMutatingWebhookSummary(
	meta ClusterMeta,
	webhook *admissionregistrationv1.MutatingWebhookConfiguration,
) ClusterConfigEntry {
	if webhook == nil {
		return ClusterConfigEntry{ClusterMeta: meta, Kind: "MutatingWebhookConfiguration"}
	}
	model := resourcemodel.BuildMutatingWebhookConfigurationResourceModel(meta.ClusterID, webhook)
	count := len(webhook.Webhooks)
	if facts := model.Facts.MutatingWebhookConfiguration; facts != nil {
		count = len(facts.Webhooks)
	}
	return ClusterConfigEntry{
		ClusterMeta: meta,
		Kind:        "MutatingWebhookConfiguration",
		Name:        webhook.Name,
		Details:     resourcemodel.WebhookCountDetails(count),
		Age:         formatAge(webhook.CreationTimestamp.Time),
	}
}

// BuildClusterCRDSummary builds a CRD row payload that matches snapshot
// formatting. This is the **single source of truth** for CRD row
// construction — the full-snapshot builder in cluster_crds.go calls this
// helper rather than inlining its own construction, so the two paths
// cannot drift. A previous bug had the streaming/incremental update path
// emitting rows without StorageVersion / ExtraServedVersionCount, which
// caused the Version column to "disappear" for rows that received a
// streaming update. The convergence here is the structural fix.
//
// Any new field added to ClusterCRDEntry MUST be populated here.
func BuildClusterCRDSummary(meta ClusterMeta, crd *apiextensionsv1.CustomResourceDefinition) ClusterCRDEntry {
	if crd == nil {
		return ClusterCRDEntry{ClusterMeta: meta, Kind: "CustomResourceDefinition"}
	}
	model := resourcemodel.BuildCustomResourceDefinitionResourceModel(meta.ClusterID, crd)
	facts := model.Facts.CustomResourceDefinition
	group := crd.Spec.Group
	scope := string(crd.Spec.Scope)
	details := describeCRDVersions(crd)
	storageVersion, extraServed := crdVersionSummary(crd)
	if facts != nil {
		group = facts.Group
		scope = facts.Scope
		details = resourcemodel.CustomResourceDefinitionVersionDetails(*facts)
		storageVersion = facts.StorageVersion
		extraServed = facts.ExtraServedVersionCount
	}
	return ClusterCRDEntry{
		ClusterMeta:             meta,
		Kind:                    "CustomResourceDefinition",
		Name:                    crd.Name,
		Group:                   group,
		Scope:                   scope,
		Details:                 details,
		StorageVersion:          storageVersion,
		ExtraServedVersionCount: extraServed,
		Age:                     formatAge(crd.CreationTimestamp.Time),
		TypeAlias:               "CRD",
	}
}

// BuildClusterCustomSummary builds a cluster custom resource row payload
// that matches snapshot formatting. This is the **single source of truth**
// for cluster-scoped custom resource row construction — the full-snapshot
// builder in cluster_custom.go calls this helper rather than inlining its
// own construction, so the two paths cannot drift.
//
// crdName is the canonical Kubernetes CRD name (`<plural>.<group>`,
// e.g. "dbclusters.rds.services.k8s.aws"). The snapshot path passes
// `crd.Name` directly from the apiextensions object; the streaming path
// computes it from the GVR (`gvr.Resource + "." + gvr.Group`). Used by
// the frontend's CRD column to render a clickable cell that opens the
// owning CRD in the object panel. See NamespaceCustomSummary for the
// same-shape field on the namespace-scoped variant.
//
// Any new field added to ClusterCustomSummary MUST be populated here.
func BuildClusterCustomSummary(
	meta ClusterMeta,
	resource *unstructured.Unstructured,
	apiGroup string,
	apiVersion string,
	kindFallback string,
	crdName string,
) ClusterCustomSummary {
	if resource == nil {
		return ClusterCustomSummary{
			ClusterMeta: meta,
			Kind:        kindFallback,
			APIGroup:    apiGroup,
			APIVersion:  apiVersion,
			CRDName:     crdName,
		}
	}
	gvr := schema.GroupVersionResource{Group: apiGroup, Version: apiVersion}
	model := resourcemodel.BuildCustomResourceModel(meta.ClusterID, resource, gvr, kindFallback, crdName, resourcemodel.ResourceScopeCluster, "")
	facts := model.Facts.CustomResource
	return ClusterCustomSummary{
		ClusterMeta:        meta,
		Kind:               model.Ref.Kind,
		Name:               model.Ref.Name,
		APIGroup:           model.Ref.Group,
		APIVersion:         model.Ref.Version,
		CRDName:            crdName,
		Status:             model.Status.Label,
		StatusState:        model.Status.State,
		Ready:              facts.Ready,
		ObservedGeneration: facts.ObservedGeneration,
		Conditions:         facts.Conditions,
		Age:                formatAge(model.Metadata.CreationTimestamp.Time),
		Labels:             model.Metadata.Labels,
		Annotations:        model.Metadata.Annotations,
	}
}

// BuildEndpointSliceSummary builds a row for one concrete EndpointSlice object.
func BuildEndpointSliceSummary(
	meta ClusterMeta,
	slice *discoveryv1.EndpointSlice,
) NetworkSummary {
	if slice == nil {
		return NetworkSummary{ClusterMeta: meta, Kind: "EndpointSlice"}
	}
	model := resourcemodel.BuildEndpointSliceResourceModel(meta.ClusterID, slice)
	return NetworkSummary{
		ClusterMeta: meta,
		Kind:        "EndpointSlice",
		Name:        slice.Name,
		Namespace:   slice.Namespace,
		Details:     describeEndpointSliceFacts(model.Facts.EndpointSlice),
		Age:         formatAge(slice.CreationTimestamp.Time),
	}
}

// BuildHPASummary builds an HPA row payload that matches snapshot
// formatting. This is the **single source of truth** for HPA row
// construction — the full-snapshot builder in namespace_autoscaling.go
// calls this helper rather than inlining its own construction, so the
// two paths cannot drift.
//
// TargetAPIVersion is the wire-form apiVersion of the scale target,
// threaded verbatim from hpa.Spec.ScaleTargetRef.APIVersion. It is what
// lets the frontend open CRD scale targets (Argo Rollout, KEDA, custom
// workload operators) in the object panel with a fully-qualified GVK. A
// previous bug had this path dropping the field on streaming updates
// (which HPAs receive constantly as Status.CurrentReplicas changes),
// which silently re-introduced the kind-only-objects bug for CRD scale
// targets.
//
// Any new field added to AutoscalingSummary MUST be populated here.
func BuildHPASummary(meta ClusterMeta, hpa *autoscalingv1.HorizontalPodAutoscaler) AutoscalingSummary {
	if hpa == nil {
		return AutoscalingSummary{ClusterMeta: meta, Kind: "HorizontalPodAutoscaler"}
	}
	model := resourcemodel.BuildHorizontalPodAutoscalerV1ResourceModel(meta.ClusterID, hpa)
	facts := model.Facts.HorizontalPodAutoscaler
	return AutoscalingSummary{
		ClusterMeta:      meta,
		Kind:             "HorizontalPodAutoscaler",
		Name:             hpa.Name,
		Namespace:        hpa.Namespace,
		Target:           describeHPATargetFacts(facts),
		TargetAPIVersion: scaleTargetAPIVersion(facts.ScaleTarget),
		Min:              hpaMinReplicas(facts),
		Max:              facts.MaxReplicas,
		Current:          facts.CurrentReplicas,
		Age:              formatAge(hpa.CreationTimestamp.Time),
	}
}

// BuildPVCStorageSummary builds a PVC row payload that matches snapshot formatting.
func BuildPVCStorageSummary(meta ClusterMeta, pvc *corev1.PersistentVolumeClaim) StorageSummary {
	if pvc == nil {
		return StorageSummary{ClusterMeta: meta, Kind: "PersistentVolumeClaim"}
	}
	model := resourcemodel.BuildPersistentVolumeClaimResourceModel(meta.ClusterID, pvc)
	return StorageSummary{
		ClusterMeta:        meta,
		Kind:               "PersistentVolumeClaim",
		Name:               pvc.Name,
		Namespace:          pvc.Namespace,
		Capacity:           pvcCapacity(pvc),
		Status:             model.Status.Label,
		StatusState:        model.Status.State,
		StatusPresentation: model.Status.Presentation,
		StatusReason:       model.Status.Reason,
		StorageClass:       storageClassName(pvc),
		Age:                formatAge(pvc.CreationTimestamp.Time),
	}
}

// BuildResourceQuotaSummary builds a quota row payload that matches snapshot formatting.
func BuildResourceQuotaSummary(meta ClusterMeta, quota *corev1.ResourceQuota) QuotaSummary {
	if quota == nil {
		return QuotaSummary{ClusterMeta: meta, Kind: "ResourceQuota"}
	}
	model := resourcemodel.BuildResourceQuotaResourceModel(meta.ClusterID, quota)
	return QuotaSummary{
		ClusterMeta: meta,
		Kind:        "ResourceQuota",
		Name:        quota.Name,
		Namespace:   quota.Namespace,
		Details:     describeResourceQuotaFacts(model.Facts.ResourceQuota),
		Age:         formatAge(quota.CreationTimestamp.Time),
	}
}

// BuildLimitRangeSummary builds a limit range row payload that matches snapshot formatting.
func BuildLimitRangeSummary(meta ClusterMeta, limit *corev1.LimitRange) QuotaSummary {
	if limit == nil {
		return QuotaSummary{ClusterMeta: meta, Kind: "LimitRange"}
	}
	model := resourcemodel.BuildLimitRangeResourceModel(meta.ClusterID, limit)
	return QuotaSummary{
		ClusterMeta: meta,
		Kind:        "LimitRange",
		Name:        limit.Name,
		Namespace:   limit.Namespace,
		Details:     describeLimitRangeFacts(model.Facts.LimitRange),
		Age:         formatAge(limit.CreationTimestamp.Time),
	}
}

// BuildPodDisruptionBudgetSummary builds a PDB row payload that matches snapshot formatting.
func BuildPodDisruptionBudgetSummary(meta ClusterMeta, pdb *policyv1.PodDisruptionBudget) QuotaSummary {
	if pdb == nil {
		return QuotaSummary{ClusterMeta: meta, Kind: "PodDisruptionBudget"}
	}
	model := resourcemodel.BuildPodDisruptionBudgetResourceModel(meta.ClusterID, pdb)
	facts := model.Facts.PodDisruptionBudget
	summary := QuotaSummary{
		ClusterMeta: meta,
		Kind:        "PodDisruptionBudget",
		Name:        pdb.Name,
		Namespace:   pdb.Namespace,
		Details:     describePodDisruptionBudgetFacts(facts),
		Age:         formatAge(pdb.CreationTimestamp.Time),
		Status: &QuotaStatus{
			DisruptionsAllowed: facts.AllowedDisruptions,
			CurrentHealthy:     facts.CurrentHealthy,
			DesiredHealthy:     facts.DesiredHealthy,
		},
	}
	if facts.MinAvailable != nil {
		value := facts.MinAvailable.Value
		summary.MinAvailable = &value
	}
	if facts.MaxUnavailable != nil {
		value := facts.MaxUnavailable.Value
		summary.MaxUnavailable = &value
	}
	return summary
}

// BuildWorkloadSummary builds a workload row payload for a single workload object.
func BuildWorkloadSummary(meta ClusterMeta, obj interface{}, pods []*corev1.Pod, usage map[string]metrics.PodUsage) (WorkloadSummary, error) {
	podsByOwner := make(map[string][]*corev1.Pod)
	for _, pod := range pods {
		if pod == nil {
			continue
		}
		if ownerKey := ownerKeyForPod(pod); ownerKey != "" {
			podsByOwner[ownerKey] = append(podsByOwner[ownerKey], pod)
		}
	}

	builder := NamespaceWorkloadsBuilder{}
	var summary WorkloadSummary

	switch typed := obj.(type) {
	case *appsv1.Deployment:
		summary = builder.buildDeploymentSummary(meta.ClusterID, typed, podsByOwner, usage)
	case *appsv1.StatefulSet:
		summary = builder.buildStatefulSetSummary(meta.ClusterID, typed, podsByOwner, usage)
	case *appsv1.DaemonSet:
		summary = builder.buildDaemonSetSummary(meta.ClusterID, typed, podsByOwner, usage)
	case *batchv1.Job:
		summary = builder.buildJobSummary(meta.ClusterID, typed, podsByOwner, usage)
	case *batchv1.CronJob:
		summary = builder.buildCronJobSummary(meta.ClusterID, typed, podsByOwner, usage)
	default:
		return WorkloadSummary{}, fmt.Errorf("unsupported workload type %T", obj)
	}

	summary.ClusterMeta = meta
	return summary, nil
}

// BuildStandalonePodWorkloadSummary builds a workload row payload for a standalone pod entry.
func BuildStandalonePodWorkloadSummary(meta ClusterMeta, pod *corev1.Pod, usage map[string]metrics.PodUsage) WorkloadSummary {
	summary := buildStandalonePodSummary(meta.ClusterID, pod, usage)
	summary.ClusterMeta = meta
	return summary
}

// BuildNodeSummary builds a node row payload from the supplied node and pod list.
func BuildNodeSummary(meta ClusterMeta, node *corev1.Node, pods []*corev1.Pod, provider metrics.Provider) (NodeSummary, error) {
	if node == nil {
		return NodeSummary{}, errors.New("node is nil")
	}
	ctx := WithClusterMeta(context.Background(), meta)
	snap := buildNodeSnapshot(ctx, []*corev1.Node{node}, pods, provider)
	if snap == nil {
		return NodeSummary{}, errors.New("node snapshot unavailable")
	}
	payload, ok := snap.Payload.(NodeSnapshot)
	if !ok || len(payload.Nodes) == 0 {
		return NodeSummary{}, errors.New("node summary unavailable")
	}
	return payload.Nodes[0], nil
}

// WorkloadOwnerKey returns the canonical key used for workload pod grouping.
func WorkloadOwnerKey(kind, namespace, name string) string {
	return workloadOwnerKey(kind, namespace, name)
}

// WorkloadOwnerKeyForPod returns the canonical owner key for a pod in workload summaries.
func WorkloadOwnerKeyForPod(pod *corev1.Pod) string {
	return ownerKeyForPod(pod)
}

func buildReplicaSetDeploymentMapForPod(pod *corev1.Pod, rsLister appslisters.ReplicaSetLister) map[string]string {
	result := make(map[string]string)
	if pod == nil || rsLister == nil {
		return result
	}

	for _, owner := range pod.OwnerReferences {
		if owner.Controller == nil || !*owner.Controller || owner.Kind != "ReplicaSet" {
			continue
		}
		rs, err := rsLister.ReplicaSets(pod.Namespace).Get(owner.Name)
		if err != nil {
			continue
		}
		for _, rsOwner := range rs.OwnerReferences {
			if rsOwner.Controller != nil && *rsOwner.Controller && rsOwner.Kind == "Deployment" {
				result[owner.Name] = rsOwner.Name
				break
			}
		}
	}
	return result
}
