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
	storagev1 "k8s.io/api/storage/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	appslisters "k8s.io/client-go/listers/apps/v1"
	gatewayv1 "sigs.k8s.io/gateway-api/apis/v1"

	"github.com/luxury-yacht/app/backend/refresh/metrics"
	"github.com/luxury-yacht/app/backend/resourcemodel"
	"github.com/luxury-yacht/app/backend/resources/admission"
	"github.com/luxury-yacht/app/backend/resources/customresource"
	"github.com/luxury-yacht/app/backend/resources/endpointslice"
	"github.com/luxury-yacht/app/backend/resources/ingress"
	"github.com/luxury-yacht/app/backend/resources/ingressclass"
	"github.com/luxury-yacht/app/backend/resources/networkpolicy"
	"github.com/luxury-yacht/app/backend/resources/service"
	"github.com/luxury-yacht/app/backend/resources/storageclass"
)

// The new*Summary constructors fill the metadata fields every row of a given
// summary type shares (name/namespace/age from the object, plus kind/details).
// Each Build<Kind>Summary keeps its typed model + describe call and hands the
// result here, so the common row skeleton is declared once per summary type.

func newNetworkSummary(meta ClusterMeta, obj metav1.Object, kind, details string) NetworkSummary {
	return NetworkSummary{
		ClusterMeta:  meta,
		Kind:         kind,
		Name:         obj.GetName(),
		Namespace:    obj.GetNamespace(),
		Details:      details,
		Age:          formatAge(obj.GetCreationTimestamp().Time),
		AgeTimestamp: creationTimestampMillis(obj),
	}
}

func newClusterConfigEntry(meta ClusterMeta, obj metav1.Object, kind, details string, isDefault bool) ClusterConfigEntry {
	return ClusterConfigEntry{
		ClusterMeta:  meta,
		Kind:         kind,
		Name:         obj.GetName(),
		Details:      details,
		IsDefault:    isDefault,
		Age:          formatAge(obj.GetCreationTimestamp().Time),
		AgeTimestamp: creationTimestampMillis(obj),
	}
}

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

// BuildServiceNetworkSummary builds a service row payload that matches snapshot formatting.
func BuildServiceNetworkSummary(
	meta ClusterMeta,
	svc *corev1.Service,
	slices []*discoveryv1.EndpointSlice,
) NetworkSummary {
	if svc == nil {
		return NetworkSummary{ClusterMeta: meta, Kind: "Service"}
	}
	return newNetworkSummary(meta, svc, "Service", service.DescribeSummary(service.BuildFacts(svc, slices)))
}

// BuildIngressNetworkSummary builds an ingress row payload that matches snapshot formatting.
func BuildIngressNetworkSummary(meta ClusterMeta, ing *networkingv1.Ingress) NetworkSummary {
	if ing == nil {
		return NetworkSummary{ClusterMeta: meta, Kind: "Ingress"}
	}
	return newNetworkSummary(meta, ing, "Ingress", ingress.DescribeSummary(ingress.BuildFacts(meta.ClusterID, ing)))
}

// BuildNetworkPolicySummary builds a network policy row payload that matches snapshot formatting.
func BuildNetworkPolicySummary(meta ClusterMeta, policy *networkingv1.NetworkPolicy) NetworkSummary {
	if policy == nil {
		return NetworkSummary{ClusterMeta: meta, Kind: "NetworkPolicy"}
	}
	facts := networkpolicy.BuildFacts(policy)
	return newNetworkSummary(meta, policy, "NetworkPolicy", networkpolicy.DescribeSummary(facts))
}

func BuildGatewayNetworkSummary(meta ClusterMeta, gateway *gatewayv1.Gateway) NetworkSummary {
	if gateway == nil {
		return NetworkSummary{ClusterMeta: meta, Kind: "Gateway"}
	}
	model := resourcemodel.BuildGatewayResourceModel(meta.ClusterID, gateway)
	return newNetworkSummary(meta, gateway, "Gateway", describeGatewayFacts(model.Facts.Gateway))
}

func BuildHTTPRouteNetworkSummary(meta ClusterMeta, route *gatewayv1.HTTPRoute) NetworkSummary {
	if route == nil {
		return NetworkSummary{ClusterMeta: meta, Kind: "HTTPRoute"}
	}
	model := resourcemodel.BuildHTTPRouteResourceModel(meta.ClusterID, route)
	return newNetworkSummary(meta, route, "HTTPRoute", describeGatewayRouteFacts(model.Facts.HTTPRoute.RouteCommonFacts))
}

func BuildGRPCRouteNetworkSummary(meta ClusterMeta, route *gatewayv1.GRPCRoute) NetworkSummary {
	if route == nil {
		return NetworkSummary{ClusterMeta: meta, Kind: "GRPCRoute"}
	}
	model := resourcemodel.BuildGRPCRouteResourceModel(meta.ClusterID, route)
	return newNetworkSummary(meta, route, "GRPCRoute", describeGatewayRouteFacts(model.Facts.GRPCRoute.RouteCommonFacts))
}

func BuildTLSRouteNetworkSummary(meta ClusterMeta, route *gatewayv1.TLSRoute) NetworkSummary {
	if route == nil {
		return NetworkSummary{ClusterMeta: meta, Kind: "TLSRoute"}
	}
	model := resourcemodel.BuildTLSRouteResourceModel(meta.ClusterID, route)
	return newNetworkSummary(meta, route, "TLSRoute", describeGatewayRouteFacts(model.Facts.TLSRoute.RouteCommonFacts))
}

func BuildListenerSetNetworkSummary(meta ClusterMeta, listenerSet *gatewayv1.ListenerSet) NetworkSummary {
	if listenerSet == nil {
		return NetworkSummary{ClusterMeta: meta, Kind: "ListenerSet"}
	}
	model := resourcemodel.BuildListenerSetResourceModel(meta.ClusterID, listenerSet)
	return newNetworkSummary(meta, listenerSet, "ListenerSet", describeListenerSetFacts(model.Facts.ListenerSet))
}

func BuildReferenceGrantNetworkSummary(meta ClusterMeta, grant *gatewayv1.ReferenceGrant) NetworkSummary {
	if grant == nil {
		return NetworkSummary{ClusterMeta: meta, Kind: "ReferenceGrant"}
	}
	model := resourcemodel.BuildReferenceGrantResourceModel(meta.ClusterID, grant)
	return newNetworkSummary(meta, grant, "ReferenceGrant", describeReferenceGrantFacts(model.Facts.ReferenceGrant))
}

func BuildBackendTLSPolicyNetworkSummary(meta ClusterMeta, policy *gatewayv1.BackendTLSPolicy) NetworkSummary {
	if policy == nil {
		return NetworkSummary{ClusterMeta: meta, Kind: "BackendTLSPolicy"}
	}
	model := resourcemodel.BuildBackendTLSPolicyResourceModel(meta.ClusterID, policy)
	return newNetworkSummary(meta, policy, "BackendTLSPolicy", describeBackendTLSPolicyFacts(model.Facts.BackendTLSPolicy))
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
	model := customresource.BuildResourceModel(meta.ClusterID, resource, gvr, kindFallback, crdName, resourcemodel.ResourceScopeNamespaced, defaultNamespace)
	facts := customresource.BuildFacts(meta.ClusterID, resource, gvr, crdName, resourcemodel.ResourceModelBuildOptions{})
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
		StatusPresentation: model.Status.Presentation,
		Ready:              facts.Ready,
		ObservedGeneration: facts.ObservedGeneration,
		Conditions:         facts.Conditions,
		Age:                formatAge(model.Metadata.CreationTimestamp.Time),
		Labels:             model.Metadata.Labels,
		Annotations:        model.Metadata.Annotations,
	}
}

// BuildClusterStorageClassSummary builds a storage class entry that matches snapshot formatting.
func BuildClusterStorageClassSummary(meta ClusterMeta, sc *storagev1.StorageClass) ClusterConfigEntry {
	if sc == nil {
		return ClusterConfigEntry{ClusterMeta: meta, Kind: "StorageClass"}
	}
	facts := storageclass.BuildFacts(sc)
	return newClusterConfigEntry(meta, sc, "StorageClass", facts.Provisioner, facts.DefaultClass)
}

// BuildClusterIngressClassSummary builds an ingress class entry that matches snapshot formatting.
func BuildClusterIngressClassSummary(meta ClusterMeta, ic *networkingv1.IngressClass) ClusterConfigEntry {
	if ic == nil {
		return ClusterConfigEntry{ClusterMeta: meta, Kind: "IngressClass"}
	}
	facts := ingressclass.BuildFacts(ic)
	return newClusterConfigEntry(meta, ic, "IngressClass", facts.Controller, facts.DefaultClass)
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
	return newClusterConfigEntry(meta, gc, "GatewayClass", details, false)
}

// BuildClusterValidatingWebhookSummary builds a validating webhook entry that matches snapshot formatting.
func BuildClusterValidatingWebhookSummary(
	meta ClusterMeta,
	webhook *admissionregistrationv1.ValidatingWebhookConfiguration,
) ClusterConfigEntry {
	if webhook == nil {
		return ClusterConfigEntry{ClusterMeta: meta, Kind: "ValidatingWebhookConfiguration"}
	}
	count := len(admission.BuildValidatingFacts(meta.ClusterID, webhook).Webhooks)
	return ClusterConfigEntry{
		ClusterMeta:  meta,
		Kind:         "ValidatingWebhookConfiguration",
		Name:         webhook.Name,
		Details:      admission.WebhookCountDetails(count),
		Age:          formatAge(webhook.CreationTimestamp.Time),
		AgeTimestamp: creationTimestampMillis(webhook),
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
	count := len(admission.BuildMutatingFacts(meta.ClusterID, webhook).Webhooks)
	return ClusterConfigEntry{
		ClusterMeta:  meta,
		Kind:         "MutatingWebhookConfiguration",
		Name:         webhook.Name,
		Details:      admission.WebhookCountDetails(count),
		Age:          formatAge(webhook.CreationTimestamp.Time),
		AgeTimestamp: creationTimestampMillis(webhook),
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
// BuildClusterCRDSummary moved to resources/apiextensions (BuildStreamSummary).

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
	model := customresource.BuildResourceModel(meta.ClusterID, resource, gvr, kindFallback, crdName, resourcemodel.ResourceScopeCluster, "")
	facts := customresource.BuildFacts(meta.ClusterID, resource, gvr, crdName, resourcemodel.ResourceModelBuildOptions{})
	return ClusterCustomSummary{
		ClusterMeta:        meta,
		Kind:               model.Ref.Kind,
		Name:               model.Ref.Name,
		APIGroup:           model.Ref.Group,
		APIVersion:         model.Ref.Version,
		CRDName:            crdName,
		Status:             model.Status.Label,
		StatusState:        model.Status.State,
		StatusPresentation: model.Status.Presentation,
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
	facts := endpointslice.BuildFacts(meta.ClusterID, slice)
	return NetworkSummary{
		ClusterMeta:  meta,
		Kind:         "EndpointSlice",
		Name:         slice.Name,
		Namespace:    slice.Namespace,
		Details:      endpointslice.DescribeSummary(facts),
		Age:          formatAge(slice.CreationTimestamp.Time),
		AgeTimestamp: creationTimestampMillis(slice),
	}
}

// BuildWorkloadSummary builds a workload row payload for a single workload object.
func BuildWorkloadSummary(
	meta ClusterMeta,
	obj interface{},
	pods []*corev1.Pod,
	usage map[string]metrics.PodUsage,
	hpas ...*autoscalingv1.HorizontalPodAutoscaler,
) (WorkloadSummary, error) {
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
	managed := false
	if _, ok := buildHPATargetSet(hpas)[workloadHPATargetKey(summary)]; ok {
		managed = true
	}
	summary.HPAManaged = &managed
	return summary, nil
}

// BuildStandalonePodWorkloadSummary builds a workload row payload for a standalone pod entry.
func BuildStandalonePodWorkloadSummary(
	meta ClusterMeta,
	pod *corev1.Pod,
	usage map[string]metrics.PodUsage,
	hpas ...*autoscalingv1.HorizontalPodAutoscaler,
) WorkloadSummary {
	summary := buildStandalonePodSummary(meta.ClusterID, pod, usage)
	summary.ClusterMeta = meta
	managed := false
	if _, ok := buildHPATargetSet(hpas)[workloadHPATargetKey(summary)]; ok {
		managed = true
	}
	summary.HPAManaged = &managed
	return summary
}

// BuildNodeSummary builds a node row payload from the supplied node, pod
// list, and pre-resolved metrics maps. The metrics-as-parameter contract
// (see resource-stream projection plan, Phase 5) keeps the projector
// deterministic: stream handlers fetch the latest usage snapshot once
// per event and pass it in, so parity tests can drive snapshot and
// stream paths with the same fixtures. Pass nil maps to render a node
// row without metrics — both maps are treated as empty.
func BuildNodeSummary(meta ClusterMeta, node *corev1.Node, pods []*corev1.Pod, nodeUsage map[string]metrics.NodeUsage, podUsage map[string]metrics.PodUsage) (NodeSummary, error) {
	if node == nil {
		return NodeSummary{}, errors.New("node is nil")
	}
	ctx := WithClusterMeta(context.Background(), meta)
	// Scope "" carries no query string, so the parse cannot fail here.
	snap, err := buildNodeSnapshotFromUsage(ctx, "", []*corev1.Node{node}, pods, nodeUsageOrEmpty(nodeUsage), podUsageOrEmpty(podUsage), metrics.Metadata{})
	if err != nil {
		return NodeSummary{}, err
	}
	if snap == nil {
		return NodeSummary{}, errors.New("node snapshot unavailable")
	}
	payload, ok := snap.Payload.(NodeSnapshot)
	if !ok || len(payload.Rows) == 0 {
		return NodeSummary{}, errors.New("node summary unavailable")
	}
	return payload.Rows[0], nil
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
