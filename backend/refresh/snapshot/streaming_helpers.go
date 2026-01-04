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
	appslisters "k8s.io/client-go/listers/apps/v1"

	"github.com/luxury-yacht/app/backend/refresh/metrics"
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

// BuildNamespaceSummary builds a namespace row payload that matches snapshot formatting.
func BuildNamespaceSummary(meta ClusterMeta, ns *corev1.Namespace, hasWorkloads bool, workloadsUnknown bool) NamespaceSummary {
	if ns == nil {
		return NamespaceSummary{ClusterMeta: meta}
	}
	return NamespaceSummary{
		ClusterMeta:     meta,
		Name:             ns.Name,
		Phase:            string(ns.Status.Phase),
		ResourceVersion:  ns.ResourceVersion,
		CreationUnix:     ns.CreationTimestamp.Unix(),
		HasWorkloads:     hasWorkloads,
		WorkloadsUnknown: workloadsUnknown,
	}
}

// BuildConfigMapSummary builds a config map row payload that matches snapshot formatting.
func BuildConfigMapSummary(meta ClusterMeta, cm *corev1.ConfigMap) ConfigSummary {
	if cm == nil {
		return ConfigSummary{ClusterMeta: meta, Kind: "ConfigMap", TypeAlias: "CM"}
	}
	return ConfigSummary{
		ClusterMeta: meta,
		Kind:        "ConfigMap",
		TypeAlias:   "CM",
		Name:        cm.Name,
		Namespace:   cm.Namespace,
		Data:        len(cm.Data) + len(cm.BinaryData),
		Age:         formatAge(cm.CreationTimestamp.Time),
	}
}

// BuildSecretSummary builds a secret row payload that matches snapshot formatting.
func BuildSecretSummary(meta ClusterMeta, secret *corev1.Secret) ConfigSummary {
	if secret == nil {
		return ConfigSummary{ClusterMeta: meta, Kind: "Secret"}
	}
	return ConfigSummary{
		ClusterMeta: meta,
		Kind:        "Secret",
		TypeAlias:   secretTypeAlias(secret),
		Name:        secret.Name,
		Namespace:   secret.Namespace,
		Data:        len(secret.Data) + len(secret.StringData),
		Age:         formatAge(secret.CreationTimestamp.Time),
	}
}

// BuildRoleSummary builds a role row payload that matches snapshot formatting.
func BuildRoleSummary(meta ClusterMeta, role *rbacv1.Role) RBACSummary {
	if role == nil {
		return RBACSummary{ClusterMeta: meta, Kind: "Role"}
	}
	return RBACSummary{
		ClusterMeta: meta,
		Kind:        "Role",
		Name:        role.Name,
		Namespace:   role.Namespace,
		Details:     describeRole(role),
		Age:         formatAge(role.CreationTimestamp.Time),
	}
}

// BuildRoleBindingSummary builds a role binding row payload that matches snapshot formatting.
func BuildRoleBindingSummary(meta ClusterMeta, binding *rbacv1.RoleBinding) RBACSummary {
	if binding == nil {
		return RBACSummary{ClusterMeta: meta, Kind: "RoleBinding"}
	}
	return RBACSummary{
		ClusterMeta: meta,
		Kind:        "RoleBinding",
		Name:        binding.Name,
		Namespace:   binding.Namespace,
		Details:     describeRoleBinding(binding),
		Age:         formatAge(binding.CreationTimestamp.Time),
	}
}

// BuildServiceAccountSummary builds a service account row payload that matches snapshot formatting.
func BuildServiceAccountSummary(meta ClusterMeta, sa *corev1.ServiceAccount) RBACSummary {
	if sa == nil {
		return RBACSummary{ClusterMeta: meta, Kind: "ServiceAccount"}
	}
	return RBACSummary{
		ClusterMeta: meta,
		Kind:        "ServiceAccount",
		Name:        sa.Name,
		Namespace:   sa.Namespace,
		Details:     describeServiceAccount(sa),
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
	return NetworkSummary{
		ClusterMeta: meta,
		Kind:        "Service",
		Name:        svc.Name,
		Namespace:   svc.Namespace,
		Details:     describeService(svc, slices),
		Age:         formatAge(svc.CreationTimestamp.Time),
	}
}

// BuildIngressNetworkSummary builds an ingress row payload that matches snapshot formatting.
func BuildIngressNetworkSummary(meta ClusterMeta, ing *networkingv1.Ingress) NetworkSummary {
	if ing == nil {
		return NetworkSummary{ClusterMeta: meta, Kind: "Ingress"}
	}
	return NetworkSummary{
		ClusterMeta: meta,
		Kind:        "Ingress",
		Name:        ing.Name,
		Namespace:   ing.Namespace,
		Details:     describeIngress(ing),
		Age:         formatAge(ing.CreationTimestamp.Time),
	}
}

// BuildNetworkPolicySummary builds a network policy row payload that matches snapshot formatting.
func BuildNetworkPolicySummary(meta ClusterMeta, policy *networkingv1.NetworkPolicy) NetworkSummary {
	if policy == nil {
		return NetworkSummary{ClusterMeta: meta, Kind: "NetworkPolicy"}
	}
	return NetworkSummary{
		ClusterMeta: meta,
		Kind:        "NetworkPolicy",
		Name:        policy.Name,
		Namespace:   policy.Namespace,
		Details:     describeNetworkPolicy(policy),
		Age:         formatAge(policy.CreationTimestamp.Time),
	}
}

// BuildNamespaceCustomSummary builds a custom resource row payload that matches snapshot formatting.
func BuildNamespaceCustomSummary(
	meta ClusterMeta,
	resource *unstructured.Unstructured,
	apiGroup string,
	kindFallback string,
) NamespaceCustomSummary {
	if resource == nil {
		return NamespaceCustomSummary{ClusterMeta: meta, Kind: kindFallback, APIGroup: apiGroup}
	}
	kind := resource.GetKind()
	if kind == "" {
		kind = kindFallback
	}
	return NamespaceCustomSummary{
		ClusterMeta: meta,
		Kind:        kind,
		Name:        resource.GetName(),
		APIGroup:    apiGroup,
		Namespace:   resource.GetNamespace(),
		Age:         formatAge(resource.GetCreationTimestamp().Time),
		Labels:      resource.GetLabels(),
		Annotations: resource.GetAnnotations(),
	}
}

// BuildClusterRoleSummary builds a cluster role row payload that matches snapshot formatting.
func BuildClusterRoleSummary(meta ClusterMeta, role *rbacv1.ClusterRole) ClusterRBACEntry {
	if role == nil {
		return ClusterRBACEntry{ClusterMeta: meta, Kind: "ClusterRole"}
	}
	return ClusterRBACEntry{
		ClusterMeta: meta,
		Kind:        "ClusterRole",
		Name:        role.Name,
		Details:     describeClusterRole(role),
		Age:         formatAge(role.CreationTimestamp.Time),
		TypeAlias:   "CR",
	}
}

// BuildClusterRoleBindingSummary builds a cluster role binding row payload that matches snapshot formatting.
func BuildClusterRoleBindingSummary(meta ClusterMeta, binding *rbacv1.ClusterRoleBinding) ClusterRBACEntry {
	if binding == nil {
		return ClusterRBACEntry{ClusterMeta: meta, Kind: "ClusterRoleBinding"}
	}
	return ClusterRBACEntry{
		ClusterMeta: meta,
		Kind:        "ClusterRoleBinding",
		Name:        binding.Name,
		Details:     describeClusterRoleBinding(binding),
		Age:         formatAge(binding.CreationTimestamp.Time),
		TypeAlias:   "CRB",
	}
}

// BuildClusterStorageSummary builds a persistent volume row payload that matches snapshot formatting.
func BuildClusterStorageSummary(meta ClusterMeta, pv *corev1.PersistentVolume) ClusterStorageEntry {
	if pv == nil {
		return ClusterStorageEntry{ClusterMeta: meta, Kind: "PersistentVolume"}
	}
	return ClusterStorageEntry{
		ClusterMeta:  meta,
		Kind:         "PersistentVolume",
		Name:         pv.Name,
		StorageClass: pv.Spec.StorageClassName,
		Capacity:     formatStorageCapacity(pv),
		AccessModes:  formatAccessModes(pv.Spec.AccessModes),
		Status:       string(pv.Status.Phase),
		Claim:        formatClaimRef(pv.Spec.ClaimRef),
		Age:          formatAge(pv.CreationTimestamp.Time),
	}
}

// BuildClusterStorageClassSummary builds a storage class entry that matches snapshot formatting.
func BuildClusterStorageClassSummary(meta ClusterMeta, sc *storagev1.StorageClass) ClusterConfigEntry {
	if sc == nil {
		return ClusterConfigEntry{ClusterMeta: meta, Kind: "StorageClass"}
	}
	return ClusterConfigEntry{
		ClusterMeta: meta,
		Kind:        "StorageClass",
		Name:        sc.Name,
		Details:     sc.Provisioner,
		IsDefault:   isDefaultClass(sc.Annotations),
		Age:         formatAge(sc.CreationTimestamp.Time),
	}
}

// BuildClusterIngressClassSummary builds an ingress class entry that matches snapshot formatting.
func BuildClusterIngressClassSummary(meta ClusterMeta, ic *networkingv1.IngressClass) ClusterConfigEntry {
	if ic == nil {
		return ClusterConfigEntry{ClusterMeta: meta, Kind: "IngressClass"}
	}
	return ClusterConfigEntry{
		ClusterMeta: meta,
		Kind:        "IngressClass",
		Name:        ic.Name,
		Details:     ic.Spec.Controller,
		IsDefault:   isDefaultClass(ic.Annotations),
		Age:         formatAge(ic.CreationTimestamp.Time),
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
	return ClusterConfigEntry{
		ClusterMeta: meta,
		Kind:        "ValidatingWebhookConfiguration",
		Name:        webhook.Name,
		Details:     webhookDetails(len(webhook.Webhooks)),
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
	return ClusterConfigEntry{
		ClusterMeta: meta,
		Kind:        "MutatingWebhookConfiguration",
		Name:        webhook.Name,
		Details:     webhookDetails(len(webhook.Webhooks)),
		Age:         formatAge(webhook.CreationTimestamp.Time),
	}
}

// BuildClusterCRDSummary builds a CRD row payload that matches snapshot formatting.
func BuildClusterCRDSummary(meta ClusterMeta, crd *apiextensionsv1.CustomResourceDefinition) ClusterCRDEntry {
	if crd == nil {
		return ClusterCRDEntry{ClusterMeta: meta, Kind: "CustomResourceDefinition"}
	}
	return ClusterCRDEntry{
		ClusterMeta: meta,
		Kind:        "CustomResourceDefinition",
		Name:        crd.Name,
		Group:       crd.Spec.Group,
		Scope:       string(crd.Spec.Scope),
		Details:     describeCRDVersions(crd),
		Age:         formatAge(crd.CreationTimestamp.Time),
		TypeAlias:   "CRD",
	}
}

// BuildClusterCustomSummary builds a cluster custom resource row payload that matches snapshot formatting.
func BuildClusterCustomSummary(
	meta ClusterMeta,
	resource *unstructured.Unstructured,
	apiGroup string,
	kindFallback string,
) ClusterCustomSummary {
	if resource == nil {
		return ClusterCustomSummary{ClusterMeta: meta, Kind: kindFallback, APIGroup: apiGroup}
	}
	kind := resourceKind(resource, kindFallback)
	return ClusterCustomSummary{
		ClusterMeta: meta,
		Kind:        kind,
		Name:        resource.GetName(),
		APIGroup:    apiGroup,
		Age:         formatAge(resource.GetCreationTimestamp().Time),
		Labels:      resource.GetLabels(),
		Annotations: resource.GetAnnotations(),
	}
}

// BuildEndpointSliceSummary builds an endpoint slice row payload that matches snapshot formatting.
func BuildEndpointSliceSummary(
	meta ClusterMeta,
	namespace string,
	serviceName string,
	slices []*discoveryv1.EndpointSlice,
) NetworkSummary {
	return NetworkSummary{
		ClusterMeta: meta,
		Kind:        "EndpointSlice",
		Name:        serviceName,
		Namespace:   namespace,
		Details:     describeEndpointSlices(slices),
		Age:         formatAge(earliestSliceCreation(slices)),
	}
}

// BuildHPASummary builds an HPA row payload that matches snapshot formatting.
func BuildHPASummary(meta ClusterMeta, hpa *autoscalingv1.HorizontalPodAutoscaler) AutoscalingSummary {
	if hpa == nil {
		return AutoscalingSummary{ClusterMeta: meta, Kind: "HorizontalPodAutoscaler"}
	}
	return AutoscalingSummary{
		ClusterMeta: meta,
		Kind:        "HorizontalPodAutoscaler",
		Name:        hpa.Name,
		Namespace:   hpa.Namespace,
		Target:      describeHPATarget(hpa),
		Min:         minReplicas(hpa),
		Max:         hpa.Spec.MaxReplicas,
		Current:     hpa.Status.CurrentReplicas,
		Age:         formatAge(hpa.CreationTimestamp.Time),
	}
}

// BuildPVCStorageSummary builds a PVC row payload that matches snapshot formatting.
func BuildPVCStorageSummary(meta ClusterMeta, pvc *corev1.PersistentVolumeClaim) StorageSummary {
	if pvc == nil {
		return StorageSummary{ClusterMeta: meta, Kind: "PersistentVolumeClaim"}
	}
	return StorageSummary{
		ClusterMeta:  meta,
		Kind:         "PersistentVolumeClaim",
		Name:         pvc.Name,
		Namespace:    pvc.Namespace,
		Capacity:     pvcCapacity(pvc),
		Status:       string(pvc.Status.Phase),
		StorageClass: storageClassName(pvc),
		Age:          formatAge(pvc.CreationTimestamp.Time),
	}
}

// BuildResourceQuotaSummary builds a quota row payload that matches snapshot formatting.
func BuildResourceQuotaSummary(meta ClusterMeta, quota *corev1.ResourceQuota) QuotaSummary {
	if quota == nil {
		return QuotaSummary{ClusterMeta: meta, Kind: "ResourceQuota"}
	}
	return QuotaSummary{
		ClusterMeta: meta,
		Kind:        "ResourceQuota",
		Name:        quota.Name,
		Namespace:   quota.Namespace,
		Details:     describeResourceQuota(quota),
		Age:         formatAge(quota.CreationTimestamp.Time),
	}
}

// BuildLimitRangeSummary builds a limit range row payload that matches snapshot formatting.
func BuildLimitRangeSummary(meta ClusterMeta, limit *corev1.LimitRange) QuotaSummary {
	if limit == nil {
		return QuotaSummary{ClusterMeta: meta, Kind: "LimitRange"}
	}
	return QuotaSummary{
		ClusterMeta: meta,
		Kind:        "LimitRange",
		Name:        limit.Name,
		Namespace:   limit.Namespace,
		Details:     describeLimitRange(limit),
		Age:         formatAge(limit.CreationTimestamp.Time),
	}
}

// BuildPodDisruptionBudgetSummary builds a PDB row payload that matches snapshot formatting.
func BuildPodDisruptionBudgetSummary(meta ClusterMeta, pdb *policyv1.PodDisruptionBudget) QuotaSummary {
	if pdb == nil {
		return QuotaSummary{ClusterMeta: meta, Kind: "PodDisruptionBudget"}
	}
	summary := QuotaSummary{
		ClusterMeta: meta,
		Kind:        "PodDisruptionBudget",
		Name:        pdb.Name,
		Namespace:   pdb.Namespace,
		Details:     describePodDisruptionBudget(pdb),
		Age:         formatAge(pdb.CreationTimestamp.Time),
		Status: &QuotaStatus{
			DisruptionsAllowed: pdb.Status.DisruptionsAllowed,
			CurrentHealthy:     pdb.Status.CurrentHealthy,
			DesiredHealthy:     pdb.Status.DesiredHealthy,
		},
	}
	if pdb.Spec.MinAvailable != nil {
		value := pdb.Spec.MinAvailable.String()
		summary.MinAvailable = &value
	}
	if pdb.Spec.MaxUnavailable != nil {
		value := pdb.Spec.MaxUnavailable.String()
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
		summary = builder.buildDeploymentSummary(typed, podsByOwner, usage)
	case *appsv1.StatefulSet:
		summary = builder.buildStatefulSetSummary(typed, podsByOwner, usage)
	case *appsv1.DaemonSet:
		summary = builder.buildDaemonSetSummary(typed, podsByOwner, usage)
	case *batchv1.Job:
		summary = builder.buildJobSummary(typed, podsByOwner, usage)
	case *batchv1.CronJob:
		summary = builder.buildCronJobSummary(typed, podsByOwner, usage)
	default:
		return WorkloadSummary{}, fmt.Errorf("unsupported workload type %T", obj)
	}

	summary.ClusterMeta = meta
	return summary, nil
}

// BuildStandalonePodWorkloadSummary builds a workload row payload for a standalone pod entry.
func BuildStandalonePodWorkloadSummary(meta ClusterMeta, pod *corev1.Pod, usage map[string]metrics.PodUsage) WorkloadSummary {
	summary := buildStandalonePodSummary(pod, usage)
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
